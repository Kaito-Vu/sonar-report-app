import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { BaseService } from '../common/services/base.service';
import { PaginationUtil } from '../common/utils/pagination.util';
import { StatisticsService } from './statistics.service';

export interface ReportDetailsOptions {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface ReportDetailsResult {
  report: any;
  issues: any[];
  stats: any;
  sort: {
    by: string;
    order: 'asc' | 'desc';
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasPrev: boolean;
    hasNext: boolean;
    prevPage: number | null;
    nextPage: number | null;
    pageSizeOptions: Array<{ value: number; selected: boolean }>;
  };
}

@Injectable()
export class ReportService extends BaseService {
  constructor(
    prisma: PrismaService,
    private statisticsService: StatisticsService,
  ) {
    super('ReportService', prisma);
  }

  /**
   * Get report details with paginated issues
   */
  async getReportDetails(
    reportId: string,
    options: ReportDetailsOptions = {},
  ): Promise<ReportDetailsResult> {
    this.logStart('getReportDetails', { reportId, ...options });

    const {
      page = 1,
      pageSize = 50,
      sortBy = 'default',
      sortOrder = 'asc',
    } = options;

    // Normalize pagination
    const normalized = PaginationUtil.normalize({
      page: Math.max(1, page),
      pageSize: Math.max(10, Math.min(pageSize, 500)),
    });

    // Get report with project
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: { project: true },
    });

    if (!report) {
      throw new NotFoundException(`Report with ID ${reportId} not found`);
    }

    // Get statistics
    const stats = await this.statisticsService.getStatistics(reportId);

    // Build orderBy clause
    const orderBy = this.buildOrderBy(sortBy, sortOrder);

    // Get issues with pagination
    const [total, issues] = await this.prisma.$transaction([
      this.prisma.issue.count({ where: { reportId } }),
      this.prisma.issue.findMany({
        where: { reportId },
        skip: normalized.skip,
        take: normalized.take,
        orderBy,
      }),
    ]);

    // Create pagination metadata
    const paginationMeta = PaginationUtil.createMetadata(
      normalized.page,
      normalized.pageSize,
      total,
    );

    this.logSuccess('getReportDetails', {
      reportId,
      issuesCount: issues.length,
      total,
    });

    return {
      report,
      issues,
      stats,
      sort: { by: sortBy, order: sortOrder },
      pagination: {
        ...paginationMeta,
        pageSizeOptions: PaginationUtil.generatePageSizeOptions(
          normalized.pageSize,
        ),
      },
    };
  }

  /**
   * Soft delete a report
   */
  async softDeleteReport(reportId: string) {
    this.logStart('softDeleteReport', { reportId });

    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new NotFoundException(`Report with ID ${reportId} not found`);
    }

    await this.prisma.report.update({
      where: { id: reportId },
      data: { status: 'DELETED' },
    });

    this.logSuccess('softDeleteReport', { reportId });
  }

  /**
   * Build orderBy clause based on sort parameters
   */
  private buildOrderBy(sortBy: string, sortOrder: 'asc' | 'desc'): any {
    if (sortBy === 'default') {
      return [{ typeIdx: 'asc' }, { severityIdx: 'asc' }, { fileLine: 'asc' }];
    }

    if (sortBy === 'severity') {
      return { severityIdx: sortOrder };
    }

    if (sortBy === 'type') {
      return { typeIdx: sortOrder };
    }

    // Default: sort by the specified field
    return { [sortBy]: sortOrder };
  }
}
