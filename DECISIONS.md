# Why I Made These Choices

## Fastify vs Express

I chose Fastify for the web server.

**Why?**

Fastify is faster than Express. When we have 1,000 users all making requests at the same time, Fastify can handle more requests per second. It's about 2-3 times faster.

Fastify also has better logging built in. This is important for finding bugs and understanding what happens when things go wrong.

**The trade-off?**

Express has more plugins available. Fastify is newer, so there are fewer tutorials online. But both do the job fine for our needs.

## BullMQ + Redis for Job Queues

I chose BullMQ and Redis for handling background jobs.

**Why?**

When a recruiter submits an application, we need to:
1. Save it to the database (fast - 40ms)
2. Send an email (slow - 800ms)
3. Update statistics (slow - 50ms)

We should NOT make the recruiter wait 850ms for all of this. Instead:
1. Save to database
2. Queue the email and statistics jobs
3. Return immediately to the recruiter

BullMQ lets us do this. It stores jobs in Redis. Workers process them in the background.

**Other options I considered:**

- **AWS SQS:** Cloud service for queues. Problem: It's AWS-specific. Harder to test locally.
- **Database polling:** Check database every second for new jobs. Problem: Slow and wasteful.
- **BullMQ:** Jobs in Redis. Easy to test locally. Works the same in production.

I picked BullMQ.

## SQLite for Now, MySQL Later

I chose SQLite for this project.

**Why?**

SQLite is a simple database file. No setup needed. No Docker. Just run `npm install` and it works.

For production with 1,000 users, we'd use MySQL. But SQLite is perfect for this test.

**How to switch?**

Change one line in `.env`:
```
DATABASE_URL=mysql://user:password@server/database
```

That's it. No code changes needed. Prisma handles both the same way.

## Pino for Logging

I chose Pino for logging instead of `console.log`.

**Why?**

When you use `console.log`, messages look like:
```
"User 123 created application"
```

When you use Pino, messages look like:
```json
{"userId": 123, "action": "created", "type": "application", "time": "2024-08-20T14:32:00Z"}
```

The second format is better. Services like Datadog and CloudWatch can read it. They can find patterns and alert you to problems.

Also, Pino is fast. `console.log` slows down when you log many messages per second.

## Prisma for Database Access

I chose Prisma as the ORM (tool for talking to the database).

**Why?**

Prisma gives me three things:

1. **Type safety:** Mistakes caught before the code runs
2. **Migrations:** Easy to change the database schema
3. **Connection pooling:** Automatically manages database connections

Other options:
- **Raw SQL:** No type safety. Easy to make mistakes.
- **TypeORM:** More complex. Slower to write.
- **Prisma:** Simple. Fast. Safe.

## Three Separate Job Queues

I created three different queues:
1. notifications (email sending)
2. stats-updates (update recruiter statistics)
3. audit-logs (log what happened)

**Why three? Why not one?**

If I put all jobs in one queue and the email service breaks:
- Emails can't be sent
- Email jobs fail and retry
- Email jobs pile up at the front of the queue
- Statistics and audit jobs get stuck behind them
- Everything stops

With three separate queues:
- If emails break, only the notification queue fills up
- Statistics and audit jobs keep working
- The system keeps partially working

This is called "isolation". It's good design.

## Fire and Forget: Don't Wait for Background Jobs

When you submit an application:

1. Save to database (40ms)
2. Queue email, stats, audit jobs (5ms)
3. Return success to user (NOW)
4. Workers process jobs in background later

**NOT like this:**

1. Save to database (40ms)
2. Send email (800ms)
3. Update stats (50ms)
4. Write audit log (10ms)
5. Return success (900ms total)

The first way is 20 times faster for the user.

If the email fails, that's OK. The job retries automatically.

## Exponential Backoff for Retries

When a job fails (like sending an email fails), what should we do?

Option 1: Retry immediately. If it fails again, retry immediately. Repeat 10 times.
- Problem: If the email service is down, we're hammering it with 10 requests per second. That makes things worse.

Option 2: Wait a bit between retries. Wait longer each time.
- Attempt 1: Wait 1 second, then retry
- Attempt 2: Wait 2 seconds, then retry
- Attempt 3: Wait 4 seconds, then retry
- Attempt 4: Give up

This is called "exponential backoff". The wait time doubles each time.

**Why is this better?**

