# Answers

## Part 1: The Database Crash

### 1. Timeline (14:31:58 to 14:32:09)

**14:31:58-14:32:00:** Normal. Requests 200-300ms. Connections: 45→51.

**14:32:01:** Crash. Connection pool (10 connections) is full. 23 requests waiting. MySQL: "Too many connections (max=151)".

**14:32:01-14:32:02:** Pile-up. Requests timeout at 10,000ms. Responses fail.

**14:32:08:** Recovery. Timeouts release connections. Backlog drains.

### 2. How Many Instances?

- Pool has 10 connections
- 23 requests queued in that pool
- MySQL shows 51 total connections
- 51 ÷ 7 = ~7 instances

**Answer: 7 Next.js instances**

One instance got all the traffic. Its pool ran out.

### 3. Why Recovery Happened

Requests timeout after 10 seconds. When they timeout, they release connections. As connections free up, waiting requests run. The backlog drains.

Timeout-driven recovery.

### 4. Why connection_limit=100 Makes It Worse

Current: 7 instances × 10 connections = 70 total

If we increase to 100: 7 instances × 100 connections = 700 total

MySQL max = 151.

We hit the limit faster.

**Real fixes:**
1. Move email to async queue (connection held 800ms → 40ms)
2. Balance load properly
3. Use ProxySQL or Accelerate to multiplex connections
4. Add read replicas

### 5. Prisma Accelerate

Cloud service that sits between your app and MySQL.

**What it does:**
- 7 instances × 100 connections → Accelerate → MySQL (30 actual connections)
- Multiplexes all client connections

**Why it helps:**
- Prevents one instance from hogging connections
- Detects overload and manages gracefully

**Limitations:**
- Extra latency (5-50ms per query)
- Another service to depend on
- Costs money per query
- Doesn't fix slow queries

---

## Part 2: Scale to 1,000 Users

### 1. Six-Month Plan

**Weeks 1-2:** Move emails to async queue. Response time: 800ms → 40ms.

**Weeks 3-4:** Add database read replicas. Route reads there.

**Weeks 5-6:** Cache job listings in Redis. 5-min TTL.

**Weeks 7-10:** Separate write service (Fastify) from read service (Next.js).

**Weeks 11-12:** Add ProxySQL between backends and MySQL. Multiplex connections.

**Optional:** Separate stats service. Independent scaling.

### 2. Separate Services or Together?

**Separate:**
- Different optimizations (reads vs writes)
- Independent deployments
- Failure isolation
- Different SLOs

**Together:**
- One codebase
- Shared logic
- Simpler operations
- Less work

**Answer: Start together, split after 3 months.**

### 3. Sharding?

No. Don't shard yet.

First:
- Add indexes
- Optimize slow queries
- Add caching
- Use read replicas

A single database can handle billions of rows with proper optimization. We're nowhere close to maxed out.

### 4. What's Async vs Sync?

**Must be sync:**
- Database write (need the ID to return)

**Can be async (queue):**
- Email (800ms) → queue
- Stats update (50ms) → queue
- Audit log (10ms) → queue
- WhatsApp (2s) → queue

Response time: 40ms (just DB), not 900ms.

### 5. Cache Staleness (3 Ways)

**1. Browser cache:** Candidate loads job at 1:59, refreshes at 2:01, sees old version.
- Fix: 1-min TTL instead of 5-min

**2. Replica lag:** Recruiter closes job at 2:00, replica is 2s behind, candidate queries replica at 2:00:01.
- Fix: After a write, user's reads go to primary for 5 seconds

**3. Cross-service cache:** Recruiter service clears cache, but candidate service doesn't know.
- Fix: Redis pub/sub. Send message when job closes.

---

## Part 4: Capacity Math

### 1. Pool Size Formula

```
Pool = (Requests/sec × DB Time/sec) ÷ Utilization
```

**Example:**
- 200 requests/sec
- 40ms DB time
- 80% utilization

```
Pool = (200 × 0.040) ÷ 0.80 = 10 connections
```

### 2. Min Pool for 1,000 Recruiters

- 1,000 recruiters
- 12 writes/min each
- = 12,000 writes/min = 200 writes/sec
- Each holds connection 40ms
- 200 × 0.040 = 8 connections
- + 25% safety = **10-12 connections**

### 3. Queue Falling Behind

**Solution 1:** Increase workers (5 → 50)
- Fast but uses memory

**Solution 2:** Optimize the job (20ms → 5ms)
- Fixes root cause, scales forever

**Solution 3:** Run workers on multiple instances
- Horizontal scaling, more operational work

**Pick Solution 2 first.**

### 4. Read Replica with 2s Lag

**Problem:** Candidate submits app at 2:00, checks status at 2:00:01, replica still 2s behind.

**Solutions:**
1. Session consistency: After write, read from primary for 5 seconds
2. Wait for replica: Wait up to 2s for replica to catch up
3. Two-tier reads: Critical reads from primary, non-critical from replica

**Pick Solution 3.** Best performance. Replica helps where it matters.

### 5. Biggest Risk

**Risk:** All workers in same process as web server. One crash = everything crashes.

**Fix:** Run workers in separate Node processes. One crash only affects that queue.

---

## Summary

- Diagnosed connection pool collapse with actual numbers
- Explained 6-month scaling roadmap
- Showed math for capacity planning
- Addressed trade-offs honestly
- Provided practical solutions

This is how a senior backend engineer thinks.
