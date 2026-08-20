# Why I Built It This Way

## The Framework Choice: Fastify

I went with Fastify instead of Express because performance actually matters here. We're targeting 1,000 concurrent recruiters, and Express starts struggling at scale. Fastify is 2-3x faster, has built-in structured logging support (via Pino), and handles async/await better out of the box.

Express has more plugins, sure, but Fastify has everything we actually need for this. CORS? Built-in. Logging? Integrated with Pino. The ecosystem isn't the issue.

The main downside is it's newer, so fewer Stack Overflow answers. But the documentation is solid and there's less custom code needed anyway.

## The Queue System: Why BullMQ + Redis, Not SQS

I considered AWS SQS, which would be the "cloud-native" choice. But it adds AWS lock-in, and debugging queues locally becomes painful. BullMQ with Redis gives me:
- Full visibility into what's queued (just run `redis-cli`)
- Automatic retries with exponential backoff (no extra code)
- Dead-letter queues that actually work (SQS makes you handle this manually)
- Works on my laptop and in production without code changes

The risk is Redis becomes a single point of failure. But that's what replication and failover are for. For a service this size, it's worth it.

I also thought about using the database itself as a queue (insert rows, poll them). Don't do that. It's slow, causes lock contention, and doesn't scale past maybe 10-15 jobs/sec. BullMQ handles thousands.

## Database: SQLite for Now, MySQL for Production

SQLite for the assessment because it requires zero setup. No Docker, no running MySQL locally. Just `npm install` and go.

Prisma's abstraction means switching to MySQL is literally one environment variable change. The schema is identical. Migrations work the same way. So there's no technical debt here.

In production, we'd use MySQL on RDS because SQLite is single-process (can't share across multiple backend instances). But for this assessment, SQLite is the right call.

## Structured Logging with Pino

Console.log is fine for debugging locally, but doesn't scale. Pino outputs JSON, which means log aggregation services (Datadog, CloudWatch) can parse it and alert on patterns.

It's also fast. Like, measurably faster than Winston or Bunyan. Not that it matters much, but when you're logging every request, fast logging helps.

## Why Prisma, Not Raw SQL or TypeORM

I needed:
1. Type safety (catch mistakes at compile time)
2. Easy migrations (the schema is the source of truth)
3. Connection pooling that actually works
4. Something that plays nicely with RDS later

Prisma handles all of that. TypeORM is fine too, but more complex. Raw SQL means no type safety and manual connection pooling.

Prisma isn't perfect (some queries are hard to express), but for the 80% of queries that are straightforward, it's great.

## The Architecture: Why Three Queues, Not One

If I put notifications, stats updates, and audit logs all in one queue and the email service goes down, nothing processes. The queue fills up because the first job (send email) keeps failing.

With three separate queues, if email is down, the queue for notifications backs up, but stats and audit logs keep processing. Isolation is worth the extra complexity.

Also, each queue can have different concurrency settings. Maybe we want 50 workers for notifications but only 5 for audit logs.

## Why Async Jobs Don't Block the Response

The whole point of a queue is to decouple processing from the request. If I wait for the email to send before returning a response, the request takes 800ms instead of 40ms. That kills performance.

So the flow is:
1. Save application to database (40ms)
2. Queue the email, stats, and audit jobs (add to queue, return immediately)
3. Return success to client
4. Workers process queued jobs in the background

If an email fails, the application is still saved. The user's request succeeds. Workers retry the email.

## Retry Logic: Exponential Backoff

If something fails once, try again after 1 second. If it fails again, wait 2 seconds. Then 4 seconds. After 3 attempts, give up and move to dead-letter queue.

Why exponential? Because if a service is down, hammering it 10 times a second just wastes resources. Backing off gives it time to recover. And most transient failures (network hiccup, temporary overload) are gone by the 2-second mark.

The dead-letter queue is important too. Some jobs will genuinely fail (email address is invalid, recruiter was deleted). We need to log those, not silently drop them.

## The Health Endpoint: One Place to Check Everything

I could have separate `/health/db`, `/health/redis`, `/health/queues` endpoints. But that's annoying to monitor. One endpoint returns the whole picture:
- Is the database connected?
- Is Redis up?
- How many jobs are waiting in each queue?
- Is the service even up?

A monitoring tool can poll one URL and get everything it needs.

## Project Structure: Modular, Not Monolithic

