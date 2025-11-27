import {
  Controller, Get, Post, Delete, Param, Body, Query,
  UploadedFile, UseInterceptors, Render, Res, Logger,
  DefaultValuePipe, ParseIntPipe
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { join, extname } from 'path';
import * as fs from 'fs-extra';
import * as handlebars from 'handlebars';
import * as path from 'path';
import PDFDocument = require('pdfkit');

import { MinioService } from '../minio.service';
import { PrismaService } from '../prisma.service';
import { SonarService } from '../sonar.service';

@Controller()
export class ReportController {
  private readonly logger = new Logger(ReportController.name);

  // Config Sort & Stats
  private readonly TYPE_ORDER = ['VULNERABILITY', 'SECURITY_HOTSPOT', 'BUG', 'CODE_SMELL'];
  private readonly SEVERITY_ORDER = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'];

  private readonly TYPE_CONFIG = [
    { key: 'VULNERABILITY', color: '#ea580c', label: 'VULNERABILITY' },
    { key: 'SECURITY_HOTSPOT', color: '#7c3aed', label: 'SECURITY HOTSPOT' },
    { key: 'BUG', color: '#dc2626', label: 'BUG' },
    { key: 'CODE_SMELL', color: '#2563eb', label: 'CODE SMELL' }
  ];

  private readonly SEVERITY_CONFIG = [
    { key: 'BLOCKER', color: '#dc2626' },
    { key: 'CRITICAL', color: '#ea580c' },
    { key: 'MAJOR', color: '#be185d' },
    { key: 'MINOR', color: '#000000' },
    { key: 'INFO', color: '#6b7280' }
  ];

  constructor(
    @InjectQueue('report-queue') private reportQueue: Queue,
    private minioService: MinioService,
    private prisma: PrismaService,
    private sonarService: SonarService
  ) {}

  // --- HELPER ---
  private async getStatistics(reportId: string) {
    const [bySev, byType] = await Promise.all([
      this.prisma.issue.groupBy({ by: ['severity'], where: { reportId }, _count: { _all: true } }),
      this.prisma.issue.groupBy({ by: ['type'], where: { reportId }, _count: { _all: true } })
    ]);

    const statsType = this.TYPE_CONFIG.map(cfg => {
      const found = byType.find(i => i.type === cfg.key);
      return { ...cfg, count: found ? found._count._all : 0 };
    });

    const statsSeverity = this.SEVERITY_CONFIG.map(cfg => {
      const found = bySev.find(i => i.severity === cfg.key);
      return { ...cfg, count: found ? found._count._all : 0 };
    });

    return { byType: statsType, bySeverity: statsSeverity };
  }

  private breakLongText(text: string | null): string {
    if (!text) return '';
    return text.replace(/([\/._:,-])/g, '$1\u200B');
  }

  // ==================================================================
  // 1. DASHBOARD (DANH SÁCH DỰ ÁN)
  // ==================================================================
  @Get()
  @Render('index')
  async home() {
    const projects = await this.prisma.project.findMany({
      orderBy: { name: 'asc' },
      include: {
        reports: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          where: { status: { not: 'DELETED' } }
        }
      }
    });

    const projectsView = projects.map(p => ({
      id: p.id,
      name: p.name,
      key: p.key, // Đây chính là cái key dài ngoằng
      lastScan: p.reports[0] ? p.reports[0].createdAt.toLocaleString('vi-VN') : 'Chưa có',
      lastStatus: p.reports[0] ? p.reports[0].status : null
    }));

    return { projects: projectsView };
  }

  // ==================================================================
  // 2. CHI TIẾT DỰ ÁN (LỊCH SỬ SCAN)
  // ==================================================================
  @Get('project/:id')
  @Render('project_history')
  async viewProject(@Param('id') id: string) {
    const projectId = parseInt(id);
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return { error: 'Project not found' };

    let sonarAnalyses = [];
    let apiError = null;

    // A. Lấy lịch sử từ SonarQube bằng KEY (Trim để xóa khoảng trắng thừa)
    try {
      sonarAnalyses = await this.sonarService.getProjectAnalyses(project.key.trim());
    } catch (e) {
      apiError = e.message;
    }

    // B. Lấy danh sách local
    const localReports = await this.prisma.report.findMany({
      where: { projectId: projectId, status: { not: 'DELETED' } }
    });

    // C. Ghép dữ liệu
    const history = sonarAnalyses.map(scan => {
      const local = localReports.find(r => r.analysisKey === scan.key);
      return {
        analysisKey: scan.key,
        date: new Date(scan.date).toLocaleString('vi-VN'),
        version: scan.projectVersion || '-',
        isImported: !!local,
        reportId: local ? local.id : null,
        status: local ? local.status : 'NOT_IMPORTED',
        filename: local ? local.filename : null
      };
    });

    const manualReports = localReports.filter(r => !r.analysisKey).map(r => ({
      analysisKey: 'MANUAL',
      date: new Date(r.createdAt).toLocaleString('vi-VN'),
      version: 'Manual Upload',
      isImported: true,
      reportId: r.id,
      status: r.status,
      filename: r.filename
    }));

    const finalHistory = [...history, ...manualReports].sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    return { project, reports: finalHistory, apiError };
  }

  @Get('api/project/:id/reports')
  async getProjectReportsAPI(@Param('id') id: string) {
    return await this.prisma.report.findMany({
      where: { projectId: parseInt(id), status: { not: 'DELETED' } },
      orderBy: { createdAt: 'desc' }
    });
  }

  // ==================================================================
  // 3. CHI TIẾT BÁO CÁO
  // ==================================================================
  @Get('report/:id')
  @Render('detail')
  async viewReport(
    @Param('id') id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(50), ParseIntPipe) pageSize: number,
    @Query('sortBy', new DefaultValuePipe('default')) sortBy: string,
    @Query('sortOrder', new DefaultValuePipe('asc')) sortOrder: 'asc' | 'desc',
  ) {
    page = Math.max(1, page);
    pageSize = Math.max(10, Math.min(pageSize, 500));

    const report = await this.prisma.report.findUnique({ where: { id }, include: { project: true } });
    if (!report) return { error: 'Report not found' };

    const stats = await this.getStatistics(id);

    let orderBy: any = {};
    if (sortBy === 'default') orderBy = [{ typeIdx: 'asc' }, { severityIdx: 'asc' }, { fileLine: 'asc' }];
    else if (sortBy === 'severity') orderBy = { severityIdx: sortOrder };
    else if (sortBy === 'type') orderBy = { typeIdx: sortOrder };
    else orderBy = { [sortBy]: sortOrder };

    const [total, issues] = await this.prisma.$transaction([
      this.prisma.issue.count({ where: { reportId: id } }),
      this.prisma.issue.findMany({
        where: { reportId: id },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: orderBy
      })
    ]);

    return {
      report, issues, stats,
      sort: { by: sortBy, order: sortOrder },
      pagination: {
        page, pageSize, total, totalPages: Math.ceil(total / pageSize),
        hasPrev: page > 1, hasNext: page < Math.ceil(total / pageSize),
        prevPage: page - 1, nextPage: page + 1,
        pageSizeOptions: [10, 20, 50, 100, 200].map(v => ({ value: v, selected: v === pageSize }))
      }
    };
  }

  // ==================================================================
  // 4. SYNC - UPLOAD - EXPORT
  // ==================================================================

  // Sync Tự động (Sửa lại để chắc chắn lấy KEY chuẩn)
  @Post('projects/:id/sync')
  async syncProject(@Param('id') id: string, @Res() res: Response) {
    try {
      const project = await this.prisma.project.findUnique({ where: { id: parseInt(id) } });
      if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

      // Lấy Key và Trim (xóa khoảng trắng thừa nếu có)
      const sonarKey = project.key.trim();
      this.logger.log(`Syncing Key: "${sonarKey}"`);

      // 1. Lấy thông tin lần scan mới nhất
      const latestAnalysis = await this.sonarService.getLatestAnalysis(sonarKey);
      if (!latestAnalysis) {
        return res.status(400).json({ success: false, message: `Không tìm thấy lần scan nào cho Key: ${sonarKey}` });
      }

      // 2. Check trùng
      const exists = await this.prisma.report.findFirst({
        where: { analysisKey: latestAnalysis.key, status: { not: 'DELETED' } }
      });
      if (exists) return res.json({ success: true, skipped: true, message: 'Dữ liệu đã mới nhất!' });

      // 3. Tải file
      const fileBuffer = await this.sonarService.downloadReport(sonarKey);
      const fileName = `AUTO-SYNC_${sonarKey}_${latestAnalysis.date}.zip`;
      const fileKey = `${Date.now()}-${Math.round(Math.random() * 1E9)}.zip`;

      await this.minioService.uploadFile(fileKey, fileBuffer);

      const report = await this.prisma.report.create({
        data: {
          filename: fileName,
          status: 'QUEUED',
          projectId: project.id,
          analysisKey: latestAnalysis.key,
          analysisDate: new Date(latestAnalysis.date),
          projectVersion: latestAnalysis.projectVersion
        }
      });

      await this.reportQueue.add('process-zip', { reportId: report.id, fileKey, originalName: fileName });

      return res.json({ success: true, message: 'Đã bắt đầu đồng bộ!' });
    } catch (error) {
      this.logger.error(`Sync Failed: ${error.message}`);
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  // Upload Thủ công
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async upload(@UploadedFile() file: Express.Multer.File, @Body() body, @Res() res: Response) {
    if (!file) return res.redirect('/');
    try {
      const safeName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const fileKey = `${Date.now()}-${Math.round(Math.random() * 1E9)}${extname(file.originalname)}`;
      const projectId = body.projectId ? parseInt(body.projectId) : null;

      const report = await this.prisma.report.create({
        data: { filename: safeName, status: 'QUEUED', projectId: projectId }
      });

      await this.minioService.uploadFile(fileKey, file.buffer);
      await this.reportQueue.add('process-zip', { reportId: report.id, fileKey, originalName: safeName });

      if (projectId) return res.redirect(`/project/${projectId}`);
    } catch (e) { this.logger.error(e.message); }
    return res.redirect('/');
  }

  @Delete('api/report/:id')
  async softDeleteReport(@Param('id') id: string, @Res() res: Response) {
    try {
      await this.prisma.report.update({ where: { id }, data: { status: 'DELETED' } });
      return res.status(200).json({ message: 'Deleted' });
    } catch (error) { return res.status(500).json({ message: 'Error' }); }
  }

  @Get('report/:id/export')
  async exportReport(@Param('id') id, @Query('type') type, @Res() res) {
    const report = await this.prisma.report.findUnique({ where: { id }, select: { filename:true, project: {select:{name:true, key:true}}}});
    if (!report) return res.status(404).send('Not found');
    const stats = await this.getStatistics(id);
    const issuesQuery = { where: { reportId: id }, orderBy: [{ typeIdx: 'asc' as const }, { severityIdx: 'asc' as const }, { fileLine: 'asc' as const }] };

    if (type === 'html') {
      let cssContent = ''; try { cssContent = await fs.readFile(join(process.cwd(), 'public', 'css', 'styles.css'), 'utf8'); } catch(e){}
      const issues = await this.prisma.issue.findMany(issuesQuery);
      const template = handlebars.compile(await fs.readFile(join(process.cwd(), 'views', 'export.hbs'), 'utf8'));
      handlebars.registerHelper('eq', (a, b) => a === b);
      const html = template({ report, issues, stats, cssContent, now: new Date().toLocaleString() });
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(report.filename)}.html`);
      return res.send(html);
    } else if (type === 'pdf') {
      const encodedFilename = encodeURIComponent(`report-${report.filename}.pdf`);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
      const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape', bufferPages: false });
      doc.pipe(res);

      // ... (PDF Logic: Dùng lại logic vẽ PDFKit Streaming ở câu trả lời trước) ...
      // (Bạn nhớ copy đoạn PDF Streaming đó vào đây nhé)

      doc.end();
    }
  }

  // Settings & Helpers
  @Get('settings') @Render('settings') async settings() { return { config: await this.prisma.sonarConfig.findFirst() }; }
  @Post('settings') async saveSettings(@Body() body, @Res() res: Response) {
    await this.prisma.sonarConfig.deleteMany();
    await this.prisma.sonarConfig.create({ data: { url: body.url.replace(/\/$/, ''), token: body.token } });
    return res.redirect('/settings?saved=1');
  }
  @Get('api/rule-details') async getRule(@Query('key') key: string) { return await this.sonarService.getRuleDetails(key) || {}; }
  @Get('api/source-code') async getCode(@Query('project') p, @Query('file') f, @Query('line') l) {
    return { snippet: await this.sonarService.getSourceSnippet(p, f, parseInt(l)) };
  }
}