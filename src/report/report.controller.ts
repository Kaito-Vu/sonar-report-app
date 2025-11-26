import { Controller, Get, Post, Param, UploadedFile, UseInterceptors, Render, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { diskStorage } from 'multer';
import { PrismaService } from '../prisma.service';
import { extname } from 'path';

@Controller()
export class ReportController {
  constructor(
    @InjectQueue('report-queue') private reportQueue: Queue,
    private prisma: PrismaService
  ) {}

  @Get()
  @Render('index')
  async home() {
    const reports = await this.prisma.report.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return { reports };
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: './uploads',
      filename: (req, file, cb) => {
        const randomName = Array(32).fill(null).map(() => (Math.round(Math.random() * 16)).toString(16)).join('');
        cb(null, `${randomName}${extname(file.originalname)}`);
      }
    })
  }))
  async upload(@UploadedFile() file: Express.Multer.File, @Res() res) {
    if (!file) return res.redirect('/');

    // Đẩy vào hàng đợi
    await this.reportQueue.add('process-zip', {
      filePath: file.path,
      originalName: file.originalname
    });

    // Redirect về trang chủ để thấy trạng thái PENDING
    return res.redirect('/');
  }

  @Get('report/:id')
  @Render('detail')
  async viewReport(@Param('id') id: string) {
    const report = await this.prisma.report.findUnique({
      where: { id },
      include: {
        issues: { take: 500 } // Limit 500 records để hiển thị nhanh
      }
    });
    return { report };
  }
}