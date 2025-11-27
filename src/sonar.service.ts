import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from './prisma.service';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class SonarService {
  private readonly logger = new Logger(SonarService.name);

  constructor(
    private httpService: HttpService,
    private prisma: PrismaService
  ) {}

  // Lấy cấu hình DB
  private async getConfig() {
    const config = await this.prisma.sonarConfig.findFirst();
    if (!config) {
      this.logger.error('❌ Chưa cấu hình SonarQube URL/Token');
      throw new Error('Chưa cấu hình SonarQube. Vui lòng vào trang Settings.');
    }
    return config;
  }

  // 1. Lấy thông tin Rule (Caching vào DB)
  async getRuleDetails(ruleKey: string) {
    const cachedRule = await this.prisma.sonarRule.findUnique({ where: { key: ruleKey } });
    if (cachedRule) return cachedRule;

    try {
      const { url, token } = await this.getConfig();
      const res = await lastValueFrom(
        this.httpService.get(`${url}/api/rules/show?key=${ruleKey}`, {
          auth: { username: token, password: '' }
        })
      );
      const rule = res.data.rule;

      return await this.prisma.sonarRule.create({
        data: {
          key: rule.key,
          name: rule.name,
          htmlDesc: rule.htmlDesc || '',
          mdDesc: rule.mdDesc || '',
          isExternal: ruleKey.startsWith('external_')
        }
      });
    } catch (e) {
      // Cache rule lỗi để tránh gọi lại liên tục
      if (e.response?.status === 404) {
        return await this.prisma.sonarRule.create({
          data: { key: ruleKey, name: 'External/Unknown Rule', htmlDesc: '', isExternal: true }
        });
      }
      return null;
    }
  }

  // 2. Lấy Source Code
  async getSourceSnippet(projectKey: string, filePath: string, line: number) {
    try {
      const { url, token } = await this.getConfig();
      // Lấy context +- 5 dòng
      const endpoint = `${url}/api/sources/lines?key=${projectKey}:${filePath}&from=${Math.max(1, line - 5)}&to=${line + 5}`;

      const res = await lastValueFrom(
        this.httpService.get(endpoint, { auth: { username: token, password: '' } })
      );
      return res.data.sources;
    } catch (e) {
      // this.logger.warn(`Get Code Error: ${e.message}`);
      return null;
    }
  }

  // 3. [MỚI] Lấy Lịch sử Scan (Project Analyses)
  async getProjectAnalyses(projectKey: string) {
    try {
      const { url, token } = await this.getConfig();
      // API Sonar: Tìm lịch sử analysis
      const endpoint = `${url}/api/project_analyses/search?project=${encodeURIComponent(projectKey)}`;

      const response = await lastValueFrom(
        this.httpService.get(endpoint, { auth: { username: token, password: '' } })
      );
      return response.data.analyses || []; // Trả về mảng [{ key, date, projectVersion }, ...]
    } catch (error) {
      this.logger.error(`Lỗi lấy lịch sử scan (${projectKey}): ${error.message}`);
      return [];
    }
  }

  // 4. [MỚI] Lấy thông tin bản scan mới nhất
  async getLatestAnalysis(projectKey: string) {
    const analyses = await this.getProjectAnalyses(projectKey);
    return analyses.length > 0 ? analyses[0] : null;
  }

  // 5. Tải file Báo cáo (ZIP)
  async downloadReport(projectKey: string, branch = 'main'): Promise<Buffer> {
    try {
      const { url, token } = await this.getConfig();
      const endpoint = `${url}/api/regulatory_reports/download?project=${encodeURIComponent(projectKey)}&branch=${branch}`;

      this.logger.log(`📥 Downloading report from: ${endpoint}`);

      const response = await lastValueFrom(
        this.httpService.get(endpoint, {
          auth: { username: token, password: '' },
          responseType: 'arraybuffer'
        })
      );

      return Buffer.from(response.data);
    } catch (error) {
      this.logger.error(`Download Error: ${error.message}`);
      throw new Error(`Lỗi tải file từ SonarQube (Key: ${projectKey}).`);
    }
  }
}