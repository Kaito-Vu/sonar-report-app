import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { join } from 'path';
import * as fs from 'fs-extra';
import * as handlebars from 'handlebars';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma.service';
import { StatisticsService } from './statistics.service';
import { DateUtil } from '../common/utils/date.util';
import { StringUtil } from '../common/utils/string.util';

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private prisma: PrismaService,
    private statisticsService: StatisticsService,
  ) {}

  async exportHtml(reportId: string, res: Response) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: {
        filename: true,
        project: { select: { name: true, key: true } },
      },
    });

    if (!report) {
      return res.status(404).send('Report not found');
    }

    const stats = await this.statisticsService.getStatistics(reportId);

    let cssContent = '';
    try {
      cssContent = await fs.readFile(
        join(process.cwd(), 'public', 'css', 'styles.css'),
        'utf8',
      );
    } catch {
      this.logger.warn('Failed to load CSS file for HTML export');
    }

    const issuesQuery = {
      where: { reportId },
      orderBy: [
        { typeIdx: 'asc' as const },
        { severityIdx: 'asc' as const },
        { fileLine: 'asc' as const },
      ],
    };

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
      now: DateUtil.formatToVietnamese(new Date()),
    });

    res.setHeader('Content-Type', 'text/html');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(report.filename)}.html`,
    );

    return res.send(html);
  }

  async exportPdf(reportId: string, res: Response) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: {
        filename: true,
        project: { select: { name: true, key: true } },
      },
    });

    if (!report) {
      return res.status(404).send('Report not found');
    }

    const stats = await this.statisticsService.getStatistics(reportId);

    const encodedFilename = encodeURIComponent(`report-${report.filename}.pdf`);
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

    const fontRegular = path.join(process.cwd(), 'fonts', 'Roboto-Regular.ttf');
    const fontBold = path.join(process.cwd(), 'fonts', 'Roboto-Medium.ttf');
    const fontItalic = path.join(process.cwd(), 'fonts', 'Roboto-Italic.ttf');

    try {
      doc.font(fontRegular);
    } catch {
      this.logger.warn('Failed to load custom font, using default');
    }

    // Header
    doc
      .fontSize(16)
      .font(fontBold)
      .text('REGULATION REPORT', { align: 'center' });
    doc.moveDown(0.5);
    doc
      .fontSize(10)
      .font(fontRegular)
      .text(`File: ${report.filename}`)
      .text(`Project: ${report.project?.name}`)
      .moveDown();

    // Statistics Tables
    this.drawStatisticsTables(doc, stats, fontBold, fontRegular);

    // Details Table
    await this.drawDetailsTable(
      doc,
      reportId,
      fontRegular,
      fontBold,
      fontItalic,
    );

    doc.end();
  }

  private drawStatisticsTables(
    doc: any,
    stats: any,
    fontBold: string,
    fontRegular: string,
  ) {
    doc.font(fontBold).fontSize(12).text('1. STATISTICS', { underline: true });
    doc.moveDown(0.5);

    const summaryY = doc.y;
    const col1X = 30;
    const col2X = 350;
    const tableWidth = 280;

    doc.font(fontBold).fontSize(10).fillColor('#000');
    doc.text('Table 1: By Type', col1X, summaryY);
    doc.text('Table 2: By Severity', col2X, summaryY);

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
  }

  private async drawDetailsTable(
    doc: any,
    reportId: string,
    fontRegular: string,
    fontBold: string,
    fontItalic: string,
  ) {
    doc
      .fillColor('#000')
      .font(fontBold)
      .fontSize(12)
      .text('2. DETAILS', 30, doc.y, { underline: true });
    doc.moveDown(0.5);

    const startX = 30;
    const cols = [
      { x: 30, w: 80, h: 'Type' },
      { x: 115, w: 60, h: 'Severity' },
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

    const issuesQuery = {
      where: { reportId },
      orderBy: [
        { typeIdx: 'asc' as const },
        { severityIdx: 'asc' as const },
        { fileLine: 'asc' as const },
      ],
    };

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
          StringUtil.breakLongText(issue.fileName) || '',
          { width: cols[3].w },
        );
        const ruleH =
          doc.heightOfString(issue.ruleName || '', { width: cols[2].w }) +
          doc.heightOfString(StringUtil.breakLongText(issue.ruleKey) || '', {
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
        doc.fillColor('#000').text(issue.ruleName || '', cols[2].x + 5, y + 4, {
          width: cols[2].w,
        });
        doc
          .font(fontItalic)
          .fontSize(7)
          .fillColor('#666')
          .text(StringUtil.breakLongText(issue.ruleKey), cols[2].x + 5, doc.y, {
            width: cols[2].w,
          });

        // File/Line/Msg
        doc
          .font(fontRegular)
          .fontSize(8)
          .fillColor('#333')
          .text(
            StringUtil.breakLongText(issue.fileName),
            cols[3].x + 5,
            y + 4,
            {
              width: cols[3].w,
            },
          );
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
  }
}
