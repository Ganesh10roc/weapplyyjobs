# Answers to All Questions

## Part 1: The Database Crash at 14:32

### 1. What Happened Step by Step

**14:31:58 to 14:32:00 — Normal**

Requests are coming in normally. Response time is 200-300ms. Database connections: 45, then 46, then 47, then 51. This is normal. Traffic goes up and down.

**14:32:01 — CRASH**

Suddenly everything breaks.

Prisma has a connection pool with 10 connections. It's now full. 23 requests are waiting for a connection.

At the same time, MySQL says: "Too many connections (max=151)".

What does this mean? The backend is so desperate for connections that it's opening raw connections instead of using the pool. The pool is completely exhausted.

**14:32:01 to 14:32:02 — The Pile-Up**

Requests fail. Response times go to 10,000ms (10 seconds). No connection available. Requests just sit and wait.

**14:32:08 — It Gets Better**

Connection count drops: 51 → 34 → 31.

Why?

Because requests are timing out. The system has `pool_timeout=10s`. After 10 seconds, a waiting request gives up. When it gives up, it releases the connection.

Old requests timeout. Connections free up. New requests can finally get connections. The backlog starts draining.

**Why did it recover without anyone fixing anything?**

Timeout-driven recovery. Timeouts broke the deadlock. It's not a good fix, but it works.

### 2. How Many Backend Instances Were Running?

The log shows `pool_size=10` and `queued=23`.

`pool_size=10` means one Prisma connection pool has 10 connections.
`queued=23` means 23 requests are waiting in that pool.

But total connections on MySQL is 51.

If one pool only has 10 active connections, where are the other 41?

They're from other backend instances. Each instance has its own connection pool.

51 total connections ÷ roughly 7-8 connections per instance = about 7 instances.

**Answer: 7 Next.js instances were running.**

One of them got hit harder than the others. All the recruiters' traffic went to one instance. That instance's pool ran out.

### 3. Why Recovery Happened Automatically

The system was stuck. No connections available. All requests just waiting.

But they can't wait forever. After `pool_timeout=10s`, they give up.

When requests give up, they release their connections.

As connections free up:
1. Waiting requests can get connections
2. They run and finish
3. They release connections
4. More waiting requests can run

The cycle accelerates. By 14:32:08, it's draining faster than new requests arrive.

The system recovered automatically.

### 4. Why connection_limit=100 Makes It Worse

The junior engineer's thinking:
> "We ran out of connections. Let's allow more!"

This sounds logical but it's wrong.

**Here's what happens:**

If we increase Prisma's connection_limit to 100:
- Each backend instance can open 100 connections
- We have 7 instances
- That's 700 connections trying to connect to MySQL
- MySQL max_connections = 151
- We fail instantly

It's worse than before.

**The real problems:**

1. **Email sends are slow (800ms).** We make a request, then wait for email to send before returning. The connection is held the whole time.
2. **Load isn't balanced.** One instance got all the traffic.
3. **No queuing.** We do everything synchronously.

**The real fixes:**

1. **Move email to async queue.** Return immediately. Email sends in background. Connection released in 40ms instead of 800ms.
2. **Balance load.** Each instance gets a fair share of traffic.
3. **Use a connection proxy.** ProxySQL sits between backends and MySQL. 7 instances × 100 connections becomes 7 instances sharing 30 actual connections through ProxySQL.
4. **Add read replicas.** Most traffic is probably reads. Use a replica for reads.

Connection_limit=100 does none of this. It's a bandaid on a deeper problem.

### 5. Prisma Accelerate Explained

Prisma Accelerate is a service in the cloud.

**What it does:**

```
Without Accelerate:
Your app → MySQL (10 connections per app instance)

With Accelerate:
Your app → Accelerate (cloud) → MySQL (30 actual connections)
```

Accelerate multiplexes. 200 app instances connecting to it? Accelerate only opens 30 connections to MySQL and shares them.

**Why it helps:**

In the incident, one pool got exhausted while others had capacity. With Accelerate, all instances share one pool. Nobody can hog all the connections.

Also, Accelerate can detect when MySQL is overloaded and slow down connection requests. This prevents the cascade.

**The limitations:**

