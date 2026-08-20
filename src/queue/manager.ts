import { Queue, Worker, QueueEvents } from 'bullmq';
import { config } from '../config.js';
import logger from '../logger.js';
import { getRedisClient } from '../redis.js';
import { QueueName, QueueStats } from './types.js';

interface QueueInstance {
  queue: Queue;
  worker: Worker;
  queueEvents: QueueEvents;
}

const queues: Map<QueueName, QueueInstance> = new Map();

const redisConnection = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
};

async function handleNotificationJob(job: any) {
  const { applicationId, email, candidateName, jobTitle } = job.data;
  logger.info(
    { jobId: job.id, applicationId, email },
    'Processing notification job'
  );

  // Stub: In production, this would send an actual email
  console.log(
    `[STUB] Sending email to ${email} for application ${applicationId}`
  );

  return { processed: true, timestamp: new Date() };
}

async function handleStatsUpdateJob(job: any) {
  const { recruiterId, applicationId, jobId } = job.data;
  logger.info(
    { jobId: job.id, recruiterId, applicationId },
    'Processing stats update job'
  );

  // Stub: In production, this would update recruiter statistics
  console.log(
    `[STUB] Updating stats for recruiter ${recruiterId} with application ${applicationId}`
  );

  return { statsUpdated: true, timestamp: new Date() };
}

async function handleAuditLogJob(job: any) {
  const { applicationId, action, userId, metadata } = job.data;
  logger.info(
    { jobId: job.id, applicationId, action, userId },
    'Processing audit log job'
  );

  // Stub: In production, this would write to audit logs
  console.log(
    `[STUB] Writing audit log for application ${applicationId}: ${action} by ${userId}`
  );

  return { logged: true, timestamp: new Date() };
}

export async function initializeQueues(): Promise<void> {
  logger.info('Initializing job queues');

  try {
    // Initialize notifications queue
    const notificationsQueue = new Queue('notifications', { connection: redisConnection });
    const notificationsWorker = new Worker('notifications', handleNotificationJob, {
      connection: redisConnection,
      concurrency: 5,
    });
    const notificationsEvents = new QueueEvents('notifications', { connection: redisConnection });

    notificationsWorker.on('completed', (job, result) => {
      logger.info({ jobId: job.id, result }, 'Notification job completed');
    });

    notificationsWorker.on('failed', (job, error) => {
      logger.warn({ jobId: job?.id, error: error.message }, 'Notification job failed');
    });

    notificationsEvents.on('failed', ({ jobId, failedReason }) => {
      logger.error(
        { jobId, failedReason },
        'Notification job moved to failed queue'
      );
    });

    queues.set('notifications', {
      queue: notificationsQueue,
      worker: notificationsWorker,
      queueEvents: notificationsEvents,
    });

    // Initialize stats-updates queue
    const statsQueue = new Queue('stats-updates', { connection: redisConnection });
    const statsWorker = new Worker('stats-updates', handleStatsUpdateJob, {
      connection: redisConnection,
      concurrency: 5,
    });
    const statsEvents = new QueueEvents('stats-updates', { connection: redisConnection });

    statsWorker.on('completed', (job, result) => {
      logger.info({ jobId: job.id, result }, 'Stats update job completed');
    });

    statsWorker.on('failed', (job, error) => {
      logger.warn({ jobId: job?.id, error: error.message }, 'Stats update job failed');
    });

    statsEvents.on('failed', ({ jobId, failedReason }) => {
      logger.error(
        { jobId, failedReason },
        'Stats update job moved to failed queue'
      );
    });

    queues.set('stats-updates', {
      queue: statsQueue,
      worker: statsWorker,
      queueEvents: statsEvents,
    });

    // Initialize audit-logs queue
    const auditQueue = new Queue('audit-logs', { connection: redisConnection });
    const auditWorker = new Worker('audit-logs', handleAuditLogJob, {
      connection: redisConnection,
      concurrency: 5,
    });
    const auditEvents = new QueueEvents('audit-logs', { connection: redisConnection });

    auditWorker.on('completed', (job, result) => {
      logger.info({ jobId: job.id, result }, 'Audit log job completed');
    });

    auditWorker.on('failed', (job, error) => {
      logger.warn({ jobId: job?.id, error: error.message }, 'Audit log job failed');
    });

    auditEvents.on('failed', ({ jobId, failedReason }) => {
      logger.error(
        { jobId, failedReason },
        'Audit log job moved to failed queue'
      );
    });

    queues.set('audit-logs', {
      queue: auditQueue,
      worker: auditWorker,
      queueEvents: auditEvents,
    });

    logger.info('Job queues initialized successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize job queues');
    throw error;
  }
}

export async function addJobToQueue<T>(
  queueName: QueueName,
  jobData: T,
  jobId?: string
): Promise<string> {
  const queueInstance = queues.get(queueName);
  if (!queueInstance) {
    throw new Error(`Queue ${queueName} not initialized`);
  }

  try {
    const job = await queueInstance.queue.add(queueName, jobData, {
      jobId,
      attempts: config.queue.maxAttempts,
      backoff: {
        type: 'exponential',
        delay: config.queue.backoffDelay,
      },
      removeOnComplete: true,
      removeOnFail: false,
    });

    logger.info(
      { queueName, jobId: job.id, attempts: config.queue.maxAttempts },
      'Job added to queue'
    );

    return job.id!;
  } catch (error) {
    logger.error({ error, queueName }, 'Failed to add job to queue');
    throw error;
  }
}

export async function getQueueStats(queueName: QueueName): Promise<QueueStats> {
  const queueInstance = queues.get(queueName);
  if (!queueInstance) {
    throw new Error(`Queue ${queueName} not initialized`);
  }

  try {
    const waiting = await queueInstance.queue.getWaitingCount();
    const active = await queueInstance.queue.getActiveCount();
    const failed = await queueInstance.queue.getFailedCount();
    const delayed = await queueInstance.queue.getDelayedCount();
    const paused = await queueInstance.queue.getPausedCount();

    return { waiting, active, failed, delayed, paused };
  } catch (error) {
    logger.error({ error, queueName }, 'Failed to get queue stats');
    throw error;
  }
}

export async function getAllQueuesStats(): Promise<Record<QueueName, QueueStats>> {
  const stats: Record<string, QueueStats> = {};

  for (const queueName of Array.from(queues.keys())) {
    stats[queueName] = await getQueueStats(queueName);
  }

  return stats as Record<QueueName, QueueStats>;
}

export async function closeQueues(): Promise<void> {
  logger.info('Closing job queues');

  for (const [queueName, instance] of queues) {
    try {
      await instance.worker.close();
      await instance.queueEvents.close();
      await instance.queue.close();
      logger.info({ queueName }, 'Queue closed');
    } catch (error) {
      logger.error({ error, queueName }, 'Error closing queue');
    }
  }

  queues.clear();
  logger.info('All job queues closed');
}

export default {
  initializeQueues,
  addJobToQueue,
  getQueueStats,
  getAllQueuesStats,
  closeQueues,
};
