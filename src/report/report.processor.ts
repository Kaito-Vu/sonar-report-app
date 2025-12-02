import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import AdmZip from 'adm-zip';
import * as fs from 'fs-extra';
import csv from 'csv-parser';
import * as path from 'path';
import { PrismaService } from '../prisma.service';
import { MinioService } from '../minio.service';
import { Logger } from '@nestjs/common';

@Processor('report-queue')
export class ReportProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportProcessor.name);
  private readonly SEVERITY_ORDER = [
    'BLOCKER',
    'CRITICAL',
    'MAJOR',
    'MINOR',
    'INFO',
  ];
  private readonly TYPE_ORDER = [
    'VULNERABILITY',
    'SECURITY_HOTSPOT',
    'BUG',
    'CODE_SMELL',
  ];

  constructor(
    private prisma: PrismaService,
    private minioService: MinioService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { reportId, fileKey } = job.data;
    const tempDir = path.resolve('./temp_processing');
    const zipFilePath = path.join(tempDir, fileKey);
    const extractPath = path.join(tempDir, path.basename(fileKey, '.zip'));

    try {
      await this.prisma.report.update({
        where: { id: reportId },
        data: { status: 'PROCESSING' },
      });
      await fs.ensureDir(tempDir);
      await this.minioService.downloadFileToTemp(fileKey, zipFilePath);

      const zip = new AdmZip(zipFilePath);
      zip.extractAllTo(extractPath, true);

      const csvPath = await this.findFile(
        extractPath,
        'open_findings_on_overall_code.csv',
      );
      if (!csvPath) throw new Error('CSV not found');

      // Get projectId from report
      const report = await this.prisma.report.findUnique({
        where: { id: reportId },
        select: { projectId: true },
      });
      if (!report?.projectId)
        throw new Error('Report must be linked to a project');

      // PHASE 1: Read all issues from CSV into memory
      this.logger.log(`Reading CSV file...`);
      const stream = fs.createReadStream(csvPath).pipe(csv());
      const issuesFromCSV = [];

      for await (const row of stream) {
        let tIdx = this.TYPE_ORDER.indexOf(row['Type']);
        if (tIdx === -1) tIdx = 99;
        let sIdx = this.SEVERITY_ORDER.indexOf(row['Severity']);
        if (sIdx === -1) sIdx = 99;

        const ruleKey = row['Rule Key'] || '';
        const fileName = row['File Name'] || '';
        const fileLine = row['File Line'] ? parseInt(row['File Line']) : 0;
        const lineGroup = Math.floor(fileLine / 10) * 10;

        issuesFromCSV.push({
          ruleKey,
          fileName,
          fileLine,
          lineGroup,
          message: row['Message'],
          type: row['Type'],
          severity: row['Severity'],
          ruleName: row['Rule Name'],
          typeIdx: tIdx,
          severityIdx: sIdx,
        });
      }

      this.logger.log(`Found ${issuesFromCSV.length} issues in CSV`);

      // PHASE 2: Query existing UniqueIssues for this project
      this.logger.log(`Querying existing unique issues...`);
      const existingIssues = await this.prisma.uniqueIssue.findMany({
        where: { projectId: report.projectId },
        select: { id: true, ruleKey: true, fileName: true, lineGroup: true },
      });

      // Create lookup map for fast checking
      const existingMap = new Map();
      existingIssues.forEach((issue) => {
        const key = `${issue.ruleKey}|${issue.fileName}|${issue.lineGroup}`;
        existingMap.set(key, issue.id);
      });

      this.logger.log(`Found ${existingIssues.length} existing unique issues`);

      // PHASE 3: Separate new issues from existing ones
      const newIssues = [];
      const issueOccurrences = [];
      const existingIssueIds = new Set();

      for (const issue of issuesFromCSV) {
        const key = `${issue.ruleKey}|${issue.fileName}|${issue.lineGroup}`;
        const existingId = existingMap.get(key);

        if (existingId) {
          // Existing issue - just track for occurrence
          issueOccurrences.push({
            uniqueIssueId: existingId,
            reportId,
          });
          existingIssueIds.add(existingId);
        } else {
          // New issue - need to create
          newIssues.push({
            projectId: report.projectId,
            ...issue,
          });
        }
      }

      this.logger.log(
        `New issues: ${newIssues.length}, Existing: ${issuesFromCSV.length - newIssues.length}`,
      );

      // PHASE 4: Batch insert new UniqueIssues
      if (newIssues.length > 0) {
        this.logger.log(`Creating ${newIssues.length} new unique issues...`);
        const BATCH_SIZE = 500;
        for (let i = 0; i < newIssues.length; i += BATCH_SIZE) {
          const batch = newIssues.slice(i, i + BATCH_SIZE);
          await this.prisma.uniqueIssue.createMany({
            data: batch,
            skipDuplicates: true,
          });
        }

        // Re-query to get IDs for new issues (in batches to avoid param limit)
        this.logger.log(`Fetching IDs for new issues...`);
        const QUERY_BATCH_SIZE = 500; // Safe limit for OR conditions
        const newlyCreated = [];

        for (let i = 0; i < newIssues.length; i += QUERY_BATCH_SIZE) {
          const batch = newIssues.slice(i, i + QUERY_BATCH_SIZE);
          const batchResults = await this.prisma.uniqueIssue.findMany({
            where: {
              projectId: report.projectId,
              OR: batch.map((iss) => ({
                ruleKey: iss.ruleKey,
                fileName: iss.fileName,
                lineGroup: iss.lineGroup,
              })),
            },
            select: { id: true, ruleKey: true, fileName: true, lineGroup: true },
          });
          newlyCreated.push(...batchResults);
        }

        this.logger.log(`Fetched ${newlyCreated.length} newly created issues`);

        // Add occurrences for newly created issues
        newlyCreated.forEach((issue) => {
          issueOccurrences.push({
            uniqueIssueId: issue.id,
            reportId,
          });
        });
      }

      // PHASE 5: Batch insert IssueOccurrences + Update lastSeenAt
      this.logger.log(
        `Creating ${issueOccurrences.length} issue occurrences...`,
      );
      const OCCURRENCE_BATCH_SIZE = 1000;
      for (let i = 0; i < issueOccurrences.length; i += OCCURRENCE_BATCH_SIZE) {
        const batch = issueOccurrences.slice(i, i + OCCURRENCE_BATCH_SIZE);
        await this.prisma.issueOccurrence.createMany({
          data: batch,
          skipDuplicates: true,
        });
      }

      // Update lastSeenAt for existing issues in batches
      if (existingIssueIds.size > 0) {
        this.logger.log(
          `Updating lastSeenAt for ${existingIssueIds.size} existing issues...`,
        );
        const existingIdsArray = Array.from(existingIssueIds) as number[];
        const UPDATE_BATCH_SIZE = 5000; // PostgreSQL param limit is ~32k

        for (let i = 0; i < existingIdsArray.length; i += UPDATE_BATCH_SIZE) {
          const batch = existingIdsArray.slice(i, i + UPDATE_BATCH_SIZE);
          await this.prisma.uniqueIssue.updateMany({
            where: { id: { in: batch } },
            data: { lastSeenAt: new Date() },
          });
        }
      }

      this.logger.log(`Processing completed successfully`);

      // [QUAN TRỌNG] Update thành COMPLETED
      await this.prisma.report.update({
        where: { id: reportId },
        data: { status: 'COMPLETED' },
      });
    } catch (error) {
      this.logger.error(`Job Failed: ${error.message}`);
      await this.prisma.report.update({
        where: { id: reportId },
        data: { status: 'FAILED' },
      });
    } finally {
      if (await fs.pathExists(zipFilePath)) await fs.remove(zipFilePath);
      if (await fs.pathExists(extractPath)) await fs.remove(extractPath);
    }
  }

  private async findFile(
    dir: string,
    filename: string,
  ): Promise<string | null> {
    const files = await fs.readdir(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        const found = await this.findFile(fullPath, filename);
        if (found) return found;
      } else if (file === filename) return fullPath;
    }
    return null;
  }
}
