# AI Code Review SaaS — System Architecture

## Table of Contents
1. [High-Level Architecture](#1-high-level-architecture)
2. [System Components](#2-system-components)
3. [Authentication Flow](#3-authentication-flow)
4. [GitHub Webhook Flow](#4-github-webhook-flow)
5. [AI Review Pipeline](#5-ai-review-pipeline)
6. [Real-Time Updates](#6-real-time-updates)
7. [Multi-Tenancy Design](#7-multi-tenancy-design)
8. [Scalability Strategy](#8-scalability-strategy)
9. [Security Architecture](#9-security-architecture)
10. [Technology Decisions](#10-technology-decisions)
11. [Interview-Level Q&A](#11-interview-level-qa)

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        INTERNET / CLIENTS                           │
│  Browser  │  GitHub Webhooks  │  CI/CD Bots  │  External API Users  │
└─────────────────────────────────────────────────────────────────────┘
                                │
                         ┌──────▼──────┐
                         │   CLOUDFRONT │  (CDN + WAF + DDoS protection)
                         │   / NGINX   │
                         └──────┬──────┘
                    ┌───────────┼───────────┐
                    │           │           │
             ┌──────▼──┐  ┌────▼───┐  ┌───▼──────┐
             │ Next.js  │  │NestJS  │  │ Webhook  │
             │  Web App │  │  API   │  │ Gateway  │
             │ (Vercel/ │  │(ECS/   │  │ (Lambda/ │
             │  ECS)   │  │  K8s)  │  │  ECS)    │
             └─────────┘  └────┬───┘  └───┬──────┘
                               │           │
              ┌────────────────┼───────────┤
              │                │           │
       ┌──────▼──┐    ┌────────▼──┐  ┌────▼─────┐
       │Postgres │    │   Redis   │  │  BullMQ  │
       │(RDS/    │    │ (Cluster) │  │  Workers │
       │ Aurora) │    │           │  │          │
       └─────────┘    └───────────┘  └────┬─────┘
                                          │
              ┌────────────────────────────┤
              │                            │
       ┌──────▼──────┐            ┌────────▼───────┐
       │  OpenAI     │            │  Pinecone       │
       │  GPT-4.1    │            │  Vector DB      │
       │  (AI Core)  │            │  (RAG Context)  │
       └─────────────┘            └────────────────┘
```

---

## 2. System Components

### 2.1 Frontend — Next.js (App Router)
- **Role:** Server-side rendered React app, dashboard, auth pages, review UI
- **Routing:** App Router with server components for data fetching
- **State:** MobX for client state, React Query for server state
- **Real-time:** WebSocket client for live review updates
- **Deployment:** Vercel or AWS ECS with NGINX

### 2.2 Backend API — NestJS
- **Role:** Core business logic, REST API, WebSocket gateway
- **Pattern:** Modular monolith (microservice-ready via NestJS modules)
- **Modules:** Auth, Users, Organizations, Repositories, PullRequests, AIReview, GitHub, Billing, Notifications, Analytics, Webhooks
- **Transport:** HTTP + WebSockets (same server)
- **Deployment:** AWS ECS (Fargate) behind ALB, or Kubernetes

### 2.3 AI Review Workers — BullMQ Processors
- **Role:** Background AI processing, isolated from HTTP server
- **Pattern:** Producer/Consumer via Redis-backed queues
- **Queues:** `ai-review`, `github-sync`, `notifications`, `embeddings`
- **Scaling:** Horizontal — spin up more worker pods based on queue depth
- **Retry:** Exponential backoff with dead-letter queue

### 2.4 Database — PostgreSQL (Prisma ORM)
- **Schema:** 16 core tables, UUID primary keys, soft deletes
- **Multi-tenancy:** Organization-scoped rows with RLS-like middleware
- **Migrations:** Prisma Migrate with version-controlled migration files
- **Production:** AWS RDS Aurora PostgreSQL (auto-scaling, read replicas)
- **Connection pooling:** PgBouncer in transaction mode

### 2.5 Cache & Queues — Redis
- **Cache:** JWT refresh tokens, AI review results, rate limiting counters
- **Sessions:** Sliding window refresh token blacklist
- **Queues:** BullMQ job persistence, delayed jobs, scheduled jobs
- **Pub/Sub:** WebSocket event broadcasting across API instances
- **Production:** AWS ElastiCache Redis Cluster

### 2.6 AI Engine — OpenAI + LangChain
- **Model:** GPT-4.1 (primary), GPT-4.1-mini (fallback for cost control)
- **Framework:** LangChain for prompt chaining and RAG
- **Structured output:** OpenAI function calling for type-safe review JSON
- **RAG:** Pinecone vector DB for codebase context retrieval
- **Caching:** Redis caches reviews for identical file hashes (SHA-256)

---

## 3. Authentication Flow

### 3.1 Email/Password Registration + JWT

```
Client                    API Server                 Redis           Database
  │                           │                        │                │
  ├──POST /auth/register──────►│                        │                │
  │                           ├──hash password (bcrypt)│                │
  │                           ├──────────────────────────────────────────►
  │                           │                        │    CREATE user │
  │◄──201 { user, tokens }────┤                        │                │
  │                           ├──store refreshToken────►│                │
  │                           │   (key: rt:userId:jti) │                │
  │                           │   (TTL: 7 days)        │                │
```

**Access Token:** Short-lived (15 min), signed JWT stored in memory  
**Refresh Token:** Long-lived (7 days), stored in Redis + httpOnly cookie  
**Rotation:** Each refresh issues a new pair, old token invalidated (prevents replay)

### 3.2 GitHub OAuth Flow

```
Browser               Frontend              API               GitHub
  │                      │                   │                   │
  ├─Click "Connect"──────►│                   │                   │
  │                      ├─GET /auth/github──►│                   │
  │                      │                   ├──redirect to──────►│
  │◄────────redirect──────────────────────────────────────────────┤
  │──authorize app───────────────────────────────────────────────►│
  │◄────────────────────────────────callback with ?code=xxx───────┤
  ├──GET /auth/github/callback?code=xxx───►│                   │
  │                      │                   ├──exchange code────►│
  │                      │                   │◄──access_token────┤
  │                      │                   ├──GET /user────────►│
  │                      │                   │◄──GitHub profile───┤
  │                      │                   ├──upsert user        │
  │                      │                   ├──encrypt GitHub token
  │◄──redirect with JWT cookie──────────────┤                   │
```

**Security:**
- GitHub token encrypted at rest with AES-256-GCM
- State parameter validated to prevent CSRF
- Webhook secrets validated via HMAC-SHA256

### 3.3 Role-Based Access Control (RBAC)

| Role           | Scope         | Permissions                              |
|----------------|---------------|------------------------------------------|
| `SUPER_ADMIN`  | Platform      | Full platform access, manage all orgs    |
| `ORG_OWNER`    | Organization  | Manage org, billing, all repos           |
| `ORG_ADMIN`    | Organization  | Manage members, repos, settings          |
| `ORG_MEMBER`   | Organization  | View repos, trigger reviews              |
| `VIEWER`       | Organization  | Read-only access to reviews              |

---

## 4. GitHub Webhook Flow

```
GitHub                 API/Webhook Gateway          BullMQ           Worker
  │                           │                        │                │
  ├──POST /webhooks/github────►│                        │                │
  │   X-Hub-Signature-256      │                        │                │
  │   X-GitHub-Event: PR       │                        │                │
  │                           ├─validate HMAC signature │                │
  │                           │  (reject if invalid)    │                │
  │◄──202 Accepted────────────┤  (immediate response)   │                │
  │                           ├──parse event type        │                │
  │                           ├─emit to queue────────────►│               │
  │                           │   ai-review queue         │               │
  │                           │                           ├─worker picks──►│
  │                           │                           │  up job        │
  │                           │                           │               ├─fetch PR diff
  │                           │                           │               ├─parse diff
  │                           │                           │               ├─build prompts
  │                           │                           │               ├─RAG context
  │                           │                           │               ├─call OpenAI
  │                           │                           │               ├─store results
  │                           │                           │               ├─post to GitHub
  │                           │                           │               ├─notify user
  │                           │                           │◄─job complete──┤
```

**Webhook Events Handled:**
- `pull_request.opened` → Trigger full review
- `pull_request.synchronize` → Review new commits only
- `pull_request.reopened` → Re-trigger review
- `push` → Index commits for RAG context
- `installation.created` → Setup GitHub App

**Reliability:**
- Immediate 202 response (GitHub times out at 10s)
- Idempotency key per PR+SHA prevents duplicate reviews
- Dead letter queue for failed jobs with alerting
- At-least-once delivery via BullMQ persistence

---

## 5. AI Review Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                     AI REVIEW PIPELINE                          │
│                                                                 │
│  1. FETCH DIFF          2. PARSE DIFF         3. RAG CONTEXT   │
│  ┌──────────────┐      ┌─────────────┐       ┌──────────────┐  │
│  │GitHub API    │      │ Diff Parser │       │ Embedding    │  │
│  │Get PR diff   │─────►│ Split by    │──────►│ Service      │  │
│  │Full file     │      │ file/hunk   │       │ text-embed-  │  │
│  │context       │      │ Extract     │       │ 3-large      │  │
│  └──────────────┘      │ metadata    │       └──────┬───────┘  │
│                        └─────────────┘              │           │
│                                                     │           │
│  4. BUILD PROMPT        5. AI REVIEW         6. PARSE OUTPUT   │
│  ┌──────────────┐      ┌─────────────┐       ┌──────────────┐  │
│  │ Prompt       │      │ OpenAI      │       │ JSON Parser  │  │
│  │ Builder      │◄─────│ GPT-4.1     │──────►│ Validate     │  │
│  │ System msg   │      │ Function    │       │ schema       │  │
│  │ + diff       │      │ calling     │       │ Extract      │  │
│  │ + RAG ctx    │      │ structured  │       │ comments     │  │
│  └──────────────┘      │ output      │       └──────┬───────┘  │
│         │              └─────────────┘              │           │
│         │                                           ▼           │
│  ┌──────▼──────────────────────────────────────────────────┐    │
│  │                   7. STORE & NOTIFY                      │    │
│  │  DB → ReviewComments  │  GitHub → PR Comments  │  WS    │    │
│  └──────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 5.1 AI Prompt Strategy

The system uses a **multi-stage prompting approach:**

**Stage 1 — System Context**
```
You are an expert senior software engineer and security specialist.
Review the following code changes with the precision of a lead
engineer at a top tech company. Focus on correctness, security,
performance, and maintainability.
```

**Stage 2 — Structured Review Request**
- Diff content chunked into ≤2000 tokens per file
- RAG context from similar code patterns in the codebase
- OpenAI function calling ensures type-safe JSON output

**Stage 3 — Output Schema (Function Calling)**
```json
{
  "name": "submit_code_review",
  "parameters": {
    "comments": [{
      "severity": "critical|high|medium|low|info",
      "category": "security|bug|performance|quality|testing|documentation",
      "file": "string",
      "startLine": "number",
      "endLine": "number",
      "issue": "string (≤200 chars)",
      "suggestion": "string (≤500 chars)",
      "codeExample": "string (optional)",
      "confidence": "number (0-1)"
    }]
  }
}
```

### 5.2 RAG (Retrieval-Augmented Generation) Architecture

```
Indexing Phase (on push events):
  Source code → Text splitter (500 tokens, 50 overlap)
             → OpenAI text-embedding-3-large
             → Pinecone upsert (namespace: orgId/repoId)

Retrieval Phase (during review):
  Code diff → Generate query embedding
           → Pinecone similarity search (top-k: 5)
           → Inject context into prompt
```

**Why RAG?** Enables the AI to understand repository-specific patterns,
naming conventions, and architectural decisions — not just generic code review.

### 5.3 Review Caching

```
cache_key = SHA256(file_path + file_content_hash + model_version)
```
- Cache hit → Return cached review (Redis, 24h TTL)
- Cache miss → Full AI review, store result
- Invalidation → On new commits to same file

---

## 6. Real-Time Updates

### WebSocket Architecture

```
Client            API (WS Gateway)          Redis Pub/Sub
  │                    │                         │
  ├──WS connect────────►│                         │
  ├──subscribe(jobId)───►│                         │
  │                    │                         │
  │              [Worker completes review]        │
  │                    │◄────PUBLISH reviewId─────┤
  │◄───review:progress──┤                         │
  │◄───review:complete──┤                         │
```

**Pattern:** All NestJS instances subscribe to Redis Pub/Sub.
When a worker publishes a review completion, every API instance
broadcasts to connected clients subscribed to that job.
This ensures horizontal scaling of the WebSocket layer.

---

## 7. Multi-Tenancy Design

**Model: Organization-based multi-tenancy with shared database**

```
User ──belongs to many──► Organization
Organization ──has many──► Repository
Repository ──has many────► PullRequest
PullRequest ──has many───► ReviewJob
ReviewJob ──has many─────► ReviewComment
```

**Tenant isolation enforced at:**
1. **Prisma middleware** — Automatically scopes all queries to `organizationId`
2. **JWT claims** — Token includes `organizationId` and `role`
3. **Guards** — `OrganizationGuard` validates request belongs to org
4. **Row-level** — Every data table has `organizationId` column

**Why shared DB, not schema-per-tenant?**
- Easier to operate and maintain
- Cross-tenant analytics possible
- Simpler migrations
- Cost-effective at current scale
- Can migrate to schema-per-tenant later if compliance requires

---

## 8. Scalability Strategy

### Scale Stages

| Users       | Architecture                          | Key Changes                              |
|-------------|---------------------------------------|------------------------------------------|
| 0–1K        | Docker Compose, single server         | Baseline monolith, easy deploy           |
| 1K–10K      | ECS Fargate, RDS, ElastiCache         | Horizontal API scaling, read replicas    |
| 10K–100K    | EKS, Aurora Serverless, Redis Cluster | Auto-scaling, PgBouncer, CDN             |
| 100K–1M     | Microservices, Kafka, multi-region    | CQRS, event sourcing, database sharding  |

### Bottleneck Analysis

**AI Reviews (Primary bottleneck)**
- OpenAI API has rate limits → BullMQ with rate limiter
- Reviews take 10–60s → async processing, WebSocket updates
- Cost-control → Cache identical diffs, use smaller model for low-severity

**Database**
- N+1 queries → Prisma `include` with careful query planning
- Hot rows → Redis caching for frequently-read data
- Growth → PostgreSQL table partitioning by `createdAt`

**GitHub API**
- 5000 req/hour per token → Token pool, respect rate limit headers
- Rate limit → Exponential backoff, queue throttling

---

## 9. Security Architecture

### 9.1 API Security Layers
```
Request → NGINX (TLS termination, rate limit) 
        → WAF (OWASP rule set, IP allowlist for webhooks)
        → NestJS (Helmet, CORS, body size limits)
        → JWT validation
        → RBAC guard
        → Input validation (class-validator DTOs)
        → Business logic
```

### 9.2 Secrets Management
- **Local:** `.env` files (never committed)
- **Staging/Prod:** AWS Secrets Manager, injected as env vars at deploy time
- **GitHub tokens:** AES-256-GCM encrypted before DB storage
- **Webhook secrets:** Per-repo HMAC-SHA256 validation
- **Rotation:** 90-day JWT secret rotation, automated via Lambda

### 9.3 Data Protection
- Passwords: bcrypt (cost=12)
- PII: PostgreSQL column-level encryption for sensitive fields
- Audit log: Every state-changing action recorded in `AuditLog` table
- GDPR: Soft deletes + data export endpoint per user request

### 9.4 Webhook Security
```typescript
// HMAC-SHA256 validation on every incoming webhook
const sig = req.headers['x-hub-signature-256'];
const hmac = createHmac('sha256', webhookSecret);
hmac.update(JSON.stringify(payload));
const expected = `sha256=${hmac.digest('hex')}`;
if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
  throw new ForbiddenException('Invalid webhook signature');
}
```

---

## 10. Technology Decisions

### Why NestJS over Express?
- **Dependency injection** — Testable, maintainable, scalable
- **Modules** — Clear boundaries between features, microservice-ready
- **Decorators** — Guards, interceptors, pipes as reusable middleware
- **WebSockets** — First-class Gateway support out of the box
- **Ecosystem** — BullMQ, Prisma, Passport all have official NestJS adapters
- **Tradeoff:** More boilerplate than Express; opinionated structure

### Why Prisma over TypeORM?
- **Type safety** — Generated types match DB schema exactly, compile-time safety
- **DX** — Intuitive query API, no need to learn ORM-specific DSL
- **Migrations** — Declarative schema-first with migration history
- **Tradeoff:** Less flexible for complex raw queries (use `$queryRaw` when needed)

### Why BullMQ over SQS?
- **Redis-backed** — Already using Redis, no new infrastructure
- **Local dev** — Works in Docker Compose without AWS
- **Features** — Job priorities, rate limiting, repeatable jobs built-in
- **Tradeoff:** Redis becomes a critical dependency; SQS for production at 1M+ users

### Why PostgreSQL over MongoDB?
- **ACID transactions** — Financial data (billing) requires consistency
- **Relational integrity** — Org/Repo/PR relationships need foreign keys
- **Prisma support** — Best-in-class Prisma support
- **Tradeoff:** JSON columns for semi-structured review metadata (best of both)

### Why LangChain?
- **Abstraction** — Can swap OpenAI for Anthropic/local models without rewrite
- **RAG utilities** — Document loaders, text splitters, vector store integrations
- **Prompt templates** — Version-controlled, composable prompts
- **Tradeoff:** Adds complexity; for simple cases, use OpenAI SDK directly

### Why Pinecone over pgvector?
- **Managed** — No operational overhead, auto-scaling
- **Performance** — Optimized ANN at scale
- **Tradeoff:** External dependency, cost at high volume; migrate to pgvector at 1M+ vectors

---

## 11. Interview-Level Q&A

**Q: How do you handle concurrent reviews of the same PR?**
A: BullMQ job deduplication using `jobId = ${prId}:${headSHA}`. If a job with
the same ID exists in pending/active state, the new one is dropped. This is
critical when GitHub fires multiple webhook events for the same push.

**Q: How do you ensure the AI review is consistent?**
A: Temperature set to 0.1 (near-deterministic), structured output via function
calling (no hallucinated JSON), seed parameter for reproducibility, review
results cached by content hash for 24 hours.

**Q: How do you handle OpenAI API failures?**
A: BullMQ retry with exponential backoff (3 attempts: 5s, 30s, 120s).
After all retries fail, job moves to DLQ and PagerDuty alert fires.
User sees "Review failed, retry" button that re-queues the job.

**Q: How do you prevent one tenant's reviews from blocking others?**
A: Per-tenant rate limiting in BullMQ (max 5 concurrent reviews per org on
Free, 20 on Pro). Queue priority: Team > Pro > Free. Fair queuing prevents
a chatty free-tier user from starving paid customers.

**Q: How would you shard the database at 10M users?**
A: Partition by `organization_id` using PostgreSQL range/hash partitioning.
Hot path (active reviews) served from Redis cache. Read replicas for analytics.
Eventually migrate to Citus (distributed PostgreSQL) for horizontal sharding.

**Q: How do you handle the GitHub token refresh?**
A: GitHub OAuth tokens don't expire (unlike GitHub Apps). For GitHub Apps
(installation tokens), tokens expire in 1 hour — a background BullMQ repeatable
job refreshes tokens 10 minutes before expiry and updates the encrypted DB record.

**Q: What's your disaster recovery strategy?**
A: RTO < 4h, RPO < 1h. Aurora has automated backups every 5 min (PITR).
Multi-AZ standby for automatic failover. Redis AOF + RDB snapshots to S3.
Terraform IaC means full infra can be rebuilt in another region in < 2h.
