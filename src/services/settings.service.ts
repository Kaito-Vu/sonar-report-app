import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { BaseService } from '../common/services/base.service';
import { SettingsDto } from '../dto/settings.dto';
import { StringUtil } from '../common/utils/string.util';

@Injectable()
export class SettingsService extends BaseService {
  constructor(prisma: PrismaService) {
    super('SettingsService', prisma);
  }

  /**
   * Get SonarQube settings
   */
  async getSettings() {
    this.logStart('getSettings');

    const config = await this.prisma.sonarConfig.findFirst();

    this.logSuccess('getSettings');
    return config;
  }

  /**
   * Update SonarQube settings
   */
  async updateSettings(dto: SettingsDto) {
    this.logStart('updateSettings');

    // Remove trailing slash from URL
    const normalizedUrl = StringUtil.safeTrim(dto.url).replace(/\/$/, '');

    // Delete all existing configs and create new one
    await this.prisma.$transaction([
      this.prisma.sonarConfig.deleteMany(),
      this.prisma.sonarConfig.create({
        data: {
          url: normalizedUrl,
          token: dto.token,
        },
      }),
    ]);

    this.logSuccess('updateSettings');
  }
}


