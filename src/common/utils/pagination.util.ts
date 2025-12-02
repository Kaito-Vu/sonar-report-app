/**
 * Pagination utility functions
 */
export interface PaginationOptions {
  page: number;
  pageSize: number;
  maxPageSize?: number;
  minPageSize?: number;
}

export interface PaginationResult<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasPrev: boolean;
    hasNext: boolean;
    prevPage: number | null;
    nextPage: number | null;
  };
}

export class PaginationUtil {
  /**
   * Normalize pagination parameters
   */
  static normalize(options: PaginationOptions): {
    page: number;
    pageSize: number;
    skip: number;
    take: number;
  } {
    const minPageSize = options.minPageSize || 1;
    const maxPageSize = options.maxPageSize || 500;
    
    const page = Math.max(1, options.page);
    const pageSize = Math.max(
      minPageSize,
      Math.min(maxPageSize, options.pageSize),
    );

    return {
      page,
      pageSize,
      skip: (page - 1) * pageSize,
      take: pageSize,
    };
  }

  /**
   * Create pagination metadata
   */
  static createMetadata(
    page: number,
    pageSize: number,
    total: number,
  ): PaginationResult<never>['pagination'] {
    const totalPages = Math.ceil(total / pageSize);

    return {
      page,
      pageSize,
      total,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
      prevPage: page > 1 ? page - 1 : null,
      nextPage: page < totalPages ? page + 1 : null,
    };
  }

  /**
   * Create pagination result
   */
  static createResult<T>(
    data: T[],
    page: number,
    pageSize: number,
    total: number,
  ): PaginationResult<T> {
    return {
      data,
      pagination: this.createMetadata(page, pageSize, total),
    };
  }

  /**
   * Generate page size options for UI
   */
  static generatePageSizeOptions(
    currentPageSize: number,
    options: number[] = [10, 20, 50, 100, 200],
  ): Array<{ value: number; selected: boolean }> {
    return options.map((value) => ({
      value,
      selected: value === currentPageSize,
    }));
  }
}


