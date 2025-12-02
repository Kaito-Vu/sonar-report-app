import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma.service';
import { SonarService } from '../sonar.service';
import { MinioService } from '../minio.service';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @InjectQueue('report-queue') private reportQueue: Queue,
    private prisma: PrismaService,
    private sonarService: SonarService,
    private minioService: MinioService,
  ) {}

  async processDownload(project: any, analysis: any) {
    let fileKey: string | null = null;
    try {
      this.logger.log(
        `Starting download for project: ${project.key}, analysis: ${analysis.key}`,
      );

      const fileBuffer = await this.sonarService.downloadReport(
        project.key.trim(),
      );
      const fileName = `SYNC_${analysis.key.substring(0, 8)}_${new Date(analysis.date).toISOString().split('T')[0]}.zip`;
      fileKey = `${Date.now()}-${Math.random().toString(36).substring(7)}.zip`;

      // Upload to MinIO first
      await this.minioService.uploadFile(fileKey, fileBuffer);
      this.logger.log(`File uploaded to MinIO: ${fileKey}`);

      // Create report record in transaction
      const report = await this.prisma.$transaction(async (tx) => {
        // Check for duplicate analysisKey within transaction
        const existing = await tx.report.findFirst({
          where: {
            projectId: project.id,
            analysisKey: analysis.key,
            status: { not: 'DELETED' },
          },
        });

        if (existing) {
          throw new Error(
            `Report with analysisKey ${analysis.key} already exists`,
          );
        }

        return await tx.report.create({
          data: {
            filename: fileName,
            status: 'QUEUED',
            projectId: project.id,
            analysisKey: analysis.key,
            analysisDate: new Date(analysis.date),
            projectVersion: analysis.projectVersion,
          },
        });
      });

      // Add to queue after successful database transaction
      await this.reportQueue.add('process-zip', {
        reportId: report.id,
        fileKey,
        originalName: fileName,
      });

      this.logger.log(`Job queued for report: ${report.id}`);
      return report;
    } catch (error) {
      this.logger.error(
        `Failed to process download: ${error.message}`,
        error.stack,
      );

      // Cleanup: Try to remove uploaded file if database transaction failed
      if (fileKey) {
        try {
          // Note: MinioService would need a deleteFile method for this
          this.logger.warn(`File ${fileKey} may need manual cleanup`);
        } catch (cleanupError) {
          this.logger.error(
            `Failed to cleanup file ${fileKey}: ${cleanupError.message}`,
          );
        }
      }

      throw error;
    }
  }

  async syncLatest(projectId: number) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new Error('Project not found');
    }

    const sonarKey = project.key.trim();
    const latestAnalysis = await this.sonarService.getLatestAnalysis(sonarKey);

    if (!latestAnalysis) {
      throw new Error('No scans found on SonarQube');
    }

    const existingReport = await this.prisma.report.findFirst({
      where: {
        projectId: projectId,
        analysisKey: latestAnalysis.key,
        status: { not: 'DELETED' },
      },
    });

    if (existingReport) {
      if (existingReport.status === 'COMPLETED') {
        return {
          action: 'REDIRECT',
          reportId: existingReport.id,
          message: 'Report already exists',
        };
      } else if (['QUEUED', 'PROCESSING'].includes(existingReport.status)) {
        return { action: 'RELOAD', message: 'Processing in progress' };
      } else {
        // Failed status - delete and retry
        this.logger.warn(`Deleting failed report: ${existingReport.id}`);
        await this.prisma.report.delete({ where: { id: existingReport.id } });
      }
    }

    await this.processDownload(project, latestAnalysis);
    return { action: 'RELOAD', message: 'Sync started successfully' };
  }

  async syncSpecific(projectId: number, analysisKey: string, date: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new Error('Project not found');
    }

    const analysis = {
      key: analysisKey,
      date: date,
      projectVersion: 'Specific',
    };
    const existing = await this.prisma.report.findFirst({
      where: {
        analysisKey: analysis.key,
        projectId: projectId,
        status: { not: 'DELETED' },
      },
    });

    if (existing) {
      if (existing.status === 'COMPLETED') {
        return {
          action: 'REDIRECT',
          reportId: existing.id,
          message: 'Report already exists',
        };
      }
      if (existing.status === 'FAILED') {
        this.logger.warn(`Deleting failed report: ${existing.id}`);
        await this.prisma.report.delete({ where: { id: existing.id } });
      } else {
        return { action: 'RELOAD', message: 'Processing in progress' };
      }
    }

    await this.processDownload(project, analysis);
    return { action: 'RELOAD', message: 'Sync started successfully' };
  }
}
