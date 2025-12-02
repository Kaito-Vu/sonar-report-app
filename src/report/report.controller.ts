import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  Render,
  Res,
  Logger,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Response } from 'express';
import { join } from 'path';
import * as fs from 'fs-extra';
import * as handlebars from 'handlebars';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit');

import { MinioService } from '../minio.service';
import { PrismaService } from '../prisma.service';
import { SonarService } from '../sonar.service';

@Controller()
export class ReportController {
  private readonly logger = new Logger(ReportController.name);

  // Cấu hình Thứ tự & Màu sắc
  private readonly TYPE_ORDER = [
    'VULNERABILITY',
    'SECURITY_HOTSPOT',
    'BUG',
    'CODE_SMELL',
  ];
  private readonly SEVERITY_ORDER = [
    'BLOCKER',
    'CRITICAL',
    'MAJOR',
    'MINOR',
    'INFO',
  ];

  private readonly TYPE_CONFIG = [
    { key: 'VULNERABILITY', color: '#ea580c', label: 'VULNERABILITY' },
    { key: 'SECURITY_HOTSPOT', color: '#7c3aed', label: 'SECURITY HOTSPOT' },
    { key: 'BUG', color: '#dc2626', label: 'BUG' },
    { key: 'CODE_SMELL', color: '#2563eb', label: 'CODE SMELL' },
  ];

  private readonly SEVERITY_CONFIG = [
    { key: 'BLOCKER', color: '#dc2626', label: 'BLOCKER' },
    { key: 'CRITICAL', color: '#ea580c', label: 'CRITICAL' },
    { key: 'MAJOR', color: '#be185d', label: 'MAJOR' },
    { key: 'MINOR', color: '#000000', label: 'MINOR' },
    { key: 'INFO', color: '#6b7280', label: 'INFO' },
  ];

  constructor(
    @InjectQueue('report-queue') private reportQueue: Queue,
    private minioService: MinioService,
    private prisma: PrismaService,
    private sonarService: SonarService,
  ) {}

  // --- HELPER: TÍNH TOÁN THỐNG KÊ ---
  private async getStatistics(reportId: string) {
    const [bySev, byType] = await Promise.all([
      this.prisma.issue.groupBy({
        by: ['severity'],
        where: { reportId },
        _count: { _all: true },
      }),
      this.prisma.issue.groupBy({
        by: ['type'],
        where: { reportId },
        _count: { _all: true },
      }),
    ]);

    const statsType = this.TYPE_CONFIG.map((cfg) => {
      const found = byType.find((i) => i.type === cfg.key);
      return { ...cfg, count: found ? found._count._all : 0 };
    });

    const statsSeverity = this.SEVERITY_CONFIG.map((cfg) => {
      const found = bySev.find((i) => i.severity === cfg.key);
      return { ...cfg, count: found ? found._count._all : 0 };
    });

    return { byType: statsType, bySeverity: statsSeverity };
  }

  private breakLongText(text: string | null): string {
    if (!text) return '';
    return text.replace(/([/._:,-])/g, '$1\u200B');
  }

