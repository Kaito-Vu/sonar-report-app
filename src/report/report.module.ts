import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReportController } from './report.controller';
import { ReportProcessor } from './report.processor';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'report-queue',
    }),
  ],
  controllers: [ReportController],
  providers: [ReportProcessor, PrismaService],
})
export class ReportModule {}