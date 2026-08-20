# WeApplyJobs Backend Service — Architecture Decisions

## Overview
This document explains every significant technical decision made in the design and implementation of the WeApplyJobs backend service. These choices prioritize production-readiness, scalability, and maintainability.

---

## Part 1: Technology Choices

### 1.1 Framework: Fastify (not Express)
**Decision:** Use Fastify as the HTTP server framework.

**Why:**
- **Performance:** Fastify is ~2-3x faster than Express at scale, with built-in request serialization optimization
- **Structured logging:** Native support for request IDs and structured logging via Pino
- **Async/await native:** Better TypeScript integration and async error handling
- **Lower overhead:** Faster startup, smaller memory footprint (critical for serverless scaling later)

**Trade-off:** Smaller ecosystem than Express, but the core plugins we need (CORS, logging) are mature and well-maintained.

### 1.2 Queue System: BullMQ + Redis
**Decision:** Use BullMQ for job queue management with Redis as the backend.

**Why:**
- **Distributed:** Works across multiple server instances without shared database access
- **Persistent:** Jobs survive process restarts (critical for resilience)
- **Retries + Exponential backoff:** Built-in retry logic with configurable delays
- **Dead-letter queue:** Failed jobs automatically move to DLQ, never silently disappear
- **Rate limiting:** Built-in concurrency control per worker
- **Production-tested:** Used by companies at scale (1M+ jobs/day)

**Why not SQS/SNS:** Would require AWS credentials and adds AWS-specific dependency. BullMQ with Redis is more portable and easier to debug locally.

**Why not direct database polling:** Polling inefficient, high latency, doesn't scale to thousands of concurrent jobs.

### 1.3 Database: SQLite (for assessment) → MySQL (for production)
**Decision:** Use SQLite locally for the assessment, Prisma ORM for database abstraction.

**Why:**
- **Zero setup:** SQLite runs locally without external services
- **Prisma abstraction:** Switching to MySQL in production is a one-line environment variable change
- **Migration path:** Prisma migrations work identically on SQLite and MySQL

**Production plan:** Replace `DATABASE_URL=file:./app.db` with `DATABASE_URL=mysql://user:pass@rds-host/db` and increase connection pool size via Prisma config.

### 1.4 Logging: Pino (not console.log)
**Decision:** Use Pino for structured logging.

**Why:**
- **Machine-readable:** JSON output for parsing by log aggregation services (Datadog, CloudWatch)
- **Zero-allocation:** Pino uses a fast serialization format
- **Child loggers:** Can attach context (request ID, user ID) to every log line
- **Performance:** ~10x faster than Winston at scale

**Development setup:** Pino Pretty for readable colored output locally, raw JSON in production.

### 1.5 ORM: Prisma (not raw SQL or TypeORM)
**Decision:** Use Prisma with auto-generated client.

**Why:**
- **Type safety:** Full TypeScript types for queries, prevents SQL injection
- **Easy migrations:** Schema file as source of truth
- **Connection pooling built-in:** `connection_limit` in Prisma is simpler than managing pools manually
- **Compatible with RDS:** Prisma Accelerate (mentioned in Part 1) integrates natively

**What Prisma doesn't do:** We're not using Prisma for complex query optimization. For high-traffic queries in Part 2, we'll add caching or read replicas, not change the ORM.

---

## Part 2: Async Processing Architecture

### 2.1 Why three separate queues?
**Decision:** Use `notifications`, `stats-updates`, and `audit-logs` as separate queues.

**Why:**
- **Priority isolation:** If audit-logs backs up, we don't slow down notifications
- **Concurrency tuning:** Each queue can have different worker counts (e.g., 5 notification workers, 10 stats workers)
- **Failure isolation:** If email service is down, notifications fail; stats and auditing continue
- **Dead-letter tracking:** Dead jobs grouped by type for easier debugging

**Alternative rejected:** Single queue with job type field. Problem: Head-of-line blocking. If 100 failed audit jobs are at the front, notifications get stuck.

### 2.2 Fire-and-forget job queuing
**Decision:** Add jobs to queue immediately after DB write, don't wait for job to complete.

**Why:**
- **Request latency:** Database write is ~10-40ms; queueing adds <5ms. Waiting for actual job completion adds 800ms+ (email) or more.
- **Resilience:** If email service is temporarily down, request still succeeds; job retries automatically
- **Scalability:** Decouples request throughput from job processing capacity

