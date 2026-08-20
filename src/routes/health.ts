import { FastifyInstance } from 'fastify';
import { getDatabase } from '../db.js';
import { getRedisClient, isRedisConnected } from '../redis.js';
import { getAllQueuesStats } from '../queue/manager.js';
import logger from '../logger.js';

const startTime = Date.now();

export async function registerHealthRoutes(server: FastifyInstance) {
  server.get('/health', async (request, reply) => {
    try {
      const prisma = await getDatabase();
      const uptime = Math.floor((Date.now() - startTime) / 1000);

      // Check database connection
      let dbStatus = 'connected';
      try {
        await prisma.$queryRaw`SELECT 1`;
      } catch (error) {
        dbStatus = 'disconnected';
        logger.error({ error }, 'Database health check failed');
      }

      // Check Redis connection
      let redisStatus = 'connected';
      const redisConnected = await isRedisConnected();
      if (!redisConnected) {
        redisStatus = 'disconnected';
        logger.error('Redis health check failed');
      }

      // Get queue stats
      let queues: any = {};
      try {
        queues = await getAllQueuesStats();
      } catch (error) {
        logger.error({ error }, 'Failed to get queue stats');
      }

      // Determine overall status
      const isHealthy = dbStatus === 'connected' && redisStatus === 'connected';
      const statusCode = isHealthy ? 200 : 503;

      const response = {
        status: isHealthy ? 'ok' : 'degraded',
        db: dbStatus,
        redis: redisStatus,
        queues: {
          notifications: queues.notifications || { waiting: 0, active: 0, failed: 0 },
          'stats-updates': queues['stats-updates'] || { waiting: 0, active: 0, failed: 0 },
          'audit-logs': queues['audit-logs'] || { waiting: 0, active: 0, failed: 0 },
        },
        uptime,
      };

      return reply.status(statusCode).send(response);
    } catch (error) {
      logger.error({ error }, 'Health check endpoint error');
      return reply.status(503).send({
        status: 'error',
        error: 'Health check failed',
        uptime: Math.floor((Date.now() - startTime) / 1000),
      });
    }
  });
}

export default registerHealthRoutes;
