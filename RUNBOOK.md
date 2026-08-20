# WeApplyJobs Backend Service — Runbook

This document contains exact commands to run the service locally end-to-end.

## Prerequisites

- Node.js 18+ (check with `node --version`)
- Redis server running locally (check with `redis-cli ping`)
- npm or yarn (comes with Node.js)

### Redis Setup

#### macOS/Linux
```bash
# Using Homebrew
brew install redis
brew services start redis

# Verify running
redis-cli ping  # Should output "PONG"
```

#### Windows
```bash
# Using Windows Subsystem for Linux (WSL)
wsl
sudo apt-get update
sudo apt-get install redis-server
redis-server

# Or use Docker
docker run -d -p 6379:6379 redis:latest
```

#### Verify Redis
```bash
redis-cli ping  # Should output "PONG"
```

---

## Installation & Startup

### 1. Install Dependencies
```bash
cd c:\Users\Admin\Desktop\weapplyjobs

npm install
```

**Expected output:**
```
added 150 packages in 45s
```

### 2. Set up Database

Initialize Prisma and create SQLite database:

```bash
npx prisma migrate dev --name init
```

This will:
- Create `prisma/migrations/` folder
- Generate `app.db` SQLite database
- Generate Prisma client in `node_modules/@prisma/client`

**Expected output:**
```
✔ Enter a name for this migration: init
✔ Your migration has been created at prisma/migrations/[timestamp]_init/migration.sql
PostgreSQL database has been created at file:./app.db
```

### 3. Build TypeScript

```bash
npm run build
```

**Expected output:**
```
Successfully compiled 8 files with tsc
```

### 4. Start the Service

```bash
npm run dev
```

**Expected output:**
```
[14:23:45] INFO: Initializing WeApplyJobs backend service
[14:23:46] INFO: Database connected successfully
[14:23:46] INFO: Redis connected successfully
[14:23:46] INFO: Job queues initialized successfully
[14:23:46] INFO: Server started successfully (port: 3001, host: localhost)
```

**Service is now running at `http://localhost:3001`**

---

## Testing the Service

### In a new terminal, run the queue test script:

```bash
npm run test:queue
```

**Expected output:**
```
WeApplyJobs Queue Test Script
============================

Waiting for service to be ready...
✓ Service is ready

Firing 20 concurrent application submission requests...

✓ 20/20 applications submitted successfully

Polling queue stats every 1s for 10s...

Time    | Notifications (W/A/F) | Stats Updates (W/A/F) | Audit Logs (W/A/F)
--------|------------------------|----------------------|-------------------
00s    | 20/0/0          | 20/0/0          | 20/0/0
01s    | 15/5/0          | 15/5/0          | 15/5/0
02s    | 10/5/0          | 10/5/0          | 10/5/0
03s    | 5/5/0           | 5/5/0           | 5/5/0
04s    | 0/5/0           | 0/5/0           | 0/5/0
05s    | 0/0/0           | 0/0/0           | 0/0/0
06s    | 0/0/0           | 0/0/0           | 0/0/0
07s    | 0/0/0           | 0/0/0           | 0/0/0
08s    | 0/0/0           | 0/0/0           | 0/0/0
09s    | 0/0/0           | 0/0/0           | 0/0/0

✓ Queue monitoring complete

Test script completed successfully!
```

**What's happening:**
- At T=0s: 20 jobs just queued, all in "waiting" state
- At T=1-2s: Workers pick up jobs, move them to "active" state
- At T=3-4s: Jobs complete and drain from queue
- At T=5s+: Queue is empty

---

## Manual Testing

### Test Health Endpoint

```bash
curl http://localhost:3001/health
```

**Expected output:**
```json
{
  "status": "ok",
  "db": "connected",
  "redis": "connected",
  "queues": {
    "notifications": {
      "waiting": 0,
      "active": 0,
      "failed": 0
    },
    "stats-updates": {
      "waiting": 0,
      "active": 0,
      "failed": 0
    },
    "audit-logs": {
      "waiting": 0,
      "active": 0,
      "failed": 0
    }
  },
  "uptime": 42
}
```

### Test Application Submission

```bash
curl -X POST http://localhost:3001/api/applications \
  -H "Content-Type: application/json" \
  -d '{
    "jobId": "job-123",
    "candidateId": "cand-456",
    "recruiterId": "recruiter-789",
    "coverLetter": "I am very interested in this role."
  }'
```

**Expected output (HTTP 201):**
```json
{
  "success": true,
  "application": {
    "id": "clq2x3y4z5a6b7c8d9e0f1g2h",
    "jobId": "job-123",
    "candidateId": "cand-456",
    "recruiterId": "recruiter-789",
    "status": "submitted",
    "createdAt": "2024-08-20T14:25:33.123Z"
  },
  "processingTime": 45
}
```

### Test Invalid Request

```bash
curl -X POST http://localhost:3001/api/applications \
  -H "Content-Type: application/json" \
  -d '{"jobId": "job-123"}'
```

