import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import * as AdmZip from 'adm-zip';
import * as fs from 'fs-extra';
import * as csv from 'csv-parser';
import * as path from 'path';
import { PrismaService } from '../prisma.service';

@Processor('report-queue')
export class ReportProcessor extends WorkerHost {
  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { filePath, originalName } = job.data;
    const extractPath = `./extracted/${path.basename(filePath, '.zip')}`;

    // 1. Tạo Report Record
    const report = await this.prisma.report.create({
      data: { filename: originalName, status: 'PROCESSING' },
    });

    try {
      console.log(`Start processing: ${originalName}`);

      // 2. Giải nén
      const zip = new AdmZip(filePath);
      zip.extractAllTo(extractPath, true);

      // 3. Tìm file CSV mục tiêu (Đệ quy vì cấu trúc folder thay đổi)
      const targetFile = 'open_findings_on_overall_code.csv';
      const csvPath = await this.findFileRecursively(extractPath, targetFile);

      if (!csvPath) throw new Error('CSV file not found inside ZIP');

      // 4. Stream & Batch Insert
      const issuesBatch = [];
      const BATCH_SIZE = 2000;

      const stream = fs.createReadStream(csvPath).pipe(csv());

      for await (const row of stream) {
        // Map dữ liệu từ CSV (dựa trên header file bạn gửi)
        issuesBatch.push({
          reportId: report.id,
          message: row['Message'],
          type: row['Type'],
          severity: row['Severity'],
          ruleKey: row['Rule Key'],
          ruleName: row['Rule Name'],
          fileName: row['File Name'],
          fileLine: row['File Line'] ? parseInt(row['File Line']) : 0,
          impactMaintainability: row['Impact MAINTAINABILITY'],
          impactReliability: row['Impact RELIABILITY'],
          impactSecurity: row['Impact SECURITY'],
        });

        if (issuesBatch.length >= BATCH_SIZE) {
          await this.prisma.issue.createMany({ data: issuesBatch });
          issuesBatch.length = 0; // Clear mảng
        }
      }

      // Insert phần còn lại
      if (issuesBatch.length > 0) {
        await this.prisma.issue.createMany({ data: issuesBatch });
      }

      // 5. Update Status
      await this.prisma.report.update({
        where: { id: report.id },
        data: { status: 'COMPLETED' },
      });
      console.log(`Finished processing: ${originalName}`);

    } catch (error) {
      console.error(`Error processing ${originalName}:`, error);
      await this.prisma.report.update({
        where: { id: report.id },
        data: { status: 'FAILED' }
      });
    } finally {
      // 6. Cleanup
      if (await fs.pathExists(filePath)) await fs.remove(filePath);
      if (await fs.pathExists(extractPath)) await fs.remove(extractPath);
    }
  }

  // Hàm tìm file bất kể cấu trúc thư mục
  private async findFileRecursively(dir: string, filename: string): Promise<string | null> {
    const files = await fs.readdir(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        const found = await this.findFileRecursively(fullPath, filename);
        if (found) return found;
      } else if (file === filename) {
        return fullPath;
      }
    }
    return null;
  }
}