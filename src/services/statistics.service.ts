import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { BaseService } from '../common/services/base.service';

@Injectable()
export class StatisticsService extends BaseService {
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

  constructor(prisma: PrismaService) {
    super('StatisticsService', prisma);
  }

  /**
   * Get statistics for a report
   */
  async getStatistics(reportId: string) {
    this.logStart('getStatistics', { reportId });

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

    this.logSuccess('getStatistics', { reportId });

    return { byType: statsType, bySeverity: statsSeverity };
  }
}