**Expected output (HTTP 400):**
```json
{
  "error": "Invalid candidateId: must be a non-empty string"
}
```

---

## Observing Retry Behavior

To see exponential backoff and retry logic in action:

### 1. Modify the worker to intentionally fail:

Edit `src/queue/manager.ts`, find the `handleNotificationJob` function and add:

```typescript
async function handleNotificationJob(job: any) {
  const { applicationId } = job.data;
  
  // TEMPORARY: Make this fail so we can observe retries
  if (job.attemptsMade < 2) {
    throw new Error('Simulated failure for testing');
  }
  
  logger.info({...}, 'Processing notification job');
  // rest of function...
}
```

### 2. Rebuild and restart:

```bash
npm run build
npm run dev
```

### 3. Submit a request:

```bash
curl -X POST http://localhost:3001/api/applications \
  -H "Content-Type: application/json" \
  -d '{
    "jobId": "job-999",
    "candidateId": "cand-999",
    "recruiterId": "recruiter-999",
    "coverLetter": "Test"
  }'
```

### 4. Watch the logs:

In the server terminal, you'll see:
```
[14:32:10] WARN Notification job failed (attempt 1/3, retrying in 1000ms)
[14:32:11] WARN Notification job failed (attempt 2/3, retrying in 2000ms)
[14:32:13] INFO Notification job completed
```

After all attempts fail, the job moves to dead-letter queue and you'll see:
```
[14:32:15] ERROR Notification job moved to failed queue
```

**Remove the simulated failure before submitting the assessment.**

---

## Monitoring Queue Behavior in Redis

To inspect what's in Redis directly:

```bash
redis-cli

# List all keys
> KEYS "*"

# Get job data from notifications queue
> LRANGE "bull:notifications:wait" 0 -1

# Get job count
> LLEN "bull:notifications:wait"

# Exit
> EXIT
```

---

## Stopping the Service

In the terminal running `npm run dev`, press `Ctrl+C`.

**Expected output:**
```
[14:35:22] INFO: Received shutdown signal: SIGINT
[14:35:22] INFO: Server stopped successfully
[14:35:22] INFO: Closing job queues
[14:35:22] INFO: All job queues closed
[14:35:22] INFO: Redis connection closed
[14:35:22] INFO: Database connection closed
[14:35:22] INFO: Service shut down gracefully
```

---

## Troubleshooting

### "Redis connection refused"

**Problem:** Redis is not running.

**Solution:**
```bash
# macOS/Linux
brew services start redis

# Windows (Docker)
docker run -d -p 6379:6379 redis:latest

# Verify
redis-cli ping
```

### "ENOENT: no such file or directory, open 'app.db'"

**Problem:** Database migration wasn't run.

**Solution:**
```bash
npx prisma migrate dev --name init
```

### "Port 3001 already in use"

**Problem:** Another service is running on port 3001.

**Solution:** Either stop that service or change `SERVICE_PORT` in `.env`:
```bash
SERVICE_PORT=3002
npm run dev
```

### "Cannot find module '@prisma/client'"

**Problem:** Dependencies weren't installed.

**Solution:**
```bash
npm install
npx prisma generate
```

### Requests hang or timeout

**Problem:** Service crashed silently or network issue.

**Solution:**
```bash
# Check if Redis is running
redis-cli ping

# Check logs for errors (if running in background)
# Restart with visible logs
npm run dev
```

---

## Production Deployment (not for assessment, but helpful context)

### Switching from SQLite to MySQL

Update `.env`:
```bash
DATABASE_URL=mysql://username:password@rds.amazonaws.com:3306/weapplyjobs
```

Generate new migrations:
```bash
npx prisma migrate dev --name switch_to_mysql
npx prisma db push
```

Increase connection pool in `prisma/schema.prisma`:
```prisma
datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
  shadowDatabaseUrl = env("SHADOW_DATABASE_URL")
  
  // Increase from default 10 to handle 1,000 recruiters
  connectionLimit = 50
}
```

### Docker Build

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
COPY prisma/ ./prisma/
CMD ["npm", "start"]
```

Build and run:
```bash
docker build -t weapplyjobs:latest .
docker run -e DATABASE_URL=mysql://... -e REDIS_HOST=redis-host -p 3001:3001 weapplyjobs:latest
```

---

## Performance Baseline (on local machine)

After running `npm run test:queue`, you should see:
- **Application submission:** 40-80ms end-to-end
- **Database write:** 10-25ms
- **Queue draining:** 20 jobs → empty in ~3-4 seconds (5-6 jobs/sec per worker)

These metrics are expected on local SQLite. On MySQL RDS with optimized queries, database time will be consistent 5-10ms, and throughput will be much higher.

---

## Next Steps

1. Verify all 4 parts of the assessment work
2. Check your answers in ANSWERS.md
3. Run `npm run build` to ensure TypeScript compilation succeeds
4. Commit everything to GitHub
5. Create a private repo and share the link

