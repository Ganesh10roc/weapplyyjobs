import { initializeDatabase, getDatabase, closeDatabaseConnection } from '../db.js';
import logger from '../logger.js';

async function seedDatabase() {
  try {
    logger.info('Seeding database...');

    await initializeDatabase();
    const prisma = await getDatabase();

    // Clear existing data
    await prisma.application.deleteMany({});
    await prisma.queueJob.deleteMany({});

    logger.info('Database seeded successfully');

    await closeDatabaseConnection();
  } catch (error) {
    logger.error({ error }, 'Failed to seed database');
    throw error;
  }
}

seedDatabase().catch((error) => {
  logger.error({ error }, 'Seed script failed');
  process.exit(1);
});