  // ==================================================================
  // 1. TRANG CHỦ (DASHBOARD & PROJECT LIST)
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
          where: { status: { not: 'DELETED' } },
        },
      },
    });

    const projectsView = projects.map((p) => ({
      id: p.id,
      name: p.name,
      key: p.key,
      lastScan: p.reports[0]
        ? p.reports[0].analysisDate?.toLocaleString('vi-VN') ||
          p.reports[0].createdAt.toLocaleString('vi-VN')
        : 'Chưa có',
      lastStatus: p.reports[0] ? p.reports[0].status : null,
    }));

    // Analytics data
    const totalProjects = projects.length;
    const totalReports = await this.prisma.report.count({
      where: { status: { not: 'DELETED' } },
    });
    const totalIssues = await this.prisma.issue.count();
    const completedReports = await this.prisma.report.count({
      where: { status: 'COMPLETED' },
    });
    const processingReports = await this.prisma.report.count({
      where: { status: { in: ['QUEUED', 'PROCESSING'] } },
    });

    return {
      projects: projectsView,
      analytics: {
        totalProjects,
        totalReports,
        totalIssues,
        completedReports,
        processingReports,
      },
    };
  }

  @Post('projects')
  async createProject(
    @Body() body: { name: string; key: string },
    @Res() res: Response,
  ) {
    try {
      if (!body.name || !body.key) throw new Error('Missing info');
      await this.prisma.project.create({
        data: { name: body.name, key: body.key.trim() },
      });
      return res.redirect('/');
    } catch (error) {
      this.logger.error(error.message);
      return res.redirect('/');
    }
  }

  @Post('projects/delete')
  async deleteProject(@Body() body: { id: string }, @Res() res: Response) {
    try {
      await this.prisma.$transaction([
        this.prisma.issue.deleteMany({
          where: { report: { projectId: parseInt(body.id) } },
        }),
        this.prisma.report.deleteMany({
          where: { projectId: parseInt(body.id) },
        }),
        this.prisma.project.delete({ where: { id: parseInt(body.id) } }),
      ]);
    } catch {
      // Ignore deletion errors
    }
    return res.redirect('/');
  }

  // ==================================================================
  // 2. CHI TIẾT DỰ ÁN (SCAN HISTORY & MAPPING)
  // ==================================================================
  @Get('project/:id')
  @Render('project_history')
  async viewProject(@Param('id') id: string) {
    const projectId = parseInt(id);
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) return { error: 'Project not found' };

    let sonarAnalyses = [];
    let apiError = null;

    try {
      sonarAnalyses = await this.sonarService.getProjectAnalyses(
        project.key.trim(),
      );
    } catch (error: any) {
      apiError = error?.message || 'Error fetching analyses';
    }

    const localReports = await this.prisma.report.findMany({
      where: { projectId: projectId, status: { not: 'DELETED' } },
    });

    const history = sonarAnalyses.map((scan) => {
      const local = localReports.find(
        (r) => r.analysisKey && r.analysisKey.trim() === scan.key.trim(),
      );
      return {
        analysisKey: scan.key,
        date: new Date(scan.date).toLocaleString('vi-VN'),
        rawDate: scan.date,
        version: scan.projectVersion || '-',
        isSynced: !!local,
        localReportId: local ? local.id : null,
        status: local ? local.status : 'NOT_IMPORTED',
        filename: local ? local.filename : null,
        timestamp: new Date(scan.date).getTime(),
      };
    });

    const manualReports = localReports
      .filter((r) => !r.analysisKey)
      .map((r) => ({
        analysisKey: 'MANUAL',
        date: new Date(r.createdAt).toLocaleString('vi-VN'),
        rawDate: r.createdAt,
        version: 'Manual Upload',
        isSynced: true,
        localReportId: r.id,
        status: r.status,
        filename: r.filename,
        timestamp: new Date(r.createdAt).getTime(),
      }));

    const finalHistory = [...history, ...manualReports].sort(
      (a, b) => b.timestamp - a.timestamp,
    );
    if (finalHistory.length > 0) (finalHistory[0] as any).isLatest = true;

    return { project, reports: finalHistory, apiError };
  }

  @Get('api/project/:id/status')
  async getProjectStatus(@Param('id') id: string) {
    const projectId = parseInt(id);
    const reports = await this.prisma.report.findMany({
      where: {
        projectId,
        status: { in: ['QUEUED', 'PROCESSING'] },
      },
      select: {
        id: true,
        status: true,
      },
    });

    return {
      hasProcessing: reports.length > 0,
      reports: reports.map((r) => ({ id: r.id, status: r.status })),
    };
  }

  @Get('api/project/:id/reports')
  async getProjectReportsAPI(@Param('id') _id: string) {
    return { success: true };
  }

  // ==================================================================
  // 3. CHI TIẾT BÁO CÁO (DANH SÁCH LỖI)
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

    const report = await this.prisma.report.findUnique({
      where: { id },
      include: { project: true },
    });
    if (!report) return { error: 'Report not found' };

    const stats = await this.getStatistics(id);

    let orderBy: any = {};
    if (sortBy === 'default') {
      orderBy = [
        { typeIdx: 'asc' },
        { severityIdx: 'asc' },
        { fileLine: 'asc' },
      ];
    } else if (sortBy === 'severity') {
      orderBy = { severityIdx: sortOrder };
    } else if (sortBy === 'type') {
      orderBy = { typeIdx: sortOrder };
    } else {
      orderBy = { [sortBy]: sortOrder };
    }

    const [total, issues] = await this.prisma.$transaction([
      this.prisma.issue.count({ where: { reportId: id } }),
      this.prisma.issue.findMany({
        where: { reportId: id },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: orderBy,
      }),
    ]);

    const totalPages = Math.ceil(total / pageSize);

    // Get previous report for comparison
    let previousReport = null;
    let comparison = null;
    let newIssuesCount = 0;
    const newIssues: any[] = [];

    if (report.projectId) {
      previousReport = await this.prisma.report.findFirst({
        where: {
          projectId: report.projectId,
          status: 'COMPLETED',
          createdAt: { lt: report.createdAt },
        },
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { issues: true } } },
      });

      if (previousReport) {
        // Get all previous issues to compare
        const previousIssues = await this.prisma.issue.findMany({
          where: { reportId: previousReport.id },
          select: { ruleKey: true, fileName: true, fileLine: true },
        });

        // Create a Set of issue signatures from previous report for fast lookup
        const prevIssueSignatures = new Set(
          previousIssues.map(
            (issue) => `${issue.ruleKey}|${issue.fileName}|${issue.fileLine}`,
          ),
        );

        // Mark new issues and count them
        const issuesWithNewFlag = issues.map((issue) => {
          const signature = `${issue.ruleKey}|${issue.fileName}|${issue.fileLine}`;
          const isNew = !prevIssueSignatures.has(signature);
          if (isNew) {
            newIssuesCount++;
            newIssues.push({ ...issue, isNew: true });
          }
          return { ...issue, isNew };
        });

        // Replace issues array with marked issues
        issues.length = 0;
        issues.push(...issuesWithNewFlag);

        const prevStats = await this.getStatistics(previousReport.id);
        comparison = {
          previousReportId: previousReport.id,
          previousDate: previousReport.createdAt,
          previousTotal: previousReport._count.issues,
          currentTotal: total,
          diff: total - previousReport._count.issues,
          newIssuesCount: newIssuesCount,
          diffPercent:
            previousReport._count.issues > 0
              ? (
                  ((total - previousReport._count.issues) /
                    previousReport._count.issues) *
                  100
                ).toFixed(1)
              : '0',
          byType: stats.byType.map((current: any) => {
            const prev = prevStats.byType.find(
              (p: any) => p.key === current.key,
            );
            return {
              ...current,
              previousCount: prev?.count || 0,
              diff: current.count - (prev?.count || 0),
            };
          }),
          bySeverity: stats.bySeverity.map((current: any) => {
            const prev = prevStats.bySeverity.find(
              (p: any) => p.key === current.key,
            );
            return {
              ...current,
              previousCount: prev?.count || 0,
              diff: current.count - (prev?.count || 0),
            };
          }),
        };
      }
    }

    return {
      report,
      issues,
      stats,
      comparison,
      sort: { by: sortBy, order: sortOrder },
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
        prevPage: page - 1,
        nextPage: page + 1,
        pageSizeOptions: [10, 20, 50, 100, 200].map((v) => ({
          value: v,
          selected: v === pageSize,
        })),
      },
    };
  }

  // ==================================================================
  // 4. SYNC LOGIC (AUTO & SPECIFIC)
  // ==================================================================

  // Helper chung cho việc tải và tạo job
  private async processDownload(project: any, analysis: any) {
    try {
      this.logger.log(`Downloading report for project: ${project.key}`);
      const fileBuffer = await this.sonarService.downloadReport(
        project.key.trim(),
      );

      const fileName = `SYNC_${analysis.key.substring(0, 8)}_${new Date(analysis.date).toISOString().split('T')[0]}.zip`;
      const fileKey = `${Date.now()}.zip`;

      this.logger.log(`Uploading to MinIO: ${fileKey}`);
      await this.minioService.uploadFile(fileKey, fileBuffer);

      this.logger.log(`Creating report record in database`);
      const report = await this.prisma.report.create({
        data: {
          filename: fileName,
          status: 'QUEUED',
          projectId: project.id,
          analysisKey: analysis.key,
          analysisDate: new Date(analysis.date),
          projectVersion: analysis.projectVersion,
        },
      });

      this.logger.log(`Adding job to queue for report: ${report.id}`);
      await this.reportQueue.add('process-zip', {
        reportId: report.id,
        fileKey,
        originalName: fileName,
      });

      this.logger.log(`Successfully queued report processing: ${report.id}`);
    } catch (error: any) {
      this.logger.error(`Error in processDownload:`, error);
      throw error;
    }
  }

  // 4a. Sync Mới Nhất
  @Post('projects/:id/sync')
  async syncProject(@Param('id') id: string, @Res() res: Response) {
    try {
      const projectId = parseInt(id);
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
      });
      if (!project)
        return res
          .status(404)
          .json({ success: false, message: 'Project not found' });

      const sonarKey = project.key.trim();
      const latestAnalysis =
        await this.sonarService.getLatestAnalysis(sonarKey);
      if (!latestAnalysis)
        return res
          .status(400)
          .json({ success: false, message: 'Không tìm thấy scan nào.' });

      // Check for any existing report with this analysisKey (including DELETED ones)
      const existingReport = await this.prisma.report.findFirst({
        where: {
          projectId: projectId,
          analysisKey: latestAnalysis.key,
        },
      });

      if (existingReport) {
        if (existingReport.status === 'COMPLETED') {
          return res.json({
            success: true,
            action: 'REDIRECT',
            reportId: existingReport.id,
            message: 'Đã có kết quả.',
          });
        } else if (['QUEUED', 'PROCESSING'].includes(existingReport.status)) {
          return res.json({
            success: true,
            action: 'RELOAD',
            message: 'Đang xử lý...',
          });
        } else {
          // Delete the old report (including DELETED status) to avoid unique constraint violation
          this.logger.log(`Deleting old report ${existingReport.id} with status ${existingReport.status}`);
          await this.prisma.issue.deleteMany({
            where: { reportId: existingReport.id },
          });
          await this.prisma.report.delete({ where: { id: existingReport.id } });
        }
      }

      await this.processDownload(project, latestAnalysis);
      return res.json({
        success: true,
        action: 'RELOAD',
        message: 'Đã bắt đầu đồng bộ!',
      });
    } catch (error: any) {
      this.logger.error('Sync error:', error);
      const errorMessage = error?.message || String(error);
      return res.status(500).json({
        success: false,
        message: `Lỗi đồng bộ: ${errorMessage}`
      });
    }
  }

  // 4b. Sync Cụ Thể (Theo Key)
  @Post('projects/:id/sync-analysis')
  async syncSpecificAnalysis(
    @Param('id') id: string,
    @Body() body: { analysisKey: string; date: string },
    @Res() res: Response,
  ) {
    try {
      const projectId = parseInt(id);
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
      });
      if (!project)
        return res.status(404).json({ message: 'Project not found' });

      const analysis = {
        key: body.analysisKey,
        date: body.date,
        projectVersion: 'Specific',
      };

      // Check for any existing report (including DELETED ones)
      const existing = await this.prisma.report.findFirst({
        where: {
          analysisKey: analysis.key,
          projectId: projectId,
        },
      });

      if (existing) {
        if (existing.status === 'COMPLETED')
          return res.json({
            success: true,
            action: 'REDIRECT',
            reportId: existing.id,
          });
        if (['QUEUED', 'PROCESSING'].includes(existing.status))
          return res.json({ success: true, action: 'RELOAD' });

        // Delete old report (FAILED or DELETED) to avoid unique constraint
        this.logger.log(`Deleting old report ${existing.id} with status ${existing.status}`);
        await this.prisma.issue.deleteMany({
          where: { reportId: existing.id },
        });
        await this.prisma.report.delete({ where: { id: existing.id } });
      }

      await this.processDownload(project, analysis);
      return res.json({
        success: true,
        action: 'RELOAD',
        message: 'Đang tải...',
      });
    } catch (error: any) {
      this.logger.error('Sync specific analysis error:', error);
      const errorMessage = error?.message || String(error);
      return res.status(500).json({
        success: false,
        message: `Lỗi đồng bộ: ${errorMessage}`
      });
    }
  }

  // ==================================================================
  // 5. EXPORT (HTML & PDF STREAMING)
  // ==================================================================
  @Get('report/:id/export')
  async exportReport(
    @Param('id') id: string,
    @Query('type') type: 'html' | 'pdf',
    @Res() res: Response,
  ) {
    const report = await this.prisma.report.findUnique({
      where: { id },
      select: {
        filename: true,
        project: { select: { name: true, key: true } },
      },
    });
    if (!report) return res.status(404).send('Report not found');

    const stats = await this.getStatistics(id);
    // Query sắp xếp chuẩn (Type -> Severity)
    const issuesQuery = {
      where: { reportId: id },
      orderBy: [
        { typeIdx: 'asc' as const },
        { severityIdx: 'asc' as const },
        { fileLine: 'asc' as const },
      ],
    };

    // --- HTML ---
    if (type === 'html') {
      let cssContent = '';
      try {
        cssContent = await fs.readFile(
          join(process.cwd(), 'public', 'css', 'styles.css'),
          'utf8',
        );
      } catch {
        // CSS file not found, continue without styles
      }
      const issues = await this.prisma.issue.findMany(issuesQuery);
      const templateSource = await fs.readFile(
        join(process.cwd(), 'views', 'export.hbs'),
        'utf8',
      );
      handlebars.registerHelper('eq', (a, b) => a === b);
      const template = handlebars.compile(templateSource);
      const html = template({
        report,
        issues,
        stats,
        cssContent,
        now: new Date().toLocaleString('vi-VN'),
      });
      res.setHeader('Content-Type', 'text/html');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(report.filename)}.html`,
      );
      return res.send(html);
    }

    // --- PDF (STREAMING) ---
    else if (type === 'pdf') {
      const encodedFilename = encodeURIComponent(
        `report-${report.filename}.pdf`,
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodedFilename}`,
      );

      const doc = new PDFDocument({
        margin: 30,
        size: 'A4',
        layout: 'landscape',
        bufferPages: false,
      });
      doc.pipe(res);

      const fontRegular = path.join(
        process.cwd(),
        'fonts',
        'Roboto-Regular.ttf',
      );
      const fontBold = path.join(process.cwd(), 'fonts', 'Roboto-Medium.ttf');
      const fontItalic = path.join(process.cwd(), 'fonts', 'Roboto-Italic.ttf');
      try {
        doc.font(fontRegular);
      } catch {
        // Font not found, use default
      }

      doc
        .fontSize(16)
        .font(fontBold)
        .text('BÁO CÁO REGULATION REPORT', { align: 'center' });
      doc.moveDown(0.5);
      doc
        .fontSize(10)
        .font(fontRegular)
        .text(`File: ${report.filename}`)
        .text(`Dự án: ${report.project?.name}`)
        .moveDown();

      // VẼ BẢNG THỐNG KÊ (SUMMARY TABLES)
      doc
        .font(fontBold)
        .fontSize(12)
        .text('1. THỐNG KÊ (STATISTICS)', { underline: true });
      doc.moveDown(0.5);
      const summaryY = doc.y;
      const col1X = 30;
      const col2X = 350;
      const tableWidth = 280;
      doc.font(fontBold).fontSize(10).fillColor('#000');
      doc.text('Bảng 1: Theo Loại (Type)', col1X, summaryY);
      doc.text('Bảng 2: Theo Mức độ (Severity)', col2X, summaryY);

      let y1 = summaryY + 20;
      stats.byType.forEach((item) => {
        doc.rect(col1X, y1, tableWidth, 20).fill('#f9fafb').stroke();
        doc
          .fillColor(item.color)
          .font(fontBold)
          .text(item.label, col1X + 5, y1 + 5);
        doc
          .fillColor('#000')
          .font(fontRegular)
          .text(item.count.toString(), col1X + 220, y1 + 5);
        y1 += 20;
      });

      let y2 = summaryY + 20;
      stats.bySeverity.forEach((item) => {
        doc.rect(col2X, y2, tableWidth, 20).fill('#f9fafb').stroke();
        doc
          .fillColor(item.color)
          .font(fontBold)
          .text(item.label, col2X + 5, y2 + 5);
        doc
          .fillColor('#000')
          .font(fontRegular)
          .text(item.count.toString(), col2X + 220, y2 + 5);
        y2 += 20;
      });
      doc.y = Math.max(y1, y2) + 20;

      // VẼ CHI TIẾT (DETAILS TABLE)
      doc
        .fillColor('#000')
        .font(fontBold)
        .fontSize(12)
        .text('2. CHI TIẾT (DETAILS)', 30, doc.y, { underline: true });
      doc.moveDown(0.5);
      const startX = 30;
      const cols = [
        { x: 30, w: 80, h: 'Type' },
        { x: 115, w: 60, h: 'Mức độ' },
        { x: 180, w: 140, h: 'Rule Info' },
        { x: 325, w: 200, h: 'File Path' },
        { x: 530, w: 30, h: 'Line' },
        { x: 565, w: 210, h: 'Message' },
      ];
      let y = doc.y;
      const drawHeader = () => {
        doc.rect(startX, y, 780, 25).fill('#1f2937').stroke();
        doc.fillColor('#fff').font(fontBold).fontSize(9);
        cols.forEach((c) => doc.text(c.h, c.x + 5, y + 8, { width: c.w }));
        y += 25;
        doc.font(fontRegular).fillColor('#000');
      };
      drawHeader();

      const BATCH_SIZE = 1000;
      let cursor: number | undefined;
      let hasMore = true;

      while (hasMore) {
        const issues = await this.prisma.issue.findMany({
          ...issuesQuery,
          take: BATCH_SIZE,
          skip: cursor ? 1 : 0,
          cursor: cursor ? { id: cursor } : undefined,
          select: {
            id: true,
            type: true,
            severity: true,
            ruleKey: true,
            ruleName: true,
            fileName: true,
            fileLine: true,
            message: true,
          },
        });
        if (issues.length === 0) {
          hasMore = false;
          break;
        }

        for (const issue of issues) {
          const msgH = doc.heightOfString(issue.message || '', {
            width: cols[5].w,
          });
          const fileH = doc.heightOfString(
            this.breakLongText(issue.fileName) || '',
            { width: cols[3].w },
          );
          const ruleH =
            doc.heightOfString(issue.ruleName || '', { width: cols[2].w }) +
            doc.heightOfString(this.breakLongText(issue.ruleKey) || '', {
              width: cols[2].w,
            }) +
            5;
          const rowHeight = Math.max(msgH, fileH, ruleH, 15) + 12;

          if (y + rowHeight > doc.page.height - 30) {
            doc.addPage();
            y = 30;
            drawHeader();
          }

          // Type
          let tColor = '#2563eb';
          if (issue.type === 'VULNERABILITY') tColor = '#ea580c';
          else if (issue.type === 'BUG') tColor = '#dc2626';
          else if (issue.type === 'SECURITY_HOTSPOT') tColor = '#7c3aed';
          doc
            .fillColor(tColor)
            .font(fontBold)
            .fontSize(8)
            .text(issue.type, cols[0].x + 5, y + 4, { width: cols[0].w });

          // Severity
          let sColor = '#000';
          if (issue.severity === 'BLOCKER') sColor = '#dc2626';
          else if (issue.severity === 'CRITICAL') sColor = '#ea580c';
          doc
            .fillColor(sColor)
            .text(issue.severity, cols[1].x + 5, y + 4, { width: cols[1].w });

          // Rule
          doc
            .fillColor('#000')
            .text(issue.ruleName || '', cols[2].x + 5, y + 4, {
              width: cols[2].w,
            });
          doc
            .font(fontItalic)
            .fontSize(7)
            .fillColor('#666')
            .text(this.breakLongText(issue.ruleKey), cols[2].x + 5, doc.y, {
              width: cols[2].w,
            });

          // File/Line/Msg
          doc
            .font(fontRegular)
            .fontSize(8)
            .fillColor('#333')
            .text(this.breakLongText(issue.fileName), cols[3].x + 5, y + 4, {
              width: cols[3].w,
            });
          doc
            .fillColor('#000')
            .fontSize(9)
            .text(
              issue.fileLine ? issue.fileLine.toString() : '-',
              cols[4].x,
              y + 4,
              { width: cols[4].w, align: 'center' },
            );
          doc.text(issue.message || '', cols[5].x + 5, y + 4, {
            width: cols[5].w,
          });

          doc
            .moveTo(startX, y + rowHeight)
            .lineTo(startX + 780, y + rowHeight)
            .lineWidth(0.5)
            .strokeColor('#e5e7eb')
            .stroke();
          y += rowHeight;
        }
        cursor = issues[issues.length - 1].id;
        if (global.gc) {
          global.gc();
        }
      }
      doc.end();
    } else {
      return res.status(400).send('Invalid export type');
    }
  }

  // --- API PROXY ---
  @Post('upload') async upload(@Body() _b, @Res() r) {
    // Upload functionality placeholder
    return r.redirect('/');
  }
  @Delete('api/report/:id') async softDeleteReport(@Param('id') id, @Res() r) {
    try {
      await this.prisma.report.update({
        where: { id },
        data: { status: 'DELETED' },
      });
      return r.status(200).json({ message: 'Deleted' });
    } catch {
      return r.status(500).json({ message: 'Error' });
    }
  }
  @Get('settings') @Render('settings') async settings() {
    return { config: await this.prisma.sonarConfig.findFirst() };
  }
  @Post('settings') async saveSettings(@Body() b, @Res() r) {
    await this.prisma.sonarConfig.deleteMany();
    await this.prisma.sonarConfig.create({
      data: { url: b.url.replace(/\/$/, ''), token: b.token },
    });
    return r.redirect('/settings?saved=1');
  }
  @Get('api/rule-details') async getRule(@Query('key') k) {
    return (await this.sonarService.getRuleDetails(k)) || {};
  }
  @Get('api/source-code') async getCode(
    @Query('project') p,
    @Query('file') f,
    @Query('line') l,
  ) {
    return {
      snippet: await this.sonarService.getSourceSnippet(p, f, parseInt(l)),
    };
  }
}