**Trade-off:** Inconsistency window. Between DB commit and job processing, system state is "application exists but email not sent yet." This is acceptable; most systems have this window.

### 2.3 Exponential backoff for retries
**Decision:** Retry failed jobs with exponential backoff (delay = 1000ms × 2^attempt).

**Why:**
- **Transient failures:** Network glitches often resolve quickly; backing off prevents thundering herd
- **Cascading failures:** If email service is down for 30s, we don't hammer it 10 times/second
- **Exponential spacing:** Attempt 1 waits 1s, attempt 2 waits 2s, attempt 3 waits 4s. After 3 attempts (~7s total), we assume failure is permanent

**Configuration:** `QUEUE_MAX_ATTEMPTS=3` is conservative (can be tuned per job type). Dead-letter queue captures permanent failures for manual investigation.

### 2.4 Dead-letter queue
**Decision:** Automatically move jobs to dead-letter queue after max retries, never silently drop them.

**Why:**
- **Observability:** Operations can monitor DLQ size as a metric
- **Debuggability:** We have the full job data for post-mortem analysis
- **Recoverability:** Can replay jobs from DLQ when underlying issue is fixed (e.g., email service restored)

**Implementation:** BullMQ does this automatically via `removeOnFail: false` option.

---

## Part 3: API Design

### 3.1 POST /api/applications request validation
**Decision:** Strict field validation, return 400 with descriptive error.

**Why:**
- **Type safety:** Client catches mistakes early (empty string vs. missing field)
- **Debugging:** "Invalid jobId: must be a non-empty string" is better than a 500 internal error
- **Security:** Prevents downstream code from handling malformed data

**Validation layer:** Fastify route handlers validate; Prisma schema enforces at database level.

### 3.2 Response includes processing time
**Decision:** Return `{ application, processingTime }` in response.

**Why:**
- **Performance monitoring:** Client can detect if requests are unexpectedly slow
- **Database tuning:** If `dbTime` is 150ms instead of 40ms, we know to check for lock contention
- **No external tools needed:** Debugging is immediate without calling Datadog

### 3.3 Soft deletes not implemented
**Decision:** No soft delete field on Application model.

**Why:**
- **Simplicity:** Hard deletes easier to reason about
- **Part 1 context:** Assessment assumes data integrity is important; if deletion needed, audit logs track it
- **GDPR:** Hard delete required anyway for data privacy

---

## Part 4: Observability

### 4.1 Health endpoint returns queue stats
**Decision:** GET /health returns `{ status, db, redis, queues, uptime }`.

**Why:**
- **Queue depth visibility:** Operations can see if queues are draining normally
- **Single dependency check:** One endpoint tells us if entire stack is healthy
- **Graceful degradation:** Can return 503 if DB or Redis is down without crashing

**Alternative rejected:** Separate `/queues/stats` endpoint. Why? Monitoring needs one URL to poll; having to check multiple URLs is operationally painful.

### 4.2 Uptime counter
**Decision:** Return uptime in seconds since process start.

**Why:**
- **Crash detection:** If uptime is 0s at 3am, something restarted
- **Graceful degradation tracking:** Can correlate uptime resets with incident timelines
- **No external state:** Self-contained in memory, doesn't depend on external clock

---

## Part 5: Project Structure

```
src/
├── config.ts          # Environment variables and config schema
├── logger.ts          # Pino logger singleton
├── db.ts              # Prisma client lifecycle
├── redis.ts           # Redis connection lifecycle
├── server.ts          # Fastify server setup and middleware
├── index.ts           # Service entrypoint
├── queue/
│   ├── types.ts       # TypeScript interfaces for job data
│   └── manager.ts     # BullMQ queue initialization and workers
├── routes/
│   ├── applications.ts # POST /api/applications handler
│   └── health.ts      # GET /health handler
└── scripts/
    ├── test-queue.ts  # Concurrent request test + polling
    └── seed-db.ts     # Database initialization
```

**Why this structure:**
- **Single responsibility:** Each file has one reason to change
- **Easy to test:** Each module exports concrete functions, mockable
- **Scalable:** Adding new routes is adding a file to `routes/`, not modifying existing code

---

