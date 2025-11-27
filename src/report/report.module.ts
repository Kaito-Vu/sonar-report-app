import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { ReportController } from './report.controller';
import { ProjectController } from './project.controller';
import { ReportProcessor } from './report.processor';
import { PrismaService } from '../prisma.service';
import { MinioService } from '../minio.service';
import { SonarService } from '../sonar.service';

@Module({
  imports: [
    HttpModule,
    BullModule.registerQueue({ name: 'report-queue' }),
  ],
  controllers: [ReportController, ProjectController],
  providers: [ReportProcessor, PrismaService, MinioService, SonarService],
})
export class ReportModule {}