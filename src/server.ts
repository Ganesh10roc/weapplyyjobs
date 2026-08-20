import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import logger from './logger.js';
import { registerApplicationRoutes } from './routes/applications.js';
import { registerHealthRoutes } from './routes/health.js';

export async function createServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: logger,
    requestIdLogLabel: 'reqId',
    disableRequestLogging: false,
    requestTimeout: 30000,
  });

  // Register CORS
  await server.register(cors, {
    origin: true,
    credentials: true,
  });

  // Register routes
  await registerApplicationRoutes(server);
  await registerHealthRoutes(server);

  // Global error handler
  server.setErrorHandler((error, request, reply) => {
    logger.error(
      {
        error: error.message,
        statusCode: error.statusCode,
        url: request.url,
      },
      'Unhandled error'
    );

    reply.status(error.statusCode || 500).send({
      error: error.message || 'Internal server error',
    });
  });

  return server;
}

export async function startServer(server: FastifyInstance): Promise<void> {
  try {
    await server.listen({ port: config.service.port, host: config.service.host });
    logger.info(
      { port: config.service.port, host: config.service.host },
      'Server started successfully'
    );
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    throw error;
  }
}

export async function stopServer(server: FastifyInstance): Promise<void> {
  try {
    await server.close();
    logger.info('Server stopped successfully');
  } catch (error) {
    logger.error({ error }, 'Error stopping server');
    throw error;
  }
}

export default {
  createServer,
  startServer,
  stopServer,
};