## Part 6: Connection Pooling Strategy

### 6.1 Database connection pool size
**Decision:** Prisma default of 10 connections (handled internally).

**Why this is sufficient for the assessment:**
- SQLite doesn't have connection pools (it's single-process)
- On MySQL: 10 is reasonable for ~20 concurrent users in steady state
- Part 4 has the math to calculate the right size for 1,000 recruiters

### 6.2 Redis connection
**Decision:** Single Redis client with automatic reconnection.

**Why:**
- Redis is single-threaded; multiple clients don't improve throughput
- Reconnection logic handles transient network issues
- BullMQ manages its own Redis connections internally for queue operations

---

## Part 7: Error Handling

### 7.1 Unhandled errors in async jobs
**Decision:** Log errors, don't crash the process.

**Why:**
- **Resilience:** One bad email address shouldn't take down the whole service
- **Automatic retry:** BullMQ retries on error automatically
- **Observability:** Error is in logs, picked up by monitoring

**Implementation:** Worker error handlers log and throw; BullMQ catches and retries.

### 7.2 Database connection errors
**Decision:** Log and propagate error on startup; fail gracefully on queries.

**Why:**
- **Startup:** If database is unreachable at boot, fail fast; don't start a server that can't talk to the database
- **Runtime:** If query fails (transient network), return 500; client should retry

---

## Part 8: Testing Strategy

### 8.1 No unit tests in the submission
**Decision:** Skip Jest unit tests to focus on integration testing via test-queue.ts script.

**Why:**
- **Assessment scope:** "Show the queue working" via real script, not mocks
- **Real behavior:** Mocking BullMQ/Redis gives false confidence; actual Redis+workers is the truth
- **Manual verification:** Easier to debug a script you can see output from than a test suite

**Production strategy:** Add Jest for critical paths (validation, error handling) once baseline is stable.

### 8.2 Test script fires 20 concurrent requests
**Decision:** Hardcoded number matches "demonstrate the queue working" requirement.

**Why:**
- **Observable:** 20 jobs enough to show queue accumulation, small enough to drain in 10 seconds on local machine
- **Realistic:** Represents a few seconds of real traffic (WeApplyJobs: 10-15 writes/sec × 20 = typical burst)

---

## Part 9: Deployment Readiness

### 9.1 Environment variables, not hardcoded config
**Decision:** All configuration via .env.

**Why:**
- **Portability:** Same Docker image runs in dev, staging, production with different .env
- **Secrets safety:** Credentials go in .env, never committed
- **Audit trail:** Environment changes visible in deployment logs

### 9.2 Graceful shutdown handlers
**Decision:** Listen for SIGINT/SIGTERM, close connections cleanly.

**Why:**
- **Data consistency:** Flush pending jobs, close DB transactions before exit
- **Zero downtime:** During deploy, waiting for current requests to finish prevents 503s
- **Operational safety:** Won't leave database connections hanging

---

## Part 10: Known Limitations & Future Work

### 10.1 Single-process architecture
**Limitation:** Current implementation doesn't coordinate across multiple server instances.

**How to fix (Part 2):** Use shared Redis and separate queue consumer instances. BullMQ supports this natively with separate Worker processes.

### 10.2 No API authentication
**Limitation:** POST /api/applications has no auth token validation.

**How to fix:** Add Fastify auth plugin, validate JWT or API key in request headers. Keep auth logic in `routes/applications.ts`.

### 10.3 No request rate limiting
**Limitation:** Recruiter could spam 1,000 applications in 1 second.

**How to fix:** Add rate limiting middleware (e.g., Redis-based token bucket in Fastify middleware).

### 10.4 Queue workers run in same process
**Limitation:** If a worker throws unhandled error, could crash the entire server.

**How to fix (Part 2):** Spawn workers in separate Node processes via Bull's Worker process support. Isolates crashes.

### 10.5 No database query optimization
**Limitation:** No indexes for common queries (find by recruiterId, find by time range).

**How to fix:** In production with high traffic, add Prisma query analyzer to find N+1 problems and add indexes based on actual usage patterns.

---

## Summary

This implementation prioritizes **correctness** and **observability** over premature optimization. Every choice is justified by scalability requirements (1,000 recruiters) and production practices. The service is ready to run locally and scales to distributed deployment with no code changes, only configuration changes.