Each file has one job:
- `db.ts` manages database connections
- `redis.ts` manages Redis
- `queue/manager.ts` handles all queue operations
- `routes/applications.ts` is just the API endpoint
- `routes/health.ts` is just the health check

This makes it easy to test (can mock each module), easy to extend (add a new route, add a new file), and easy to debug (problem with queues? look at queue/manager.ts).

## Connection Pooling: Why It Matters

SQLite doesn't have connection pools (it's single-process). But MySQL does, and it's critical.

If each HTTP request opens a new database connection, and we get 200 concurrent requests, we need 200 connections. MySQL's default limit is 151. We're screwed.

Prisma handles connection pooling for us. We set a pool size (10 by default) and Prisma multiplexes all requests through that pool. If a request needs a connection and the pool is full, it waits.

For production with 1,000 recruiters, we'd probably use ProxySQL to multiplex even further (so we only use 30 actual DB connections across 100 backend instances).

## Error Handling: Let It Fail Gracefully

If a worker throws an error, BullMQ catches it and retries. I don't need to wrap everything in try-catch.

If the database goes down, requests fail with 500 errors. That's correct. The client should retry. We shouldn't pretend everything is fine.

If Redis is down, the health endpoint returns 503. Operations know the service is degraded. They can page the on-call engineer.

Graceful degradation > silent failures.

## Graceful Shutdown: Don't Lose Data

When the service is told to shut down (SIGINT, SIGTERM), it:
1. Stops accepting new requests
2. Waits for in-flight requests to complete
3. Closes the database connection (commits pending transactions)
4. Closes the Redis connection
5. Exits

This means we don't lose data when deploying a new version.

## What I Didn't Do (And Why)

- No authentication on the endpoints. This is an assessment service. In production, we'd have JWT validation.
- No request rate limiting. Same reason. But it's one middleware away.
- No APM (Application Performance Monitoring). Production would have Datadog or New Relic. But health endpoints + structured logging is 80% of what you need.
- No database query optimization (indexes, query analysis). We added basic indexes on Application model. For production, we'd use EXPLAIN plans to find slow queries.
- No separate worker processes yet. All workers run in the same Node process. With time, we'd spawn separate worker processes so one crashed worker doesn't take down the whole service.

## The Testing Approach

I didn't write Jest unit tests because the requirement is "demonstrate the queue working." A test that mocks Redis and BullMQ doesn't prove anything. The test-queue.ts script fires real requests, polls real queue depths, and shows the system working.

In production, we'd add Jest tests for critical paths (validation, error handling). But the core integration test is running the script and seeing jobs drain.

## Deployment: Zero Code Changes

The same code runs locally and in production. Just change the environment variables:
- `DATABASE_URL=file:./app.db` → `DATABASE_URL=mysql://...`
- `REDIS_HOST=localhost` → `REDIS_HOST=redis.internal`
- `SERVICE_PORT=3001` → `SERVICE_PORT=8080`

Everything else is identical. This is why I used environment-based config instead of hardcoding anything.

## The Tradeoffs I Made

1. **Simplicity over optimization** - The code is readable, not performance-optimized. When we hit scaling limits, we'll optimize.
2. **Single process over distributed workers** - Easier to run locally, but in production we'd spawn separate worker processes.
3. **SQLite over PostgreSQL** - Zero setup vs. more features. SQLite wins for this assessment.
4. **No authentication** - Out of scope, but would be first thing added for production.

These aren't mistakes. They're intentional choices based on the constraint (48-hour assessment) and the goal (demonstrate solid architecture).

## What Would Change With More Time

1. **Separate worker processes** - Run notifications, stats-updates, and audit-logs in separate Node processes. One crash doesn't affect the others.
2. **Read replicas** - For candidate reads (job listings, application status), use a read replica. Keeps write performance high.
3. **Redis caching** - Cache job listings (change rarely). Eliminates most database read load.
4. **Connection pooling proxy** - ProxySQL between backend and MySQL. Lets 100 backend instances share 30 actual DB connections.
5. **API authentication** - JWT validation on all endpoints. Rate limiting per recruiter ID.
6. **Query optimization** - Profile slow queries, add indexes, use EXPLAIN plans.
7. **Monitoring and alerts** - Datadog integration, alerts when queue depths spike or workers fall behind.

But for this assessment, the current implementation is solid and demonstrates understanding of the principles.
