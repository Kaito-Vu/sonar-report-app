export interface EnvironmentVariables {
  // Database
  DATABASE_URL: string;

  // Redis
  REDIS_HOST: string;
  REDIS_PORT: number;

  // MinIO
  MINIO_ENDPOINT: string;
  MINIO_PORT: number;
  MINIO_ACCESS_KEY: string;
  MINIO_SECRET_KEY: string;
  MINIO_BUCKET: string;
  MINIO_USE_SSL: string;

  // Application
  PORT?: number;
  NODE_ENV?: string;
  ALLOWED_ORIGINS?: string;

  // JWT
  JWT_SECRET?: string;
  JWT_EXPIRES_IN?: string;

  // Admin
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;

  // Throttling
  THROTTLE_TTL?: number;
  THROTTLE_LIMIT?: number;

  // HTTP
  HTTP_TIMEOUT?: number;

  // Queue
  QUEUE_ATTEMPTS?: number;
  QUEUE_BACKOFF_DELAY?: number;
  QUEUE_REMOVE_ON_COMPLETE_AGE?: number;
  QUEUE_REMOVE_ON_FAIL_AGE?: number;

  // Security
  MAX_ZIP_SIZE?: number;
  MAX_EXTRACTED_SIZE?: number;
}

export function validateEnvironment(
  config: Record<string, any>,
): EnvironmentVariables {
  const errors: string[] = [];

  // Required variables
  const required = [
    'DATABASE_URL',
    'REDIS_HOST',
    'REDIS_PORT',
    'MINIO_ACCESS_KEY',
    'MINIO_SECRET_KEY',
  ];

  required.forEach((key) => {
    if (!config[key]) {
      errors.push(`Missing required environment variable: ${key}`);
    }
  });

  // Validate numeric values
  if (config.REDIS_PORT && isNaN(parseInt(config.REDIS_PORT))) {
    errors.push('REDIS_PORT must be a valid number');
  }

  if (config.MINIO_PORT && isNaN(parseInt(config.MINIO_PORT))) {
    errors.push('MINIO_PORT must be a valid number');
  }

  if (config.PORT && isNaN(parseInt(config.PORT))) {
    errors.push('PORT must be a valid number');
  }

  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n${errors.join('\n')}`);
  }

  return {
    DATABASE_URL: config.DATABASE_URL,
    REDIS_HOST: config.REDIS_HOST || 'localhost',
    REDIS_PORT: parseInt(config.REDIS_PORT) || 6379,
    MINIO_ENDPOINT: config.MINIO_ENDPOINT || 'localhost',
    MINIO_PORT: parseInt(config.MINIO_PORT) || 9000,
    MINIO_ACCESS_KEY: config.MINIO_ACCESS_KEY,
    MINIO_SECRET_KEY: config.MINIO_SECRET_KEY,
    MINIO_BUCKET: config.MINIO_BUCKET || 'sonar-reports',
    MINIO_USE_SSL: config.MINIO_USE_SSL || 'false',
    PORT: config.PORT ? parseInt(config.PORT) : 3000,
    NODE_ENV: config.NODE_ENV || 'development',
    ALLOWED_ORIGINS: config.ALLOWED_ORIGINS || '*',
    JWT_SECRET: config.JWT_SECRET || 'your-secret-key-change-in-production',
    JWT_EXPIRES_IN: config.JWT_EXPIRES_IN || '24h',
    ADMIN_USERNAME: config.ADMIN_USERNAME || 'admin',
    ADMIN_PASSWORD: config.ADMIN_PASSWORD || 'admin123',
    THROTTLE_TTL: config.THROTTLE_TTL ? parseInt(config.THROTTLE_TTL) : 60000,
    THROTTLE_LIMIT: config.THROTTLE_LIMIT
      ? parseInt(config.THROTTLE_LIMIT)
      : 100,
    HTTP_TIMEOUT: config.HTTP_TIMEOUT ? parseInt(config.HTTP_TIMEOUT) : 30000,
    QUEUE_ATTEMPTS: config.QUEUE_ATTEMPTS ? parseInt(config.QUEUE_ATTEMPTS) : 3,
    QUEUE_BACKOFF_DELAY: config.QUEUE_BACKOFF_DELAY
      ? parseInt(config.QUEUE_BACKOFF_DELAY)
      : 2000,
    QUEUE_REMOVE_ON_COMPLETE_AGE: config.QUEUE_REMOVE_ON_COMPLETE_AGE
      ? parseInt(config.QUEUE_REMOVE_ON_COMPLETE_AGE)
      : 3600,
    QUEUE_REMOVE_ON_FAIL_AGE: config.QUEUE_REMOVE_ON_FAIL_AGE
      ? parseInt(config.QUEUE_REMOVE_ON_FAIL_AGE)
      : 86400,
    MAX_ZIP_SIZE: config.MAX_ZIP_SIZE
      ? parseInt(config.MAX_ZIP_SIZE)
      : 100 * 1024 * 1024,
    MAX_EXTRACTED_SIZE: config.MAX_EXTRACTED_SIZE
      ? parseInt(config.MAX_EXTRACTED_SIZE)
      : 500 * 1024 * 1024,
  };
}
