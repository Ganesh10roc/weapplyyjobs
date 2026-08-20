import { createClient, RedisClientType } from 'redis';
import { config } from './config.js';
import logger from './logger.js';

let redisClient: RedisClientType | null = null;

export async function initializeRedis(): Promise<RedisClientType> {
  if (redisClient) {
    return redisClient;
  }

  redisClient = createClient({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password || undefined,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 50, 500),
    },
  });

  redisClient.on('error', (error) => {
    logger.error({ error }, 'Redis error');
  });

  redisClient.on('connect', () => {
    logger.info('Redis client connected');
  });

  try {
    await redisClient.connect();
    logger.info('Redis connected successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to connect to Redis');
    throw error;
  }

  return redisClient;
}

export async function getRedisClient(): Promise<RedisClientType> {
  if (!redisClient) {
    throw new Error('Redis not initialized. Call initializeRedis first.');
  }
  return redisClient;
}

export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis connection closed');
  }
}

export async function isRedisConnected(): Promise<boolean> {
  try {
    if (!redisClient) return false;
    await redisClient.ping();
    return true;
  } catch {
    return false;
  }
}

export default {
  initializeRedis,
  getRedisClient,
  closeRedisConnection,
  isRedisConnected,
};
