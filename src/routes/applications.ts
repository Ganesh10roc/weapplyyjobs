import { FastifyInstance } from 'fastify';
import { getDatabase } from '../db.js';
import logger from '../logger.js';
import { addJobToQueue } from '../queue/manager.js';
import type { NotificationJob, StatsUpdateJob, AuditLogJob } from '../queue/types.js';

interface ApplicationRequest {
  jobId: string;
  candidateId: string;
  recruiterId: string;
  coverLetter: string;
}

export async function registerApplicationRoutes(server: FastifyInstance) {
  server.post<{ Body: ApplicationRequest }>(
    '/api/applications',
    async (request, reply) => {
      const startTime = Date.now();

      try {
        const { jobId, candidateId, recruiterId, coverLetter } = request.body;

        // Validation
        if (!jobId || typeof jobId !== 'string') {
          return reply.status(400).send({
            error: 'Invalid jobId: must be a non-empty string',
          });
        }

        if (!candidateId || typeof candidateId !== 'string') {
          return reply.status(400).send({
            error: 'Invalid candidateId: must be a non-empty string',
          });
        }

        if (!recruiterId || typeof recruiterId !== 'string') {
          return reply.status(400).send({
            error: 'Invalid recruiterId: must be a non-empty string',
          });
        }

        if (!coverLetter || typeof coverLetter !== 'string') {
          return reply.status(400).send({
            error: 'Invalid coverLetter: must be a non-empty string',
          });
        }

        const prisma = await getDatabase();

        // Insert application into database
        const application = await prisma.application.create({
          data: {
            jobId,
            candidateId,
            recruiterId,
            coverLetter,
            status: 'submitted',
          },
        });

        const dbTime = Date.now() - startTime;
        logger.info(
          {
            applicationId: application.id,
            jobId,
            candidateId,
            recruiterId,
            dbTime,
          },
          'Application created'
        );

        // Queue async jobs (these happen outside the request/response cycle)
        const notificationJob: NotificationJob = {
          applicationId: application.id,
          email: `candidate+${candidateId}@example.com`,
          candidateName: candidateId,
          jobTitle: `Job ${jobId}`,
        };

        const statsUpdateJob: StatsUpdateJob = {
          recruiterId,
          applicationId: application.id,
          jobId,
        };

        const auditLogJob: AuditLogJob = {
          applicationId: application.id,
          action: 'application_submitted',
          userId: recruiterId,
          timestamp: Date.now(),
          metadata: {
            jobId,
            candidateId,
          },
        };

        // Fire and forget - add jobs to queue without waiting
        addJobToQueue('notifications', notificationJob, `notif-${application.id}`)
          .catch((error) => {
            logger.error(
              { error, applicationId: application.id },
              'Failed to queue notification job'
            );
          });

        addJobToQueue('stats-updates', statsUpdateJob, `stats-${application.id}`)
          .catch((error) => {
            logger.error(
              { error, applicationId: application.id },
              'Failed to queue stats update job'
            );
          });

        addJobToQueue('audit-logs', auditLogJob, `audit-${application.id}`)
          .catch((error) => {
            logger.error(
              { error, applicationId: application.id },
              'Failed to queue audit log job'
            );
          });

        const totalTime = Date.now() - startTime;
        logger.info(
          { applicationId: application.id, totalTime },
          'Application endpoint completed'
        );

        return reply.status(201).send({
          success: true,
          application: {
            id: application.id,
            jobId: application.jobId,
            candidateId: application.candidateId,
            recruiterId: application.recruiterId,
            status: application.status,
            createdAt: application.createdAt,
          },
          processingTime: totalTime,
        });
      } catch (error) {
        logger.error({ error }, 'Error creating application');
        return reply.status(500).send({
          error: 'Internal server error',
        });
      }
    }
  );
}

export default registerApplicationRoutes;