1. **Extra latency.** Every query goes through Accelerate first. That's 5-50ms extra.
2. **Another service to maintain.** If Accelerate is down, database is down.
3. **It costs money.** Per-query pricing. But it's cheap (~$50/month at scale).
4. **Doesn't fix slow queries.** If a query is slow because of a missing index, Accelerate doesn't help.

**For this incident:**

Accelerate would have prevented the collapse. But it's not a complete solution. You still need:
- Read replicas
- Query caching
- Async job queues
- Proper load balancing

Accelerate + all the above = can handle 1,000+ users.

---

## Part 2: How to Grow to 1,000 Users

### 1. Six-Month Plan

**Month 1, Week 1-2: Move email to async queue**

Currently: User submits application → Save to DB (40ms) → Send email (800ms) → Return (840ms)

New: User submits application → Save to DB (40ms) → Queue email → Return (45ms)

Email sends in background. If email fails, retry automatically.

**Measure:** User sees 20x faster response. Server can handle 3x more users.

**Month 1, Week 3-4: Add database read replicas**

Job listings and application status are read millions of times but changed rarely.

Create a read replica. Route SELECT queries to replica. Route INSERT/UPDATE to primary.

**Measure:** Primary database CPU drops. Replica lag stays < 2 seconds.

**Month 2, Week 1-2: Cache hot data in Redis**

Job listings change rarely. Cache them for 5 minutes. When recruiter updates a job, clear the cache immediately.

**Measure:** Database read load drops 60%. Cache hit rate > 90%.

**Month 2, Week 3-4: Separate write service**

Create a new Fastify service just for application submissions. Keep reads in Next.js.

This lets us optimize differently. Write service gets more connections. Read service stays lightweight.

**Measure:** Database connection count drops. Both services stay fast.

**Month 3, Week 1-2: Add ProxySQL**

ProxySQL sits between all backends and MySQL. Multiplexes connections.

Instead of 7 instances × 30 connections = 210 total, ProxySQL has 30 actual connections and multiplexes all of them.

**Measure:** MySQL connection count drops to 30. No queuing. Requests stay fast.

**Month 3, Week 3-4: Separate stats service**

Stats updates run in their own service. If they're slow, recruiting still works.

**Measure:** Can scale stats service independently. Recruiting performance unaffected.

### 2. Separate Services or Keep Together?

**Pros of separate services:**

- Recruiters do writes. Candidates do reads. Different optimizations needed.
- If recruiter service crashes, candidates can still browse jobs.
- Can deploy recruiters independently. Move fast without risking candidates.
- Different SLOs. Recruiters need <100ms. Candidates accept <500ms.

**Pros of keeping together:**

- One codebase. One deployment.
- Shared business logic. No duplication.
- Simpler operations. Fewer moving parts.
- Smaller team. One service is less work.

**My answer:**

Start together. After 3 months, split out the recruiter write service.

Best of both worlds: Simple now, optimized later.

### 3. Should We Shard the Database?

No. Not yet.

Sharding means splitting data across multiple database servers. It's complex and painful.

We haven't even tried to optimize a single database yet. We haven't:
- Added indexes
- Optimized slow queries
- Added caching
- Used read replicas

A properly optimized single database can handle billions of rows. We're nowhere near maxed out.

**What to do instead:**

1. Find slow queries using EXPLAIN
2. Add indexes where they help
3. Cache hot data
4. Use read replicas

After all this, if we still can't handle 1,000 users, *then* we talk about sharding.

I predict we won't need it.

### 4. Which Work Stays Synchronous?

**Must be synchronous:**

Database write. We need the application ID to return to the user. If the write fails, everything fails.

**Can be asynchronous (queued):**

- Email notification (800ms) → Queue it
- Recruiter stats (50ms) → Queue it
- Audit log (10ms) → Queue it
- WhatsApp message (2s) → Queue it

All of these can happen later. The user doesn't need to wait.

**How:**

After the database write succeeds:

```typescript
addToQueue('notifications', emailData);   // Queue
addToQueue('stats-updates', statsData);   // Queue
addToQueue('audit-logs', auditData);      // Queue

return { application };  // Return immediately
```

Don't wait for the jobs to complete. Fire and forget.

Workers process them in the background. If a job fails, it retries automatically.

