import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

/**
 * Base service with common functionality
 */
export abstract class BaseService {
  protected readonly logger: Logger;
  protected readonly prisma: PrismaService;

  constructor(
    serviceName: string,
    prisma: PrismaService,
  ) {
    this.logger = new Logger(serviceName);
    this.prisma = prisma;
  }

  /**
   * Handle service errors consistently
   */
  protected handleError(error: unknown, context: string): never {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;

    this.logger.error(`${context}: ${errorMessage}`, errorStack);
    throw error instanceof Error ? error : new Error(String(error));
  }

  /**
   * Log operation start
   */
  protected logStart(operation: string, details?: Record<string, any>): void {
    this.logger.log(
      `Starting ${operation}${details ? `: ${JSON.stringify(details)}` : ''}`,
    );
  }

  /**
   * Log operation success
   */
  protected logSuccess(operation: string, details?: Record<string, any>): void {
    this.logger.log(
      `${operation} completed successfully${details ? `: ${JSON.stringify(details)}` : ''}`,
    );
  }
}


