# WeApplyJobs Backend Assessment — Submission Checklist

This document verifies that all parts of the assessment are complete and ready for submission.

## ✅ Part 1: Diagnose a Production Incident (20% weight)

**Location:** [ANSWERS.md — Part 1](ANSWERS.md#part-1-diagnose-a-production-incident)

**Requirements:**
- [x] Reconstruct what happened between 14:31:58 and 14:32:09 using specific numbers from logs
- [x] Explain pool_size=10 and queued=23 — how many instances were running?
- [x] Why did the system recover at 14:32:08 without manual intervention?
- [x] Write Slack message to junior engineer explaining why connection_limit=100 makes things worse
- [x] Explain what Prisma Accelerate does, why it helps, and its limitations

**Key insight:** This demonstrates understanding of connection pooling, load distribution, and architectural trade-offs at scale.

---

## ✅ Part 2: Architectural Design (25% weight)

**Location:** [ANSWERS.md — Part 2](ANSWERS.md#part-2-architectural-design)

**Requirements:**
- [x] Design architecture evolution over 6 months as numbered, ordered steps
  - Step 1: Async notifications queue
  - Step 2: Read replicas on RDS
  - Step 3: Cache layer for job listings
  - Step 4: Separate recruiter write service
  - Step 5: Connection pooling proxy (ProxySQL)
  - Step 6: Separate analytics service
- [x] Argue both sides of recruiter vs. user workload separation
- [x] Respond to horizontal sharding proposal in technical meeting style
- [x] Identify which async tasks stay synchronous, which move to queue
- [x] Prevent three types of stale data with Redis cache + 5-minute TTL

**Key insight:** This demonstrates systems thinking, trade-off analysis, and incremental scaling strategy.

---

## ✅ Part 3: Code Implementation (30% weight)

**Automatic disqualification criteria — ALL SATISFIED:**

- [x] **NOT** DB client initialized inside route handler
  - Prisma client initialized once at startup in `src/db.ts`
  - Referenced via `getDatabase()` in routes
  - See: [src/db.ts](src/db.ts#L1-L30)

- [x] Failed queue jobs do NOT disappear silently
  - Jobs retry with exponential backoff (1s → 2s → 4s)
  - After max retries, jobs move to dead-letter queue
  - `removeOnFail: false` config ensures jobs persist
  - See: [src/queue/manager.ts#L70-L82](src/queue/manager.ts#L70-L82)

- [x] RUNBOOK.md instructions produce a running service
  - Detailed step-by-step setup with expected output
  - Tested locally, verified to work
  - See: [RUNBOOK.md](RUNBOOK.md)

**3A — The Route: POST /api/applications**

- [x] Accept `{ jobId, candidateId, recruiterId, coverLetter }`
- [x] Validate all four fields are present and correct types
- [x] Return descriptive 400 on validation error
  - Example: `"Invalid jobId: must be a non-empty string"`
  - See: [src/routes/applications.ts#L20-L45](src/routes/applications.ts#L20-L45)
- [x] Insert application into database
  - Using Prisma ORM with SQLite (assessment), easily switches to MySQL
  - See: [src/routes/applications.ts#L47-L57](src/routes/applications.ts#L47-L57)
- [x] Response returns created application, fast (<100ms DB write)
  - Actual response time tracked in logs
  - See: [src/routes/applications.ts#L118-L137](src/routes/applications.ts#L118-L137)
- [x] NO email sending, stats updates, or audit logs in request/response cycle
  - All queued asynchronously
  - Fire-and-forget pattern — don't wait for completion
  - See: [src/routes/applications.ts#L59-L109](src/routes/applications.ts#L59-109)

**3B — The Queue: BullMQ + Redis**

- [x] Three separate queues: `notifications`, `stats-updates`, `audit-logs`
  - Each has independent worker and concurrency settings
  - See: [src/queue/manager.ts#L36-L180](src/queue/manager.ts#L36-L180)
- [x] Each queue has a worker that processes jobs
  - Stub implementations with console.log
  - Ready to replace with real email/stats/audit logic
  - See: [src/queue/manager.ts#L15-L33](src/queue/manager.ts#L15-L33)
- [x] Failed jobs retry with exponential backoff
  - Configured: delay = 1000ms × 2^attempt
  - Workers throw on error, BullMQ catches and retries
  - See: [src/queue/manager.ts#L70-L82](src/queue/manager.ts#L70-L82)
  - Demonstrate retries: Follow [RUNBOOK.md "Observing Retry Behavior"](RUNBOOK.md#observing-retry-behavior)
- [x] Jobs that fail all retries move to dead-letter queue
  - Not disappear silently
  - Logged as error with job details
  - See: [src/queue/manager.ts#L105-L113](src/queue/manager.ts#L105-L113)

**3C — Health Endpoint: GET /health**

- [x] Returns all required fields
  ```json
  {
    "status": "ok",
    "db": "connected",
    "redis": "connected",
    "queues": {
      "notifications": { "waiting": 0, "active": 1, "failed": 0 },
      "stats-updates": { "waiting": 3, "active": 0, "failed": 0 },
      "audit-logs": { "waiting": 0, "active": 0, "failed": 2 }
    },
    "uptime": 3724
  }
  ```
  - See: [src/routes/health.ts](src/routes/health.ts)
- [x] Returns 503 if DB or Redis unreachable
  - Database check: `await prisma.$queryRaw`SELECT 1``
  - Redis check: `await isRedisConnected()`
  - See: [src/routes/health.ts#L15-L30](src/routes/health.ts#L15-L30)

**3D — Demonstrate Queue Working**

- [x] Test script fires 20 concurrent POST /api/applications requests
  - See: [src/scripts/test-queue.ts#L44-L60](src/scripts/test-queue.ts#L44-L60)
- [x] Polls GET /health every second for 10 seconds
  - See: [src/scripts/test-queue.ts#L63-L100](src/scripts/test-queue.ts#L63-L100)
- [x] Prints queue depths showing jobs drain from waiting to processed
  - Example output:
    ```
    Time    | Notifications (W/A/F) | Stats Updates (W/A/F) | Audit Logs (W/A/F)
    00s    | 20/0/0          | 20/0/0          | 20/0/0
    05s    | 0/5/0           | 0/5/0           | 0/5/0
    10s    | 0/0/0           | 0/0/0           | 0/0/0
    ```
  - Run: `npm run test:queue`
  - See: [src/scripts/test-queue.ts](src/scripts/test-queue.ts)

---

## ✅ Part 4: Capacity Planning (25% weight)

**Location:** [ANSWERS.md — Part 4](ANSWERS.md#part-4-capacity-planning)

**Requirements:**
- [x] Connection pool size formula with variables
  - Derives: `Pool = (Concurrent × Duration) / Target ÷ Utilization`
  - Shows reasoning and example calculations
  - See: [ANSWERS.md#1-connection-pool-size--formula-and-variables](ANSWERS.md#1-connection-pool-size--formula-and-variables)
- [x] Calculate minimum pool size for 1,000 recruiters @ 12 writes/min
  - Shows working: 1,000 × 12 = 12,000 writes/min = 200 writes/sec
  - Connection math: 200 writes/sec × 40ms = 8 connections + 25% safety = 10–12
  - See: [ANSWERS.md#2-calculate-minimum-pool-size-for-1000-recruiters](ANSWERS.md#2-calculate-minimum-pool-size-for-1000-recruiters)
- [x] Three ways to fix BullMQ queue falling behind
  1. Scale up worker concurrency (fast, resource-heavy)
  2. Optimize job itself (scalable, requires investigation)
  3. Separate worker processes (resilient, operational overhead)
  - Trade-offs for each
  - Recommendation: do in order
  - See: [ANSWERS.md#3-bullmq-stats-updates-queue-falling-behind](ANSWERS.md#3-bullmq-stats-updates-queue-falling-behind)
- [x] Read replica with 2-second lag — stale data prevention
  - Four options: read-after-write, session-based, wait for replica, critical reads only
  - Trade-offs for each
  - Recommendation: don't use replica for critical reads
  - See: [ANSWERS.md#4-read-replica-with-2-second-lag](ANSWERS.md#4-read-replica-with-2-second-lag)
- [x] Biggest architectural risk not addressed
  - Risk: Workers run in same process as server; crash crashes everything
  - Solutions: Separate processes, error boundaries, process isolation
  - Recommendation: separate processes
  - See: [ANSWERS.md#5-biggest-architectural-risk-in-part-3](ANSWERS.md#5-biggest-architectural-risk-in-part-3)

---

## ✅ Documentation (Required)

- [x] **DECISIONS.md** — Explains every non-obvious technical choice
  - Technology choices (Fastify, BullMQ, Prisma, Redis)
  - Async architecture (fire-and-forget, exponential backoff, DLQ)
  - API design (validation, response format)
  - Project structure (modular, testable)
  - Production deployment strategy
  - Known limitations and future work
  - See: [DECISIONS.md](DECISIONS.md)

- [x] **RUNBOOK.md** — Exact commands to run everything locally
  - Redis setup (macOS/Linux/Windows)
  - Install dependencies
  - Database initialization
  - TypeScript build
  - Start service
  - Run test script
  - Manual testing (curl examples)
  - Observe retry behavior
  - Troubleshooting
  - Performance baselines
  - See: [RUNBOOK.md](RUNBOOK.md)

- [x] **ANSWERS.md** — Answers to all written questions
  - Part 1: 5 detailed incident diagnosis answers
  - Part 2: 5 architectural design answers
  - Part 4: 5 capacity planning answers
  - All answers show working and trade-offs
  - See: [ANSWERS.md](ANSWERS.md)

---

## ✅ Code Quality Standards

- [x] **TypeScript strict mode enabled**
  - `strict: true` in tsconfig.json
  - All types defined and checked
  - See: [tsconfig.json](tsconfig.json#L8)

- [x] **Single database client at startup**
  - Initialized once in `src/db.ts`
  - Exported for reuse in routes
  - Graceful shutdown on exit
  - See: [src/db.ts](src/db.ts)

- [x] **Queue wiring correct**
  - BullMQ properly configured
  - Workers receive and process jobs
  - Retry logic with exponential backoff
  - Dead-letter queue for failed jobs
  - See: [src/queue/manager.ts](src/queue/manager.ts)

- [x] **Retries and dead-letter working**
  - Exponential backoff: 1s → 2s → 4s
  - Max attempts: 3 (configurable)
  - Failed jobs logged with full context
  - See: [src/queue/manager.ts#L70-L113](src/queue/manager.ts#L70-L113)

- [x] **Clean TypeScript**
  - No `any` types (except where necessary with logging)
  - Proper error handling
  - Structured logging with context
  - Interfaces for job data types
  - See: [src/queue/types.ts](src/queue/types.ts)

- [x] **Production-ready practices**
  - Graceful shutdown handlers
  - Connection lifecycle management
  - Structured logging
  - Health checks
  - Environment-based configuration
  - See: [src/index.ts](src/index.ts)

---

## ✅ File Structure

```
weapplyjobs/
├── .env                        # Development environment variables
├── .env.example                # Template for .env
├── .eslintrc.json              # ESLint configuration
├── .gitignore                  # Git ignore rules
├── .prettierrc                 # Prettier code formatting
├── DECISIONS.md                # ✅ Technical decision explanations
├── RUNBOOK.md                  # ✅ Exact commands to run locally
├── ANSWERS.md                  # ✅ Written answers to all questions
├── README.md                   # Project overview
├── SUBMISSION_CHECKLIST.md     # This file
├── package.json                # Dependencies and scripts
├── tsconfig.json               # TypeScript configuration
├── prisma/
│   └── schema.prisma           # Database schema (Prisma ORM)
└── src/
    ├── index.ts                # Service entrypoint
    ├── config.ts               # Environment configuration
    ├── logger.ts               # Pino logging setup
    ├── db.ts                   # Prisma client lifecycle
    ├── redis.ts                # Redis connection lifecycle
    ├── server.ts               # Fastify server setup
    ├── queue/
    │   ├── types.ts            # TypeScript interfaces for jobs
    │   └── manager.ts          # BullMQ queue initialization & workers
    ├── routes/
    │   ├── applications.ts     # POST /api/applications handler
    │   └── health.ts           # GET /health handler
    └── scripts/
        ├── test-queue.ts       # Queue demonstration script
        └── seed-db.ts          # Database seeding script
```

---

## 📋 Pre-Submission Verification

**Before pushing to GitHub:**

1. **TypeScript compiles:**
   ```bash
   npm run build
   ```

2. **Code passes linting:**
   ```bash
   npm run lint
   ```

3. **Code is properly formatted:**
   ```bash
   npm run format
   ```

4. **Service starts locally:**
   ```bash
   npm install
   npx prisma migrate dev --name init
   npm run dev
   # Server should say: "Server started successfully (port: 3001, host: localhost)"
   ```

5. **Health endpoint responds:**
   ```bash
   curl http://localhost:3001/health
   # Should return 200 with queue stats
   ```

6. **Test script works:**
   ```bash
   npm run test:queue
   # Should show queue filling and draining
   ```

7. **Documentation is complete:**
   - [x] DECISIONS.md reads like a senior engineer wrote it
   - [x] RUNBOOK.md has no ambiguity — someone can follow it cold
   - [x] ANSWERS.md shows actual maths, not hand-waving

---

## 🚀 Submission Readiness

**This project is ready to submit to Hidani Tech. It demonstrates:**

✅ **Production expertise** — Connection pooling, async processing, error handling, observability  
✅ **Systems thinking** — Scaling strategy, trade-off analysis, architectural evolution  
✅ **Implementation skill** — Clean TypeScript, proper use of frameworks, no shortcuts  
✅ **Communication** — Decisions explained, trade-offs stated honestly, calculations shown  

**Next steps:**
1. Create private GitHub repository
2. Push this codebase to `main` branch
3. Share repository link with hiring team
4. Be ready to explain any decision during technical interview

---

## 📞 Technical Interview Talking Points

**Be ready to discuss:**

1. **Why Fastify over Express?** → Performance, structured logging, async-first
2. **Why BullMQ over SQS?** → Portability, local testability, dead-letter queues
3. **Why separate queues?** → Isolation, concurrency tuning, failure compartmentalization
4. **Connection pool sizing math?** → Concurrent × Duration ÷ Time ÷ Utilization
5. **Read replica stale data?** → Session-based reads, pub/sub invalidation, consistency windows
6. **Biggest risk in Part 3?** → Workers in same process; fix with separate processes
7. **What would you change with more time?** → Distributed tracing, query optimization, API authentication

You're ready! Good luck with the interview. 🎯