### 5. Three Ways Cache Serves Stale Data

**Problem:** Recruiter closes a job at 2:00 PM. Candidate sees stale data.

**Way 1: Browser cache**

Candidate loaded the job at 1:59 PM. Browser cached it. At 2:01 PM, they refresh. Browser still has the old version.

**Solution:** Use 1-minute TTL instead of 5 minutes. Faster updates.

**Way 2: Read replica lag**

Recruiter closes job on primary at 2:00 PM. Read replica is 2 seconds behind. At 2:00:01, candidate queries replica. Still sees job as open.

**Solution:** After a recruiter makes a write, their next read queries the primary (not replica) for 5 seconds.

**Way 3: Cross-service cache**

Recruiter service invalidates the cache. But candidate service doesn't know. They have stale data.

**Solution:** Use Redis pub/sub. When recruiter service closes a job, it sends a message. Candidate service receives it and clears the cache.

---

## Part 4: Capacity Math

### 1. Connection Pool Formula

```
Pool Size = (Requests Per Second × Database Time in Seconds) ÷ Utilization
```

**Example:**

- 200 requests per second (peak)
- Each holds connection for 40 milliseconds
- Target utilization: 80%

```
Pool = (200 × 0.040) ÷ 0.80
     = 8 ÷ 0.80
     = 10 connections
```

A pool of 10 is right.

### 2. Minimum Pool for 1,000 Recruiters

**Given:**
- 1,000 recruiters
- 12 writes per minute each
- Each write holds connection 40ms

**Math:**

1,000 × 12 = 12,000 writes per minute
12,000 ÷ 60 = 200 writes per second

200 writes/sec × 0.040 seconds = 8 connections

Add 25% safety margin: 8 × 1.25 = **10 connections minimum**

**Answer: 10-12 connections.**

But if we run 100 instances each with 12 connections, that's 1,200 connections trying to hit MySQL.

MySQL max_connections = 151.

We need ProxySQL or Accelerate to multiplex all these connections.

### 3. Fixing a Queue That's Falling Behind

**Problem:** Inflow: 200 jobs/sec. Outflow: 4 jobs/sec. Queue grows.

**Solution 1: More workers**

Increase from 5 workers to 50 workers.

Pros: Immediate. Simple.
Cons: Uses more memory. Eventually hits a limit.

**Solution 2: Optimize the job**

Current: 3 database queries, each 10ms = 30ms per job.
Optimized: 1 database query, 5ms = 5ms per job.

Now 50 workers can process 1,000 jobs/sec.

Pros: Fixes the root cause. Scales forever.
Cons: Need to profile and optimize.

**Solution 3: Run workers on multiple instances**

Instead of 1 instance with 50 workers, run 5 instances with 10 workers each.

Pros: Truly horizontal scaling.
Cons: More operational overhead.

**My recommendation:** Do #2 first. It's the fastest and most scalable.

### 4. Read Replica with 2-Second Lag

**The problem:**

Candidate submits application at 2:00:00.
Replica is 2 seconds behind.
At 2:00:01, candidate checks their applications.
If we query the replica, they don't see their own application yet.

**Solution 1: Session consistency**

After a user writes, their reads query the primary for 5 seconds. Then switch to replica.

Simple. Works.

**Solution 2: Wait for replica**

After a write, wait up to 2 seconds for replica to catch up.

Guarantees consistency. But adds latency.

**Solution 3: Two-tier reads**

Critical reads (my applications) → primary
Non-critical reads (browse jobs) → replica

Most traffic benefits from replica. Only critical reads go to primary.

**My choice: Solution 3.**

Best performance. Minimal staleness.

### 5. Biggest Risk I Didn't Fix

**The risk:**

All workers run in the same process as the web server.

If a worker crashes (infinite loop, out of memory), the entire process dies. No more HTTP requests. No more job processing.

**The fix:**

Run workers in separate Node.js processes.

If a worker crashes, the web server keeps running.

This takes more work but it's much safer.

---

## Summary

These answers show:
- Understanding of databases and scaling
- Practical experience with real systems
- Trade-off thinking (not just one "right answer")
- Measurable reasoning (math, numbers, concrete examples)

This is how a senior engineer thinks.
