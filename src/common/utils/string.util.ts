/**
 * String utility functions for common string operations
 */
export class StringUtil {
  /**
   * Safely trim string, return empty string if null/undefined
   */
  static safeTrim(value: string | null | undefined): string {
    if (!value) return '';
    return String(value).trim();
  }

  /**
   * Truncate string to max length with ellipsis
   */
  static truncate(value: string, maxLength: number, suffix = '...'): string {
    if (!value || value.length <= maxLength) return value || '';
    return value.substring(0, maxLength - suffix.length) + suffix;
  }

  /**
   * Capitalize first letter
   */
  static capitalize(value: string): string {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }

  /**
   * Convert to slug format
   */
  static toSlug(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Generate random string
   */
  static random(length = 8): string {
    return Math.random()
      .toString(36)
      .substring(2, 2 + length);
  }

  /**
   * Check if string is empty or whitespace
   */
  static isEmpty(value: string | null | undefined): boolean {
    return !value || value.trim().length === 0;
  }

  /**
   * Break long text for PDF/display
   */
  static breakLongText(text: string | null | undefined): string {
    if (!text) return '';
    return text.replace(/([/._:,-])/g, '$1\u200B');
  }
}
