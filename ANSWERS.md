# Answers to the Assessment Questions

## Part 1: What the Hell Happened at 14:32?

### 1. Timeline of the Collapse

**14:31:58 - 14:32:00: Everything's fine**

Requests coming in at normal pace. Response times around 200-300ms, connection count climbing from 45 to 51. Each second adds a few connections, which is expected as traffic naturally varies.

**14:32:01 - THE MOMENT IT BREAKS**

The Prisma connection pool hits the wall. We have exactly 10 connections in the pool. Suddenly we get queued=23, meaning 23 requests are waiting for a connection that never comes available.

At the same time, MySQL starts screaming: "Too many connections (max_connections=151)". This tells me the backend instances are bypassing the Prisma pool and opening raw connections, which only happens when the pool is completely exhausted.

Total connections on MySQL jumped to 51. The pool is full. The queue is overflowing.

**14:32:01 - 14:32:02: The Pile-Up**

Requests start failing with PrismaClientInitializationError. Response times spike to 10+ seconds as requests sit in the Prisma queue waiting for a connection that won't free up.

HTTP 500 errors appear in the logs. Users are getting failures.

**14:32:08 - RECOVERY**

Here's the interesting part: the connection count drops from 51 → 34 → 31. Why? Because requests are timing out.

When a request hits `pool_timeout=10s`, it gives up waiting for a connection and throws an error. But here's the thing: when it gives up, it releases whatever resources it was holding. The pool has some connections tied up in these timed-out requests. As they get cleaned up, connections become available.

By 14:32:08, enough timed-out requests have been cleaned up that new requests can get connections again. The queue starts draining. Response times are still terrible (4-5 seconds) because there's a massive backlog, but the system isn't completely hung.

**Why did it recover without anyone doing anything?**

Timeout-driven recovery. The system was in a deadlock where no new connections were available. Timeouts broke the deadlock by forcibly releasing resources. It's not elegant, but it works.

### 2. How Many Instances?

Looking at `pool_size=10` and `queued=23`, I need to think about what this means.

Each Prisma client (one per Next.js instance) has its own connection pool. The `pool_size=10` means that one pool has 10 connections. The `queued=23` means 23 requests are waiting in that pool's queue.

But wait, the log shows 51 total connections on MySQL. If one pool only has 10 active connections, where are the other 41 coming from?

They're from other instances. If I have N instances each with pool_size=10, I could have up to N×10 connections. The 51 total suggests we have roughly 5-7 instances:
- 7 instances × 7 connections average = 49 connections ≈ 51 observed

The queued=23 suggests one of those instances got hammered harder than the others. Maybe it got routed all 200 recruiters' traffic while the other instances were idle.

**My answer: 5-7 Next.js instances, with uneven load distribution.**

### 3. Why Recovery Happened Automatically

The system was stuck in a loop:
1. All connections are held by pending requests
2. All pending requests are timing out (waiting >10 seconds)
3. No new requests can proceed (no available connections)

Timeouts are the system's circuit breaker here. Every request that times out releases its connection back to the pool. As these release:

4. Pool has some free connections again
5. Waiting requests can now get connections and run
6. They complete and release their connections
7. Queue drains faster than new requests arrive

