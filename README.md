# WeApplyJobs Backend Service

A production-ready Node.js backend service for handling job application submissions with async queue processing, built with Fastify, BullMQ, Redis, and Prisma.

## Overview

This service demonstrates best practices for building scalable backend systems:

- **Fast HTTP server** with Fastify
- **Async job processing** with BullMQ + Redis
- **Type-safe database access** with Prisma
- **Proper error handling** with exponential backoff and dead-letter queues
- **Comprehensive observability** via structured logging and health checks
- **Production-ready** connection pooling and graceful shutdown

## Architecture

- `POST /api/applications` - Submit a job application (returns immediately, queues async tasks)
- `GET /health` - Health check endpoint with queue and dependency status
- Three independent job queues: `notifications`, `stats-updates`, `audit-logs`
- Automatic retry with exponential backoff on failures
- Dead-letter queue for permanent failures

## Quick Start

See [RUNBOOK.md](RUNBOOK.md) for detailed setup instructions.

```bash
npm install
npx prisma migrate dev --name init
npm run dev
npm run test:queue  # In another terminal
```

## Documentation

- **[RUNBOOK.md](RUNBOOK.md)** - Exact commands to run locally
- **[DECISIONS.md](DECISIONS.md)** - Technical decisions and trade-offs
- **[ANSWERS.md](ANSWERS.md)** - Written answers to assessment questions

## Key Features

### Connection Pooling
- Prisma manages database connection pools
- Configurable via `DATABASE_URL` environment variable
- Built-in connection lifecycle management

### Async Job Processing
- Three separate BullMQ queues for different job types
- Automatic retry with exponential backoff (1s → 2s → 4s)
- Dead-letter queue for failed jobs (never silently dropped)
- Independent worker concurrency per queue
- Fire-and-forget: Jobs queued immediately, don't block HTTP response

### Observability
- Structured logging with Pino
- Request ID tracking through log lines
- Health endpoint shows queue depth and dependency status
- Response time tracking for performance monitoring

### Error Handling
- Graceful shutdown with connection cleanup
- Unhandled errors log and retry automatically
- Validation at API boundary (400 errors for bad input)
- 503 responses when dependencies unavailable

## Performance

On local machine with SQLite:
- Application submission: 40-80ms
- Queue draining: 20 jobs → empty in 3-4 seconds
- Health check response: <10ms

## Production Deployment

Change `DATABASE_URL` from SQLite to MySQL:

```bash
DATABASE_URL=mysql://user:password@rds-host:3306/weapplyjobs
```

Increase connection pool size for 1,000+ concurrent users:

```
# In prisma/schema.prisma
datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
  connectionLimit = 50  # Increased from default 10
}
```

## Technology Stack

- **Runtime:** Node.js 18+
- **Framework:** Fastify (HTTP)
- **Database:** Prisma ORM (SQLite dev, MySQL production)
- **Queues:** BullMQ + Redis
- **Language:** TypeScript
- **Logging:** Pino

## Assessment Submission

This is a complete solution to the WeApplyJobs backend engineer take-home assessment covering:

1. **Part 1:** Production incident diagnosis with log analysis
2. **Part 2:** Architectural design for 1,000 concurrent users
3. **Part 3:** Working implementation of async job processing service
4. **Part 4:** Capacity planning calculations with formulas

All documentation, decisions, and code follow production standards.
