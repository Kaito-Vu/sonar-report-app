import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

/**
 * Base service with common functionality
 */
export abstract class BaseService {
  protected readonly logger: Logger;
  protected readonly prisma: PrismaService;

  constructor(serviceName: string, prisma: PrismaService) {
    this.logger = new Logger(serviceName);
    this.prisma = prisma;
  }

  /**
   * Handle service errors consistently
   */
  protected handleError(error: unknown, context: string): never {
    if (error instanceof Error) {
      this.logger.error(`${context}: ${error.message}`, error.stack);
      throw error;
    }

    let errorMessage: string;
    if (typeof error === 'object' && error !== null) {
      try {
        errorMessage = JSON.stringify(error);
      } catch {
        errorMessage = 'Unknown error (non-serializable)';
      }
    } else if (typeof error === 'string') {
      errorMessage = error;
    } else if (typeof error === 'number' || typeof error === 'boolean') {
      errorMessage = String(error);
    } else {
      errorMessage = 'Unknown error';
    }
    this.logger.error(`${context}: ${errorMessage}`);
    throw new Error(errorMessage);
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
