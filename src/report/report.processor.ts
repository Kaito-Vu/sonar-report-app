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

  // Định nghĩa thứ tự ưu tiên (Index càng nhỏ càng quan trọng)
  private readonly SEVERITY_ORDER = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'];
  private readonly TYPE_ORDER = ['VULNERABILITY', 'SECURITY_HOTSPOT', 'BUG', 'CODE_SMELL'];

  constructor(private prisma: PrismaService, private minioService: MinioService) { super(); }

  async process(job: Job<any, any, string>): Promise<any> {
    const { reportId, fileKey, originalName } = job.data;
    const tempDir = path.resolve('./temp_processing');
    const zipFilePath = path.join(tempDir, fileKey);
    const extractPath = path.join(tempDir, path.basename(fileKey, '.zip'));

    try {
      await this.prisma.report.update({ where: { id: reportId }, data: { status: 'PROCESSING' } });
      await fs.ensureDir(tempDir);
      await this.minioService.downloadFileToTemp(fileKey, zipFilePath);

      const zip = new AdmZip(zipFilePath);
      zip.extractAllTo(extractPath, true);

      const csvPath = await this.findFile(extractPath, 'open_findings_on_overall_code.csv');
      if (!csvPath) throw new Error('CSV not found');

      const issuesBatch = [];
      const stream = fs.createReadStream(csvPath).pipe(csv());

      for await (const row of stream) {
        // --- TÍNH TOÁN INDEX ĐỂ SORT ---
        let tIdx = this.TYPE_ORDER.indexOf(row['Type']);
        if (tIdx === -1) tIdx = 99; // Không xác định thì đẩy xuống cuối

        let sIdx = this.SEVERITY_ORDER.indexOf(row['Severity']);
        if (sIdx === -1) sIdx = 99;
        // -------------------------------

        issuesBatch.push({
          reportId,
          message: row['Message'],
          type: row['Type'],
          severity: row['Severity'],
          ruleKey: row['Rule Key'],
          ruleName: row['Rule Name'],
          fileName: row['File Name'],
          fileLine: row['File Line'] ? parseInt(row['File Line']) : 0,

          // Lưu giá trị index vào DB
          typeIdx: tIdx,
          severityIdx: sIdx
        });

        if (issuesBatch.length >= 1000) {
          await this.prisma.issue.createMany({ data: issuesBatch });
          issuesBatch.length = 0;
        }
      }
      if (issuesBatch.length > 0) await this.prisma.issue.createMany({ data: issuesBatch });

      await this.prisma.report.update({ where: { id: reportId }, data: { status: 'COMPLETED' } });
    } catch (error) {
      this.logger.error(error.message);
      await this.prisma.report.update({ where: { id: reportId }, data: { status: 'FAILED' } });
    } finally {
      if (await fs.pathExists(zipFilePath)) await fs.remove(zipFilePath);
      if (await fs.pathExists(extractPath)) await fs.remove(extractPath);
    }
  }

  private async findFile(dir, filename): Promise<string | null> {
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