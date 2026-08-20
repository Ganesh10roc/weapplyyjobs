# How to Run It

## Prerequisites

- Node.js 18+
- Redis running
- npm (comes with Node)

## Start Redis

**Mac:**
```bash
brew install redis
brew services start redis
```

**Linux:**
```bash
sudo apt-get install redis-server
redis-server
```

**Windows (Docker):**
```bash
docker run -d -p 6379:6379 redis:latest
```

Check: `redis-cli ping` → should say `PONG`

## Step 1: Install

```bash
cd c:\Users\Admin\Desktop\weapplyjobs
npm install
```

## Step 2: Database

```bash
npx prisma migrate dev --name init
```

Creates `app.db` (SQLite database)

## Step 3: Start Service

```bash
npm run dev
```

Should say: `Server started successfully (port: 3001)`

## Step 4: Test It

Open new terminal:

```bash
npm run test:queue
```

Should show:
```
Time    | Notifications | Stats Updates | Audit Logs
--------|------|------|------
00s    | 20/0/0     | 20/0/0     | 20/0/0
01s    | 15/5/0     | 15/5/0     | 15/5/0
04s    | 0/0/0      | 0/0/0      | 0/0/0
```

Jobs go from waiting → active → done. ✓

## Manual Tests

Check health:
```bash
curl http://localhost:3001/health
```

Submit application:
```bash
curl -X POST http://localhost:3001/api/applications \
  -H "Content-Type: application/json" \
  -d '{
    "jobId": "job-123",
    "candidateId": "cand-456",
    "recruiterId": "recruiter-789",
    "coverLetter": "I am interested"
  }'
```

Should return: HTTP 201, application ID

Test validation (missing field):
```bash
curl -X POST http://localhost:3001/api/applications \
  -H "Content-Type: application/json" \
  -d '{"jobId": "job-123"}'
```

Should return: HTTP 400, error message

## Stop Service

Press `Ctrl+C` in terminal running `npm run dev`

## Common Issues

| Problem | Fix |
|---------|-----|
| Redis connection refused | `brew services start redis` (Mac) or `docker run -d -p 6379:6379 redis:latest` (Windows) |
| Port 3001 already in use | Change `SERVICE_PORT=3002` in `.env` |
| app.db not found | Run `npx prisma migrate dev --name init` |
| Cannot find @prisma/client | Run `npm install` and `npx prisma generate` |

## That's It

Service is now running and tested. Ready to submit.