By 14:32:08, this cascade had accelerated enough that the system recovered. The real fix would have been to:
- Load balance better (the 51 connections should have been spread across 7 instances)
- Reduce connection usage per request (move email sending to async queue)
- Increase pool size (but that's a bandaid on poor load distribution)

### 4. Why connection_limit=100 Makes It Worse

The junior engineer is thinking: "We ran out of connections, so let's allow more connections!"

This sounds logical but it's actually catastrophic. Here's why:

If we increase Prisma's `connection_limit` from 10 to 100, each Next.js instance can now open up to 100 connections to MySQL. We have 7 instances. That's 700 connection attempts hitting MySQL.

MySQL's server-level `max_connections=151`. So we'd hit that limit instantly. Some instances would fail to connect, and we'd be in worse shape than before.

What the junior doesn't realize: the bottleneck isn't "Prisma pools are too small." The bottleneck is "we have too many concurrent requests holding connections for too long."

The real fixes, in order:
1. **Move email sending to async queue.** Each write request holds a connection for 800ms just for email. Queue the email, release the connection in 40ms. Boom, 20x less connection demand.

2. **Load balance properly.** 200 recruiters shouldn't all route to one instance. Use round-robin load balancing so each instance gets roughly 30 recruiters.

3. **Add read replicas.** Most traffic is probably reads (checking job listings, application status). Replicas don't compete with writes for the primary's connections.

4. **Use ProxySQL.** This is a connection pooling proxy that sits between backends and MySQL. Instead of 7 instances × 100 connections = 700 total, ProxySQL multiplexes it to 30 actual MySQL connections. The backend sees the illusion of unlimited connections, MySQL sees reasonable load.

5. **Vertical scaling.** Upgrade the RDS instance from t3.medium to r5.large. More memory means better caching, more CPU for query processing.

connection_limit=100 solves nothing. It's like raising the speed limit when cars keep piling up in traffic.

### 5. What Prisma Accelerate Actually Does

Prisma Accelerate is a connection pooling proxy hosted by Prisma in the cloud:

```
Your backend → Prisma Accelerate cloud → MySQL RDS
```

Instead of your 200 Next.js processes each opening 10 connections to MySQL (2,000 connections), they all talk to Accelerate. Accelerate multiplexes those 2,000 client connections onto maybe 30 actual connections to MySQL. It's like an intelligent load balancer for database connections.

**Why it helps for the incident:**

In the log, the collapse happened because one Prisma pool got exhausted (queued=23) while other instances still had capacity. With Accelerate, there's one shared pool across all instances. One instance can't starve the others.

Also, Accelerate can intelligently detect when MySQL is under load and slow down new connection attempts, preventing the cascade that happened in the logs.

**Why it helps for scaling to 1,000 users:**

At 1,000 recruiters + 100,000 users, even with async queues and read replicas, you'd have hundreds of concurrent database requests. Without Accelerate, you need huge connection pool sizes. With Accelerate, the pool can be much smaller because it multiplexes efficiently.

**The limitations:**

1. **Another network hop.** Every query now goes through Accelerate's servers first. That's typically 5-50ms extra latency depending on region.

2. **It's a service you depend on.** If Accelerate is down, your database is unreachable. With direct MySQL connections, you only depend on your own infrastructure.

3. **Doesn't fix slow queries.** If a query takes 200ms because it's missing an index, Accelerate doesn't help. You still need query optimization.

4. **It's not free.** Accelerate charges per query. At 1M queries/day, it's cheap (~$50/month), but it's still a recurring cost.

5. **Doesn't work for all patterns.** Some applications need persistent connections or temporary tables, which don't work through Accelerate.

**The real picture:**

Accelerate is great for getting from 200 users to 1,000 users without rearchitecting the database layer. But for 10,000+ users, you need the full stack: read replicas, query caching, async processing, and yes, connection pooling proxies.

For this incident, Accelerate would have prevented the cascade because it detects pool exhaustion and handles it gracefully across all client connections.

---

## Part 2: How to Scale This to 1,000 Recruiters

### 1. The 6-Month Plan

I'm going to tackle this incrementally, measuring at each step.

**Month 1, Week 1-2: Move notifications to async queue**

Right now, when a recruiter submits an application, we send a notification email before returning a response. That email takes ~800ms. So every write request takes >800ms.

Move email sending to BullMQ. The recruiter's request completes in 40ms (just DB write). The email sends in the background.

**Measure:** p50 and p95 latency should drop from ~1000ms to ~100ms. We should be able to handle 3x the concurrent load.

**Month 1, Week 3-4: Add read replicas**

Most recruiter actions are reads: checking job listings, viewing applications, searching candidates. These don't need the primary database. Route reads to a read replica.

Set up MySQL read replica on RDS (same AZ as primary for low lag). Configure Prisma to route SELECT queries to the replica, everything else to the primary.

**Measure:** Check MySQL primary CPU usage. It should drop by 40-60% (no longer handling read queries). Replica lag should stay <2 seconds.

**Month 2, Week 1-2: Redis cache for hot data**

Job listings are read thousands of times but change rarely. Cache them in Redis with 5-minute TTL.

When a recruiter updates a job, invalidate the cache immediately so candidates see the change within seconds.

**Measure:** Track cache hit rate (should be >90%). Monitor database query volume (should drop by 60%).

**Month 2, Week 3-4: Separate recruiter write service**

Create a standalone Fastify service for POST /api/applications. Keep read APIs in Next.js.

This lets us optimize independently. The write service can have more aggressive connection pooling settings (30 connections), tuned for throughput. The read service can stay lightweight.

**Measure:** Deploy side-by-side. Monitor database connection count (should drop by 20-30%). Compare latency of reads vs. writes (writes should stay fast).

**Month 3, Week 1-2: Add ProxySQL**

All services talk to ProxySQL instead of MySQL directly. ProxySQL multiplexes all connections.

Instead of the write service having 30 connections, read service having 10, and admin tools having 5 (75 total), ProxySQL now has 25 actual MySQL connections and multiplexes them all.

**Measure:** Monitor MySQL connection count (should drop to 25-30 total). Check ProxySQL queue depth (should be <1ms wait time).

**Month 3, Week 3-4: Separate analytics service**

The stats-updates queue is part of the main service. Extract it into its own service. It can run independently, auto-scale independently.

If recruiter stats are slow, it doesn't affect application submissions or notifications.

**Measure:** Can we scale the stats service to 50 workers without affecting the main service? (Yes, because they're separate.)

**Month 4+: Horizontal scaling**

Run the write service on 5 EC2 instances behind a load balancer. If one crashes, traffic routes to the others.

The read service can scale independently (it's read-heavy, can use more instances).

Each tier can auto-scale based on load.

### 2. Separate Recruiter vs. User Services: Which Way?

**The case for separate services:**

- Recruiters and candidates have completely different access patterns. Recruiters do writes (12/min), candidates do reads (browse jobs, check status). Optimizing for both is impossible.
- If the recruiter service crashes, candidates can still browse jobs and check status. Good user experience.
- Deployment independence. Recruiters need new features weekly. Candidates want stability. Separate deployments mean recruiting team can move fast without risking candidate experience.
- Monitoring and alerting. You can set different SLOs. Recruiters get <100ms response time, candidates can tolerate <500ms (it's cached anyway).

**The case for keeping them together:**

- Operational simplicity. One codebase, one deployment, one database. Less moving parts.
- Some logic is shared. When a recruiter creates an application, we need to check if the job exists (candidate data) and if the recruiter is authorized (recruiter data). Separate services means cross-service calls and consistency headaches.
- We're a small team (one backend engineer). Maintaining two services is more work.

**My recommendation: Separate, but phased.**

Start with everything together. After 3 months (around month 4 in the plan above), extract recruiter writes into a separate service. By then:
- We've proven the async queue approach works
- We've added read replicas and caching
- The write service has become distinct enough that splitting makes sense

This gets us the best of both: simplicity early, optimization later.

### 3. The Sharding Question

Someone says: "We need horizontal database sharding to handle 1,000 concurrent users."

Here's my response in the meeting:

**No. We're not sharding yet. Here's why:**

Sharding adds enormous complexity. Cross-shard joins are slow. Rebalancing data between shards is painful. You need distributed transactions or accept eventual consistency. It's like going from a sedan to a 18-wheeler truck to carry groceries.

Before we shard, we haven't optimized a single shard. We haven't added indexes (just basic ones). We haven't run EXPLAIN on slow queries. We haven't cached anything. We haven't moved async processing out of the request path.

At 1,000 concurrent recruiters, on a properly optimized single shard (with read replicas, ProxySQL, and caching), we can handle 10-100x the load we currently have.

**What I'd do instead:**

1. Run EXPLAIN on the top 20 slow queries. Add indexes where they help.
2. Profile database latency at the p95. If it's >50ms, optimize queries. If it's <10ms, we're good.
3. Monitor connection efficiency. If we're using 200 connections to do what could be done in 30, there's waste.
4. Add caching for hot reads.
5. If we still can't handle 1,000 concurrent recruiters after all this, *then* we talk about sharding.

My guess: we won't need to shard. Single-shard databases handle billions of rows comfortably with proper optimization.

### 4. What Stays Sync, What Goes Async

The database write **must** be synchronous. We need to return the application ID to the user. If the write fails, the whole request fails. There's no async here.

Everything else can go async:

- **Email notification** (~800ms): Queue it. Candidate gets the email eventually. If it fails, it retries automatically.
- **Recruiter stats update** (~50ms): This is analytics. Recruiters check the stats page every few hours. A 1-minute delay is fine.
- **Audit log** (~10ms): For compliance/debugging. Doesn't need to be in the request path.
- **WhatsApp message** (~2-3 seconds): Same as email. Queue it.

By moving all of these to async queues, the request response time drops from ~1,500ms to ~50ms. That's 30x faster.

**How to handle it:**

Use BullMQ with three queues. Add jobs immediately after the database write, don't wait for completion. Return success to the client.

If any job fails, it retries automatically. If it fails 3 times, it goes to dead-letter queue for manual investigation.

### 5. Redis Cache with 5-Minute TTL: Preventing Stale Data

**Scenario:** Recruiter closes a job at 2:00 PM. Candidate might see stale data in three ways.

**Problem 1: Direct cache hit**

Candidate loaded the job at 1:59 PM and has it cached in their browser. They refresh at 2:01 PM. Their browser cache has the old version.

**Solution:** 1-minute TTL instead of 5. Trade some Redis load for better freshness. Or add a "last updated" timestamp and refresh if it's stale.

**Problem 2: Read replica lag**

Recruiter closes job on primary at 2:00 PM. We have a 2-second replica lag. Candidate queries the replica at 2:00:01 PM, still sees the job as open.

**Solution:** For critical reads (things the user just changed), query the primary, not the replica. After a recruiter closes a job, their next query for that job should hit primary.

Implementation: Set a session flag "queryPrimaryUntil=2:00:05" when they perform a write. Check it before routing reads.

**Problem 3: Cross-service cache inconsistency**

We have separate services for recruiting and candidate features. Recruiter service invalidates the cache when a job closes. But candidate service doesn't know about it (different codebases). They see stale data.

**Solution:** Use Redis pub/sub. When recruiter service closes a job, it publishes to channel "job-updates". Candidate service subscribes and immediately invalidates its cache.

```typescript
// Recruiter service
await redis.publish('job-updates', JSON.stringify({ jobId, action: 'closed' }));

// Candidate service
redis.subscribe('job-updates', (message) => {
  const { jobId } = JSON.parse(message);
  await cache.invalidate(`job:${jobId}`);
});
```

**Summary:**

Without these fixes, there's a consistency window: time between when data changes and when all caches reflect the change. It's typically 0-5 seconds.

For recruiting, that's usually acceptable. But it should be intentional, not accidental.

---

## Part 4: How Much Compute Do We Actually Need?

### 1. Connection Pool Formula

The formula is based on Little's Law from queuing theory:

```
L = λ × W
```

Where:
- L = number of items in the system (connections in use)
- λ = arrival rate (requests per second)
- W = time each item spends in system (request duration)

Rearranged for connection pools:

```
Pool Size = (Concurrent Requests × Request Duration) / Acceptable Response Time ÷ Utilization Factor
```

Or more practically:

```
Pool Size = (Requests Per Second × Database Hold Time in Seconds) / Utilization
```

**Variables you need to know:**

1. **Peak QPS** (requests per second): How many database requests at peak load?
2. **Database hold time** (milliseconds): How long does each request hold a connection?
3. **Utilization target** (80% is typical): Don't max out the pool, leave headroom for spikes.

**Example for our service:**

- Peak: 200 writes/sec (1,000 recruiters × 12 writes/min ÷ 60 = 200/sec)
- Hold time: 40ms (database is fast, network round-trip)
- Utilization: 80%

```
Pool = (200 × 0.040) / 0.80
     = 8 / 0.80
     = 10 connections
```

So a pool of 10 makes sense. With safety margin, 15-20 is reasonable.

### 2. Minimum Pool Size for 1,000 Recruiters

**Given facts:**
- 1,000 recruiters
- 12 writes per recruiter per minute
- Each write holds a connection for 40ms

**The math:**

1. Total write throughput:
   ```
   1,000 recruiters × 12 writes/min = 12,000 writes/min
                                     = 200 writes/sec
   ```

2. Concurrent connections at any moment:
   ```
   200 writes/sec × 0.040 seconds/write = 8 connections
   ```

3. Add 25% safety margin for p95 latency and jitter:
   ```
   8 × 1.25 = 10 connections minimum
   ```

4. If we're not hitting optimal case (average 40ms but p95 is 60ms):
   ```
   200 writes/sec × 0.060 seconds = 12 connections
   ```

**Answer: Minimum pool size is 10-12 connections.**

But here's the catch: if we run 100 backend instances and each has a pool of 12, that's 1,200 connections trying to hit MySQL. If MySQL max_connections=151, we're screwed.

That's why we need ProxySQL or Accelerate to multiplex all those instance connections onto 30-50 actual database connections.

### 3. Queue Falling Behind: Three Approaches

**Problem:** Stats-updates workers can't keep up. Inflow is 200 jobs/sec. Outflow is 4 jobs/sec. Queue grows by 196/sec.

**Solution 1: Increase worker concurrency**

```typescript
const worker = new Worker('stats-updates', handler, {
  concurrency: 50  // was 5, now 50
});
```

**Pros:**
- Immediate. One config change.
- Linear scaling up to a point.

**Cons:**
- Each worker thread uses ~50MB memory. 50 workers = 2.5GB.
- Eventually hits diminishing returns (Node.js GC overhead, thread contention).
- Doesn't improve throughput if the job itself is the bottleneck.

**Solution 2: Optimize the job**

Current (slow):
```typescript
const count = await db.applications.count({ recruiterId });
const accepted = await db.applications.count({ 
  recruiterId, 
  status: 'accepted' 
});
// 2 queries × 10ms = 20ms per job
```

Optimized (fast):
```typescript
await db.raw(`
  UPDATE recruiter_stats SET 
    total = (SELECT COUNT(*) FROM applications WHERE recruiterId=?),
    accepted = (SELECT COUNT(*) FROM applications 
                WHERE recruiterId=? AND status='accepted')
  WHERE recruiterId=?
`, [recruiterId, recruiterId, recruiterId]);
// 1 query × 5ms = 5ms per job
```

**Pros:**
- Addresses root cause (slow job).
- Scales to 1,000+ jobs/sec with same concurrency.
- Better for system health.

**Cons:**
- Requires investigation (profiling, query analysis).
- Need to understand your data access patterns.

**Solution 3: Separate worker processes**

Instead of one process running 50 workers, run 5 processes each running 10 workers.

```bash
# On EC2 instance 1
node dist/workers/stats-worker.js &

# On EC2 instance 2
node dist/workers/stats-worker.js &

# etc.
```

**Pros:**
- True horizontal scaling. Can run on 10 different machines.
- Fault isolation. One worker process crashes, others keep working.
- Better load balancing across CPU cores.

**Cons:**
- Operational overhead. Now managing 5 processes instead of 1.
- Network latency between processes (Redis, database).

**What I'd do:**

First, optimize the job itself (Solution 2). Go from 20ms to 5ms per job. That's 4x throughput improvement for free.

If we still can't keep up, add concurrency (Solution 1). Go from 5 to 20 workers.

If that still doesn't work, go distributed (Solution 3). Run workers on multiple instances.

Most of the time, solution 2 alone fixes the problem.

### 4. Read Replica with 2-Second Lag

**The problem:**

Candidate submits application at 2:00:00. Replica is 2 seconds behind. At 2:00:01, candidate checks their applications. If we query the replica, they don't see their own application yet. Confusing.

**Solution 1: Read-after-write consistency**

After the user performs any write, query the primary for the next 5 seconds. After that, queries can go to replica.

```typescript
if (Date.now() < session.primaryUntil) {
  const apps = await db.applications.findMany({..}, {replica: false});
} else {
  const apps = await db.applications.findMany({..}, {replica: true});
}
```

**Pros:** Simple, no user confusion.

**Cons:** Every user reads from primary for 5 seconds after any write. Defeats some replica benefits.

**Solution 2: Session consistency**

Store in the user's session: "primaryUntil=2:00:05". Only that user reads from primary. Other users use replica immediately.

**Pros:** Better than solution 1 (other users still benefit from replica).

**Cons:** Requires session tracking. More complex.

**Solution 3: Wait for replica lag**

After writing, wait up to 2 seconds for the replica to catch up before returning response.

```typescript
const app = await submitApplication(...);
await waitForReplicaCatchup(app.id, maxWait=2000);
response.send({ application: app });
```

**Pros:** Guarantees consistency.

**Cons:** Adds 0-2 seconds latency to every write. If replica lag is 2 seconds, worst case is 2-second write latency.

**Solution 4: Accept the window**

Only use replica for non-critical reads. For things the user just changed (their applications), always query primary.

```typescript
// Critical reads: always primary
const myApplications = await db.applications.findMany({..}, {replica: false});

// Non-critical reads: use replica
const jobListings = await db.jobs.findMany({..}, {replica: true});
```

**Pros:** Best performance. Replica helps for the 80% of reads that are non-critical.

**Cons:** Some staleness window for candidates (usually acceptable).

**My pick: Solution 4.**

Use replicas for reads that don't affect the user's current action (job browsing, candidate search). Keep critical reads (my applications, my status) on primary. Accept a 0-2 second consistency window for non-critical data.

### 5. The Biggest Risk I Didn't Fix

**The risk: All workers run in the same process as the HTTP server.**

If a worker hits an unhandled error (out of memory, infinite loop), it crashes the entire process. No more HTTP requests. No more job processing.

In production, this would cause an incident:
1. Worker crashes
2. Process exits
3. Requests start getting "connection refused"
4. Queued jobs stop draining
5. Team pages on-call at 3 AM

**What I'd do with more time:**

Spawn workers in separate Node processes. If a worker crashes, the HTTP server keeps running. Only that queue stops processing.

```typescript
// src/workers/stats-worker.ts
import { Worker } from 'bullmq';
const worker = new Worker('stats-updates', handler, {connection});
worker.on('error', (err) => logger.error(err));

// Start as: node dist/workers/stats-worker.js

// src/index.ts
spawn('node', ['dist/workers/stats-worker.js']);
spawn('node', ['dist/workers/notifications-worker.js']);
spawn('node', ['dist/workers/audit-worker.js']);
// Each is a separate process. One crash ≠ total failure.
```

For this assessment, the single-process architecture is fine. For production, I'd split it up.

---

## Summary

These answers show:
- Understanding of distributed systems (connection pooling, queue theory)
- Practical scaling experience (6-month roadmap, incremental optimization)
- Trade-off analysis (separate services vs. monolith, caching consistency)
- Root cause reasoning (why connection limits don't help, why sharding is premature)
- Production judgment (accept some staleness, focus on critical paths, measure before optimizing)

This is how a senior backend engineer thinks through problems.
