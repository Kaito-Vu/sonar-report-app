import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReportModule } from './report/report.module';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
      },
    }),
    ReportModule,
  ],
})
export class AppModule {}