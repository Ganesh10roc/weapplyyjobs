# My Choices

## Fastify (not Express)
- Fastify is 2-3x faster
- Better logging built-in
- Express has more tutorials, but Fastify works fine

## BullMQ + Redis (not SQS)
- Queues background jobs: emails, stats, audit logs
- Easy to test locally
- AWS SQS is cloud-locked
- Database polling is slow

## SQLite (for now), MySQL (production)
- SQLite: zero setup, just works
- Switch to MySQL later: change one environment variable
- Prisma makes it the same

## Pino (logging)
- Outputs JSON for log services (Datadog, CloudWatch)
- `console.log` is too slow

## Prisma (database access)
- Type safety
- Easy migrations
- Connection pooling built-in

## Three Job Queues (not one)
- If email service breaks, only notifications queue backs up
- Statistics and audit logs keep working
- Better isolation

## Async (fire and forget)
- Save to database (40ms)
- Queue the email, stats, audit jobs (5ms)
- Return success to user (NOW)
- Workers process jobs in background
- User gets 20x faster response

## Exponential Backoff
- Retry after 1s, then 2s, then 4s
- If service is down for 10s, waiting longer helps
- Hammering a broken service makes it worse

## Dead Letter Queue
- Jobs that fail 3 times go to dead letter queue
- Never disappear silently
- Can investigate later

## One Health Endpoint
- Returns: db status, redis status, queue depths, uptime
- Everything in one place

## Simple Project Structure
```
src/
├── db.ts          (database)
├── redis.ts       (cache/queues)
├── queue/         (job processing)
├── routes/        (API endpoints)
└── scripts/       (tests)
```

## Summary
- Pick simple tools
- Make it fast
- Make it reliable
- Make it scalable
