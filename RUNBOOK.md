# How to Run the Service

## What You Need Before Starting

1. **Node.js 18 or newer**
   - Check: `node --version`
   - If you don't have it, download from nodejs.org

2. **Redis** (the database for job queues)
   - Check: `redis-cli ping` (should say PONG)
   - If not running, start it

3. **npm** (comes with Node.js)

## Start Redis

### On Mac
```bash
brew install redis
brew services start redis
redis-cli ping
```

### On Linux
```bash
sudo apt-get install redis-server
redis-server
```

### On Windows
Use Docker:
```bash
docker run -d -p 6379:6379 redis:latest
```

Test it:
```bash
redis-cli ping
```

Should say: `PONG`

## Step 1: Install Dependencies

```bash
cd c:\Users\Admin\Desktop\weapplyjobs
npm install
```

This takes 1-2 minutes. It downloads Fastify, BullMQ, and other packages.

## Step 2: Create the Database

```bash
npx prisma migrate dev --name init
```

This creates a SQLite database file (`app.db`).

Output will look like:
```
✔ Your migration has been created at prisma/migrations/[timestamp]_init/migration.sql
SQLite database has been created at file:./app.db
```

## Step 3: Start the Service

```bash
npm run dev
```

Output will look like:
```
[14:23:45] INFO: Initializing WeApplyJobs backend service
[14:23:46] INFO: Database connected successfully
[14:23:46] INFO: Redis connected successfully
[14:23:46] INFO: Job queues initialized successfully
[14:23:46] INFO: Server started successfully (port: 3001, host: localhost)
```

**Leave this terminal open.** The service is now running on `http://localhost:3001`.

## Step 4: Test It Works

Open a new terminal and run:

```bash
npm run test:queue
```

You should see:

```
Firing 20 concurrent application submission requests...
✓ 20/20 applications submitted successfully

Polling queue stats every 1s for 10s...

Time    | Notifications | Stats Updates | Audit Logs
--------|------|------|------
00s    | 20/0/0     | 20/0/0     | 20/0/0
01s    | 15/5/0     | 15/5/0     | 15/5/0
02s    | 10/5/0     | 10/5/0     | 10/5/0
03s    | 5/5/0      | 5/5/0      | 5/5/0
04s    | 0/5/0      | 0/5/0      | 0/5/0
05s    | 0/0/0      | 0/0/0      | 0/0/0
```

This is perfect. It shows:
- Jobs are created (20/0/0 means 20 waiting, 0 active, 0 failed)
- Workers pick them up (they move to active)
- Jobs complete (they disappear from the queue)

**If this works, the service is set up correctly.**

## Manual Testing with Curl

### Check Health

```bash
curl http://localhost:3001/health
```

Response:
```json
{
  "status": "ok",
  "db": "connected",
  "redis": "connected",
  "uptime": 42
}
```

If you get `status: "ok"`, everything is working.

If you get `status: "degraded"` or 503, something is down.

### Submit an Application

```bash
curl -X POST http://localhost:3001/api/applications \
  -H "Content-Type: application/json" \
  -d '{
    "jobId": "job-123",
    "candidateId": "candidate-456",
    "recruiterId": "recruiter-789",
    "coverLetter": "I am interested"
  }'
```

Should return:
```json
{
  "success": true,
  "application": {
    "id": "clq2x3y4...",
    "jobId": "job-123",
    "status": "submitted",
    "createdAt": "2024-08-20T14:25:33.123Z"
  },
  "processingTime": 45
}
```

The `processingTime` should be 30-80 milliseconds. That's fast.

### Test Validation (Bad Request)

```bash
curl -X POST http://localhost:3001/api/applications \
  -H "Content-Type: application/json" \
  -d '{
    "jobId": "job-123"
  }'
```

Should return error (HTTP 400):
```json
{
  "error": "Invalid candidateId: must be a non-empty string"
}
```

Good. The API is checking that all fields are provided.

## Watch Jobs Retry

To see retry logic in action:

1. Edit `src/queue/manager.ts`
2. Find `handleNotificationJob` (around line 21)
3. Add this code:

```typescript
async function handleNotificationJob(job: any) {
  const { applicationId, email } = job.data;
  
  // Make it fail on purpose
  if (job.attemptsMade < 2) {
    throw new Error('Test failure');
  }
  
  console.log(`Sending email to ${email}`);
  return { success: true };
}
```

4. Rebuild and restart:
```bash
npm run build
npm run dev
```

5. Submit an application:
```bash
curl -X POST http://localhost:3001/api/applications \
  -H "Content-Type: application/json" \
  -d '{
    "jobId": "test",
    "candidateId": "test",
    "recruiterId": "test",
    "coverLetter": "test"
  }'
```

6. Watch the logs. You'll see:
```
WARN Notification job failed (retrying in 1000ms)
WARN Notification job failed (retrying in 2000ms)
INFO Notification job completed
```

It tries 3 times, waiting longer each time.

**Don't forget to remove this error before submitting!**

## Common Problems and Fixes

### "Redis connection refused"

Redis isn't running.

**Fix:**
```bash
# Mac
brew services start redis

# Linux
sudo systemctl start redis-server

# Windows (Docker)
docker run -d -p 6379:6379 redis:latest
```

### "ENOENT: no such file or directory, open 'app.db'"

You skipped the Prisma step.

**Fix:**
```bash
npx prisma migrate dev --name init
```

### "Port 3001 already in use"

Something else is using port 3001.

**Fix:**

Edit `.env` and change the port:
```
SERVICE_PORT=3002
```

Then restart.

### "Cannot find module '@prisma/client'"

Dependencies didn't install.

**Fix:**
```bash
npm install
npx prisma generate
```

### Service won't start or crashes

**Fix:**

Try from scratch:
```bash
rm -rf node_modules app.db
npm install
npx prisma migrate dev --name init
npm run dev
```

## Stop the Service

In the terminal running `npm run dev`, press `Ctrl+C`.

You should see:
```
INFO: Received shutdown signal
INFO: Server stopped successfully
INFO: All job queues closed
INFO: Database connection closed
```

The service shuts down cleanly. No data is lost.

## Performance

On a local computer:
- Application submission: 40-80 milliseconds
- Job processing: 5-6 jobs per second per worker
- Health check: 5-10 milliseconds

These numbers are normal.

## Next Steps

1. Check that it works locally
2. Read the ANSWERS.md file to see how the questions are answered
3. Read DECISIONS.md to understand why each choice was made
4. Push to GitHub as a private repo
5. Submit

That's all. You're done.
