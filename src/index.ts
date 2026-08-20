import { initializeDatabase, closeDatabaseConnection } from './db.js';
import { initializeRedis, closeRedisConnection } from './redis.js';
import { initializeQueues, closeQueues } from './queue/manager.js';
import { createServer, startServer, stopServer } from './server.js';
import logger from './logger.js';

async function main() {
  let exitCode = 0;

  try {
    logger.info('Initializing WeApplyJobs backend service');

    // Initialize core infrastructure
    await initializeDatabase();
    await initializeRedis();
    await initializeQueues();

    // Create and start server
    const server = await createServer();
    await startServer(server);

    // Handle graceful shutdown
    const signals = ['SIGINT', 'SIGTERM'];
    signals.forEach((signal) => {
      process.on(signal, async () => {
        logger.info({ signal }, 'Received shutdown signal');
        try {
          await stopServer(server);
          await closeQueues();
          await closeRedisConnection();
          await closeDatabaseConnection();
          logger.info('Service shut down gracefully');
          process.exit(0);
        } catch (error) {
          logger.error({ error }, 'Error during shutdown');
          process.exit(1);
        }
      });
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start service');
    exitCode = 1;
    process.exit(exitCode);
  }
}

main().catch((error) => {
  logger.error({ error }, 'Fatal error in main');
  process.exit(1);
});
