import dotenv from 'dotenv';

dotenv.config();

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  service: {
    port: parseInt(process.env.SERVICE_PORT || '3001', 10),
    host: process.env.SERVICE_HOST || 'localhost',
  },
  database: {
    url: process.env.DATABASE_URL || 'file:./app.db',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  queue: {
    maxAttempts: parseInt(process.env.QUEUE_MAX_ATTEMPTS || '3', 10),
    backoffDelay: parseInt(process.env.QUEUE_BACKOFF_DELAY || '1000', 10),
    backoffMultiplier: parseInt(process.env.QUEUE_BACKOFF_MULTIPLIER || '2', 10),
  },
  health: {
    checkInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '5000', 10),
  },
};

export default config;