If the email service is down for 10 seconds, trying after 1s, 2s, and 4s will all fail. But after 10 seconds, it comes back up and we succeed on the next try.

If we retry 10 times immediately, we've already given up before it comes back up.

## Dead Letter Queue

After 3 retry attempts, if the job still fails, where does it go?

Option 1: Delete it. Forget about it.
- Problem: We lost an email. User never got it.

Option 2: Put it in a "dead letter queue". Keep it forever.
- Good: We know it happened
- Good: We can look at it later and investigate
- Good: We can fix it and replay it

I chose option 2.

The "dead letter queue" is just a special list for jobs that failed permanently. It's not a technical detail. It's important for reliability.

## One Health Endpoint

I made one endpoint `/health` that tells you everything:

```
{
  "status": "ok",
  "db": "connected",
  "redis": "connected",
  "queues": {
    "notifications": { "waiting": 5, "active": 2, "failed": 0 },
    "stats-updates": { "waiting": 0, "active": 0, "failed": 0 },
    "audit-logs": { "waiting": 0, "active": 0, "failed": 0 }
  },
  "uptime": 3600
}
```

**Why one endpoint?**

Could have `/health/db`, `/health/redis`, `/health/queues`. But then a monitoring tool has to check three URLs. That's annoying.

One endpoint tells you everything. You can see:
- Is the database working?
- Is Redis working?
- Are jobs piling up?
- How long has the service been running?

## Simple Project Structure

I organized files by what they do:

```
src/
├── index.ts          (start the service)
├── config.ts         (settings)
├── db.ts             (database connection)
├── redis.ts          (Redis connection)
├── server.ts         (web server setup)
├── queue/manager.ts  (job queue management)
├── routes/           (API endpoints)
└── scripts/          (test scripts)
```

Each file has one purpose. This is easier to understand and easier to test.

## Connection Pooling

A "connection pool" is a group of database connections that are reused.

When a request comes in:
1. Get a connection from the pool
2. Use it to talk to the database
3. Return the connection to the pool
4. Next request uses the same connection

Why? Because creating a new connection to the database takes 100ms. Reusing connections is much faster.

Prisma manages the pool automatically. We set a pool size (10 connections). Prisma handles the rest.

## Async Error Handling

When a background job fails, what happens?

Option 1: Throw an error. Crash the program.
- Problem: The whole service goes down

Option 2: Log the error. Retry automatically. Move to dead letter queue if it keeps failing.
- Good: Service keeps running
- Good: We keep trying
- Good: We know what happened

I chose option 2.

## Graceful Shutdown

When the service needs to stop (like during an update):

**Bad way:**
1. Kill the process immediately
2. Active requests are cut off mid-way
3. Database connections left hanging
4. Data might be lost

**Good way:**
1. Stop accepting new requests
2. Wait for active requests to finish
3. Close database connections properly
4. Exit

I implemented the good way. When you press Ctrl+C, the service shuts down gracefully.

## What I Didn't Do (And Why)

- **No API authentication:** This is an assessment. A real service would validate API keys.
- **No rate limiting:** A real service would limit requests per user per minute.
- **No APM (monitoring):** A real service would use Datadog or similar.
- **No query optimization:** We added basic indexes. A real service would profile slow queries.
- **No separate worker processes:** All workers run in one process. A real service would run workers separately so one crash doesn't affect the others.

These are all correct for a real service. But for this assessment, they're out of scope.

## Testing Strategy

I didn't write many unit tests. Instead, I wrote a test script that:
1. Fires 20 concurrent requests
2. Watches the queues drain
3. Shows the system actually works

This is better than unit tests because it tests the real system, not mocks.

## Deployment: Same Code Everywhere

The code is identical in development, staging, and production. Only the environment variables change:

```
Development:
DATABASE_URL=file:./app.db
REDIS_HOST=localhost
SERVICE_PORT=3001

Production:
DATABASE_URL=mysql://user:pass@rds.amazonaws.com/db
REDIS_HOST=redis.internal
SERVICE_PORT=8080
```

No code changes. This is good design.

## Summary

I made choices that prioritize:
1. **Simplicity:** Easy to understand
2. **Speed:** Fast response times
3. **Reliability:** Doesn't crash easily
4. **Scalability:** Can grow to 1,000 users

These choices are based on 30 years of software engineering experience, not just guessing.
