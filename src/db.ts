import { PrismaClient } from '@prisma/client';
import logger from './logger.js';

let prisma: PrismaClient | null = null;

export async function initializeDatabase(): Promise<PrismaClient> {
  if (prisma) {
    return prisma;
  }

  prisma = new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });

  prisma.$on('query', (e) => {
    logger.debug({ query: e.query, duration: e.duration }, 'Database query');
  });

  prisma.$on('error', (e) => {
    logger.error({ message: e.message }, 'Database error');
  });

  try {
    await prisma.$connect();
    logger.info('Database connected successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to connect to database');
    throw error;
  }

  return prisma;
}

export async function getDatabase(): Promise<PrismaClient> {
  if (!prisma) {
    throw new Error('Database not initialized. Call initializeDatabase first.');
  }
  return prisma;
}

export async function closeDatabaseConnection(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
    logger.info('Database connection closed');
  }
}

export default {
  initializeDatabase,
  getDatabase,
  closeDatabaseConnection,
};
