import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { BaseService } from '../common/services/base.service';
import { DateUtil } from '../common/utils/date.util';
import { CreateProjectDto } from '../dto/create-project.dto';
import { SonarService } from '../sonar.service';

export interface ProjectWithLastScan {
  id: number;
  name: string;
  key: string;
  lastScan: string;
  lastStatus: string | null;
}

export interface ProjectHistoryItem {
  analysisKey: string;
  date: string;
  rawDate: string | Date;
  version: string;
  isSynced: boolean;
  localReportId: string | null;
  status: string;
  filename: string | null;
  timestamp: number;
  isLatest?: boolean;
}

export interface ProjectHistoryResult {
  project: any;
  reports: ProjectHistoryItem[];
  apiError: string | null;
}

@Injectable()
export class ProjectService extends BaseService {
  constructor(
    prisma: PrismaService,
    private sonarService: SonarService,
  ) {
    super('ProjectService', prisma);
  }

  /**
   * Get all projects for dashboard with last scan information
   */
  async getDashboardProjects(): Promise<ProjectWithLastScan[]> {
    this.logStart('getDashboardProjects');

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

    const projectsView: ProjectWithLastScan[] = projects.map((p) => ({
      id: p.id,
      name: p.name,
      key: p.key,
      lastScan: p.reports[0]
        ? DateUtil.formatToVietnamese(
            p.reports[0].analysisDate || p.reports[0].createdAt,
          )
        : 'Chưa có',
      lastStatus: p.reports[0] ? p.reports[0].status : null,
    }));

    this.logSuccess('getDashboardProjects', { count: projectsView.length });
    return projectsView;
  }

  /**
   * Get all projects
   */
  async getAllProjects() {
    this.logStart('getAllProjects');

    const projects = await this.prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
    });

    this.logSuccess('getAllProjects', { count: projects.length });
    return projects;
  }

  /**
   * Get project by ID
   */
  async getProjectById(id: number) {
    this.logStart('getProjectById', { id });

    const project = await this.prisma.project.findUnique({
      where: { id },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    this.logSuccess('getProjectById', { id });
    return project;
  }

  /**
   * Create a new project
   */
  async createProject(dto: CreateProjectDto) {
    this.logStart('createProject', { name: dto.name, key: dto.key });

    try {
      const project = await this.prisma.project.create({
        data: {
          name: dto.name,
          key: dto.key.trim(),
        },
      });

      this.logSuccess('createProject', { id: project.id, name: project.name });
      return project;
    } catch (error) {
      this.handleError(error, 'createProject');
    }
  }

  /**
   * Delete a project with all related data
   */
  async deleteProject(id: number) {
    this.logStart('deleteProject', { id });

    try {
      // Verify project exists
      const project = await this.prisma.project.findUnique({
        where: { id },
      });

      if (!project) {
        throw new NotFoundException(`Project with ID ${id} not found`);
      }

      // Delete in transaction: issues -> reports -> project
      await this.prisma.$transaction([
        this.prisma.issue.deleteMany({
          where: { report: { projectId: id } },
        }),
        this.prisma.report.deleteMany({ where: { projectId: id } }),
        this.prisma.project.delete({ where: { id } }),
      ]);

      this.logSuccess('deleteProject', { id });
    } catch (error) {
      this.handleError(error, 'deleteProject');
    }
  }

  /**
   * Get project with scan history from SonarQube
   */
  async getProjectWithHistory(
    projectId: number,
  ): Promise<ProjectHistoryResult> {
    this.logStart('getProjectWithHistory', { projectId });

    const project = await this.getProjectById(projectId);

    let sonarAnalyses: any[] = [];
    let apiError: string | null = null;

    // Fetch analyses from SonarQube
    try {
      sonarAnalyses = await this.sonarService.getProjectAnalyses(
        project.key.trim(),
      );
    } catch (error) {
      apiError = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to fetch SonarQube analyses: ${apiError}`);
    }

    // Get local reports
    const localReports = await this.prisma.report.findMany({
      where: { projectId: projectId, status: { not: 'DELETED' } },
    });

    // Map SonarQube analyses to history items
    const history: ProjectHistoryItem[] = sonarAnalyses.map((scan) => {
      const local = localReports.find(
        (r) => r.analysisKey && r.analysisKey.trim() === scan.key.trim(),
      );
      return {
        analysisKey: scan.key,
        date: DateUtil.formatToVietnamese(scan.date),
        rawDate: scan.date,
        version: scan.projectVersion || '-',
        isSynced: !!local,
        localReportId: local ? local.id : null,
        status: local ? local.status : 'NOT_IMPORTED',
        filename: local ? local.filename : null,
        timestamp: DateUtil.getTimestamp(scan.date),
      };
    });

    // Map manual reports (reports without analysisKey)
    const manualReports: ProjectHistoryItem[] = localReports
      .filter((r) => !r.analysisKey)
      .map((r) => ({
        analysisKey: 'MANUAL',
        date: DateUtil.formatToVietnamese(r.createdAt),
        rawDate: r.createdAt,
        version: 'Manual Upload',
        isSynced: true,
        localReportId: r.id,
        status: r.status,
        filename: r.filename,
        timestamp: DateUtil.getTimestamp(r.createdAt),
      }));

    // Combine and sort by timestamp
    const finalHistory = [...history, ...manualReports].sort(
      (a, b) => b.timestamp - a.timestamp,
    );

    // Mark latest
    if (finalHistory.length > 0) {
      finalHistory[0].isLatest = true;
    }

    this.logSuccess('getProjectWithHistory', {
      projectId,
      historyCount: finalHistory.length,
    });

    return {
      project,
      reports: finalHistory,
      apiError,
    };
  }
}
