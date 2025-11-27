import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as Minio from 'minio';

@Injectable()
export class MinioService implements OnModuleInit {
  private minioClient: Minio.Client;
  private bucketName = process.env.MINIO_BUCKET || 'sonar-reports';
  private logger = new Logger(MinioService.name);

  constructor() {
    this.minioClient = new Minio.Client({
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT) || 9000,
      useSSL: false,
      accessKey: process.env.MINIO_ACCESS_KEY,
      secretKey: process.env.MINIO_SECRET_KEY,
    });
  }

  async onModuleInit() {
    try {
      const exists = await this.minioClient.bucketExists(this.bucketName);
      if (!exists) await this.minioClient.makeBucket(this.bucketName, 'us-east-1');
    } catch (e) { this.logger.error(`MinIO Error: ${e.message}`); }
  }

  async uploadFile(filename: string, buffer: Buffer) {
    await this.minioClient.putObject(this.bucketName, filename, buffer);
  }

  async downloadFileToTemp(key: string, destPath: string) {
    await this.minioClient.fGetObject(this.bucketName, key, destPath);
  }
}