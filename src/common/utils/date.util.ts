/**
 * Date utility functions for consistent date formatting across the application
 */
export class DateUtil {
  private static readonly DEFAULT_LOCALE = 'vi-VN';
  private static readonly DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';

  /**
   * Format date to Vietnamese locale string
   */
  static formatToVietnamese(date: Date | string | null | undefined): string {
    if (!date) return 'Chưa có';

    const dateObj = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(dateObj.getTime())) return 'Invalid date';

    return dateObj.toLocaleString(this.DEFAULT_LOCALE, {
      timeZone: this.DEFAULT_TIMEZONE,
    });
  }

  /**
   * Format date to ISO string
   */
  static formatToISO(date: Date | string | null | undefined): string {
    if (!date) return '';

    const dateObj = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(dateObj.getTime())) return '';

    return dateObj.toISOString();
  }

  /**
   * Format date to custom format
   */
  static format(
    date: Date | string | null | undefined,
    options: Intl.DateTimeFormatOptions = {},
  ): string {
    if (!date) return '';

    const dateObj = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(dateObj.getTime())) return '';

    return dateObj.toLocaleString(this.DEFAULT_LOCALE, {
      timeZone: this.DEFAULT_TIMEZONE,
      ...options,
    });
  }

  /**
   * Get timestamp from date
   */
  static getTimestamp(date: Date | string | null | undefined): number {
    if (!date) return 0;

    const dateObj = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(dateObj.getTime())) return 0;

    return dateObj.getTime();
  }

  /**
   * Check if date is valid
   */
  static isValid(date: Date | string | null | undefined): boolean {
    if (!date) return false;

    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return !isNaN(dateObj.getTime());
  }
}
