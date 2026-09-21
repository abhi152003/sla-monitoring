# SLA Monitoring Dashboard

A single-screen dashboard for service health checks and SLA review.

Upload a CSV file to process its records in a Cloudflare Worker. The Worker cleans and reconciles the data, then stores it in PostgreSQL(NeonDB). The dashboard reads the stored data and shows availability, latency, SLA status, data quality, and filterable logs.

## Live deployment

- Dashboard: [sla.abhip.xyz](https://sla.abhip.xyz)
- Worker API: [sla-monitoring-worker.abhiprajapati011.workers.dev](https://sla-monitoring-worker.abhiprajapati011.workers.dev)
- Health check: [Worker health endpoint](https://sla-monitoring-worker.abhiprajapati011.workers.dev/health)

The dashboard and health endpoint returned HTTP 200 on **September 21, 2026**. The health endpoint also reported that the database was reachable.

> **Cost constraint:** the current Worker needs the Cloudflare Workers Paid plan. A 30-day upload used 331 ms of CPU, which exceeds the free-tier CPU limit. This deployment does not fully meet the no-cost constraint in the brief. See [What I would improve](#what-i-would-improve).

## What the dashboard shows

The dashboard has 2 sections:

1. A collapsible statistics section shows availability, SLA status, average latency, p95 latency, and data-quality warnings.
2. A logs section shows the reconciled checks. A user can filter by one date, a date range, a service, or a status.

All date filters use UTC.
## Architecture

```text
Browser on Vercel
    │
    │ CSV upload and read requests
    ▼
Cloudflare Worker
    ├── validates and parses the CSV
    ├── normalizes and reconciles observations
    ├── calculates upload metrics
    └── writes one atomic transaction
             │
             ▼
       Neon PostgreSQL
             │
             │ stored checks and metrics
             └──────────────► Cloudflare Worker ─► Browser
```

| Part | Host | Reason |
| --- | --- | --- |
| Dashboard | Vercel | It supports the Next.js application and simple deployments. |
| Processing API | Cloudflare Worker | It provides a deployed stateless function near the client. |
| Database | Neon PostgreSQL | It provides durable SQL storage and a serverless HTTP driver. |
| Schema changes | Prisma migrations | They keep database changes repeatable without adding Prisma Client to the Worker. |
| Shared logic | TypeScript workspaces | They keep API types and ingestion rules consistent across the repository. |

The browser sends the original file to the Worker. It does not clean data or calculate SLA metrics. The Worker calculates a SHA-256 hash for each file and uses it as an idempotency key. An identical upload returns the first stored result.

The Worker stores the upload, reconciled checks, rejected rows, invalid observations, and metrics in one transaction. PostgreSQL is the source of truth for all later queries.

## Data findings and handling

The 5 supplied files contain **44,652 rows**. They cover 9 to 30 days between April 3 and June 1, 2025.

| Finding | Observed result | Handling |
| --- | --- | --- |
| Timestamps use UTC, `+05:30`, and Unix seconds. | About 2.2% need conversion. | Convert all valid timestamps to UTC. Reject timestamps outside the 15-minute grid. |
| `svc-search` reports latency in seconds. | Other services report milliseconds. | Convert all latency values to milliseconds. |
| Some latency values are empty. | About 1.2% of rows. | Keep the check, store `NULL`, and omit it from latency metrics. |
| Some latency values are negative. | Exactly 1 row in each file. | Reject the full row because its observation is not trustworthy. |
| Files contain exact duplicates. | 7 to 25 rows in each file. | Normalize first, then remove duplicates. |
| Two agents can report the same interval. | 345 to 1,152 intervals in each file. | Store one verdict for each service and 15-minute interval. Keep the evidence for audit. |
| Agents can disagree. | One `999` and `200` pair occurs. | Remove `999` first. For valid conflicts, use the worst status and highest latency. |
| Status `999` is not an HTTP response. | Exactly 1 row in each file. | Store it as an invalid observation and exclude it from SLA metrics. |
| Incident windows match failures and latency spikes. | All supplied incidents match. | Use the incident log only as a check. Never use it as calculation input. |
| No file covers a full calendar month. | All results are partial. | Calculate the visible result, but do not present it as a final billing verdict. |

The pipeline keeps every rejected row with a reason code. It marks an upload as low trust when rejected rows exceed 5% of total rows.

## SLA rules and assumptions

These choices make the result deterministic and conservative:

- A successful check has a status from 200 through 399.
- A failed check has a status from 400 through 599.
- Status `999` is a monitor fault, not a service response.
- One service can contribute only one result for each 15-minute interval.
- If valid agents disagree, the worst status wins.
- The representative latency is the highest valid latency for the interval.
- Availability is `successful checks / valid reconciled checks`.
- A service breaches the SLA when availability is strictly below 99.9%.
- Missing intervals are unknown. They do not count as successes or failures.
- Monthly calculations use UTC calendar months.
- Partial months show useful evidence, but they do not define billing credits.
- p95 uses the nearest-rank method.
- File order cannot change the result. Stable tie rules select the same record after a shuffle.

The statistics focus on availability, failures, average latency, p95 latency, coverage, and data quality. These values help an on-call engineer find an incident and help a billing reviewer judge the result.

## Run locally

### Prerequisites

- Node.js 22 or later
- npm 10 or later
- A Neon PostgreSQL database

### 1. Install dependencies

```bash
npm ci
```

### 2. Configure the web app

```bash
cp apps/web/.env.example apps/web/.env.local
```

Keep `NEXT_PUBLIC_WORKER_URL=http://localhost:8787` for local use.

### 3. Configure the Worker

```bash
cp apps/worker/.env.example apps/worker/.env
cp apps/worker/.env.example apps/worker/.dev.vars
```

Set the same `DATABASE_URL` in both files. Set `ALLOWED_ORIGIN=http://localhost:3000` in `.dev.vars`.
### 4. Apply the database migrations

```bash
npm run db:migrate --workspace apps/worker
```

### 5. Start both applications

Run these commands in separate terminals:

```bash
npm run dev:worker
```

```bash
npm run dev:web
```

Open [http://localhost:3000](http://localhost:3000). The local Worker runs at [http://localhost:8787](http://localhost:8787).

## Useful commands

| Command | Result |
| --- | --- |
| `npm run dev:web` | Starts the Next.js app on port 3000. |
| `npm run dev:worker` | Starts the Worker on port 8787. |
| `npm run build` | Builds all workspaces. |
| `npm run lint` | Runs ESLint. |
| `npm run type-check` | Runs the TypeScript checks. |
| `npm test` | Runs the Vitest suites. |

The test suite covers CSV parsing, normalization, reconciliation, metrics, routes, CORS, database mapping, read APIs, and all 5 supplied datasets.
## API summary

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Checks the Worker and database. |
| `POST /uploads` | Accepts one CSV file in the `file` multipart field. The limit is 5 MiB. |
| `GET /uploads/:id` | Gets a stored upload summary. |
| `GET /uploads/:id/stats` | Gets stored statistics with optional filters. |
| `GET /uploads/:id/checks` | Gets a page of stored checks with optional filters. |

Read endpoints accept `date`, `from`, `to`, `serviceId`, and `status`. The checks endpoint also accepts `page` and `pageSize`. The maximum page size is 100.

## What I would improve

With more time, I would:

1. Store each uploaded file in object storage, then process fixed-size row batches in separate function calls. Store intermediate results in staging tables, and publish the upload only after all batches succeed. If this design still exceeds the free limit, move the function to a provider with a larger free CPU allowance.
2. Stream the CSV parser and database writes. This change would reduce peak memory use for files larger than the supplied data.
