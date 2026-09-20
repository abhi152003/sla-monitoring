# SLA Monitoring Dashboard

Upload a CSV of service health checks, clean it in a stateless Cloudflare Worker, persist it, and see SLA compliance in a Next.js dashboard.

## Getting Started

### Prerequisites

- **Node.js 22 LTS** (current active LTS) and **npm 10+**

### Install

```bash
npm ci        # clean install from the root lockfile (or: npm install)
```

Everything runs from the repository root — it's an npm workspace (`apps/*`, `packages/*`) with a single root `package-lock.json`.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev:web` | Next.js dev server → http://localhost:3000 |
| `npm run dev:worker` | Wrangler dev server for the Worker → http://localhost:8787 |
| `npm run build` | Build all workspaces (web `next build`, Worker dry-run bundle) |
| `npm run lint` | ESLint (web) |
| `npm run type-check` | `tsc --noEmit` in every workspace |
| `npm test` | Vitest suites (shared, ingestion); workspaces without tests are skipped |

### Local URLs

- **Web app:** http://localhost:3000
- **Worker health:** http://localhost:8787/health

### `/health` response contract

`GET /health` returns HTTP 200 with JSON:

```json
{
  "status": "ok",
  "service": "@sla-monitoring/worker",
  "app": "sla-monitoring",
  "timestamp": "2026-09-19T19:55:32.051Z"
}
```

`status` is the stable field (`"ok"` on success); `timestamp` is ISO-8601 UTC and varies per request. Any other route returns 404 with `{"error":"not_found","message":...}`.

### Environment

`.env.example` templates live in `apps/web` (Worker base URL) and `apps/worker` (database URL placeholder). Copy to `.env.local` / `.dev.vars` and fill in values — never commit real credentials. No configuration is needed to run the current foundation.

### Workspace layout

```
apps/web        Next.js dashboard (@sla-monitoring/web)
apps/worker     Cloudflare Worker (@sla-monitoring/worker)
packages/shared Shared types/contracts (@sla-monitoring/shared)
packages/ingestion CSV processing library (@sla-monitoring/ingestion)
database/migrations  SQL migrations (empty placeholder)
```

### Focused ingestion tests

```bash
npm test --workspace packages/ingestion          # full ingestion suite
npx vitest run src/metrics.test.ts               # one file (from packages/ingestion)
npx vitest run src/datasets.test.ts              # the five-dataset integration suite
```

## Ingestion library (implementation notes, WO-3)

`@sla-monitoring/ingestion` implements the rules below (R1–R27) as a deterministic, dependency-free TypeScript library. It has no Cloudflare, PostgreSQL, or frontend dependencies.

### Public contract

```ts
import { processMonitoringCsv } from "@sla-monitoring/ingestion";

const result = processMonitoringCsv(csvTextOrBytes, { fileName: "…" });
```

`result` is a typed union (`IngestionResult`, defined in `@sla-monitoring/shared`):

- `{ ok: false, error }` — file-level outcomes: `empty_file`, `header_only`, `missing_columns` (all missing names listed), `duplicate_required_headers`, `malformed_csv`.
- `{ ok: true, outcome, records, rejected, invalidObservations, services, months, overall, report }` — `outcome` is `processed` or `no_valid_intervals` (a typed outcome, not an error). Everything is sorted deterministically: records by (serviceId, timestamp), evidence by row number. Row numbers are one-based CSV record numbers (header = 1, first data row = 2). No metric is ever `NaN`, `Infinity`, or a default `0` — no-denominator fields are `null`.

Processing order is R13: normalize/validate → drop invalid observations (999) → collapse post-normalization exact duplicates → reconcile per (serviceId, 15-minute interval) with the R17/R18 selection order (worst status → highest non-null latency → lexicographically smallest agent; a fully tied set is canonically identical, so output never depends on input row order).

### Count definitions (ProcessingReport)

Every count is defined in the `ProcessingReport` doc-comment in `packages/shared/src/ingestion.ts`. The two subtle ones: `timestampConversions` counts every row whose timestamp parsed into a valid date (by source form), including rows rejected at a later stage than timestamp parsing; `latencyConversions` likewise counts rows with a valid unit and numeric non-negative latency. `lowTrust` is `rejectedRows > 5%` of `rawRows` (R25).

### p95 convention

Nearest-rank: sort ascending, take the value at 1-based rank `ceil(0.95 × n)` (`n = 20 → 19th`, `n = 100 → 95th`, `n = 1 → the sample`). No samples → `null`.

### Verification

Golden summaries for all five datasets were produced by an independent reference implementation of R1–R27 and are asserted in `src/datasets.test.ts` (committed fixture: `test-fixtures/datasets-golden.json`). Incident-log windows are validated as failure clusters (R27) but never used as calculation input.

---

# Data Cleaning & SLA Calculation Rules

> **Status: Authoritative policy (WO-1).** This document defines the rules that govern CSV ingestion, cleaning, persistence, SLA calculation, and dashboard metrics. Implementation work (parser, worker, database, dashboard) must conform to it. Setup and local run instructions live in *Getting Started* above; the deployed live URL will be added when deployment work lands.

**Sources:** `docs/problem_statement.md`, `docs/dataset_incident_log.json`, and a full profiling pass over the five `docs/monitoring_checks_*.csv` datasets (44,652 raw rows; 9/12/14/21/30-day spans, Apr–Jun 2025; 5 services; one check per service per 15-minute interval).

Every rule has an ID (`R1`, `R2`, …) for traceability into tests and code review.

---

## 1. Accepted schema and values

**R1 — Required columns.** A CSV is processable only if its header row contains **all eight** of these named columns (any order; matching is by column name, not position):

```
service_id, service_name, timestamp, status_code, latency, latency_unit, agent, region
```

A file missing any of the eight is rejected in full with an explicit error. **Extra columns are allowed and ignored** — the eight required columns must be present; the header may contain more.

**R2 — Field validity (per row).**

| Field | Rule |
| --- | --- |
| `service_id` | Non-empty string. The `service_id → service_name` mapping must be unambiguous within a file, resolved **deterministically and independent of row order**: the most frequent `(service_id, service_name)` pair per `service_id` is authoritative; rows carrying any other `service_name` for that `service_id` are rejected with reason code `inconsistent_service_name`. If two mappings tie exactly in frequency for a `service_id`, **all** rows for that `service_id` are rejected as ambiguous. (*No mapping conflicts observed in the five datasets.*) |
| `timestamp` | Non-empty; must parse under one of the forms in §2. |
| `status_code` | Integer. Classification per §5. |
| `latency`, `latency_unit` | Per §3. `latency_unit` ∈ {`ms`, `s`}; anything else rejects the row. |
| `agent`, `region` | Non-empty strings; informational (they never affect SLA math directly, only reconciliation per §6). |

**R3 — Known vocabulary (observed, not enforced as closed).** Services: `svc-auth`/auth-api, `svc-payments`/payments-api, `svc-search`/search-api, `svc-reports`/reports-api, `svc-notify`/notify-worker. Agents: `agent-1`, `agent-2`. Region: `ap-south-1`. New agents/regions/services are accepted as valid data (open registry) — they are keys and labels, not validity criteria. Only the `service_id/service_name` consistency check (R2) is enforced.

**R4 — Structural malformation.** A row with the wrong number of fields, a non-integer `status_code`, or an unparseable `timestamp` is **rejected** (never silently dropped): it is stored in a rejected-records report with a reason code and excluded from all metrics (see §8).

## 2. Timestamp normalization → UTC

Three forms occur in the data; all are accepted and normalized to UTC `YYYY-MM-DDTHH:mm:00Z`:

**R5 — ISO 8601 UTC (`…Z`)** is taken as-is (97–98% of rows).

**R6 — ISO 8601 with numeric offset** (observed: `+05:30` only, ~0.5–0.8%) is converted to UTC by applying the offset. Example: `2025-04-10T05:45:00+05:30` → `2025-04-10T00:15:00Z`.

**R7 — Unix epoch**: 10 digits = seconds, 13 digits = milliseconds since epoch, interpreted as UTC (~1–1.5% of rows). Any other digit-length is rejected (R4). Example: `1744349400` → `2025-04-11T05:30:00Z`.

**R8 — Grid conformance.** After normalization, every timestamp must land on the 15-minute grid (`second == 0`, `minute ∈ {00, 15, 30, 45}`). Off-grid timestamps are rejected (R4): a legitimate health check from this pipeline cannot occur between intervals, and rounding would fabricate data. *Evidence: 0 of 44,652 rows violate this after normalization.*

## 3. Latency normalization → milliseconds

**R9 — Unit conversion.** `latency_unit == "s"` → multiply by 1000; `"ms"` → as-is. Store as numeric milliseconds (2 decimal places). Note: `svc-search` reports exclusively in seconds; all other services in milliseconds — normalization makes them comparable.

**R10 — Missing latency.** An **empty** latency value (observed: ~1.2% of rows) does **not** invalidate the row: availability depends on `status_code`, not latency. Latency is stored as `NULL` and the row is excluded from latency aggregates (average, p95) — never counted as `0`. A **non-empty but non-numeric** latency (e.g. `N/A`; none observed) rejects the whole record under R11's invalid-latency handling.

**R11 — Invalid latency is a rejected record.** A non-numeric (non-empty) or physically impossible — negative — latency (observed: exactly 1 negative per file, always `status 200`) indicates a malfunctioning agent observation; we do not trust its status verdict either. The whole row is rejected: removed from all metrics and written to the rejected-records report with reason code `invalid_latency`. *Caveat documented: rejecting a successful check slightly lowers measured availability (`(N−1)/(D−1) < N/D` when `N < D`); one record per dataset is immaterial, and trustworthiness wins.*

## 4. Duplicate handling

**R12 — Exact duplicates.** Rows identical across all fields **after normalization** (R5–R9) are collapsed to one; the first occurrence wins. Raw-string equality is not sufficient — the same observation may appear once as `Z`-form and once as epoch. *Observed: 7–25 exact duplicates per file.*

**R13 — Pipeline order.** Normalization (R5–R9) → invalid-observation discard (R15: 999; R11: invalid latency) → exact-duplicate collapse (R12) → multi-agent reconciliation (§6). Discarding invalid observations **before** reconciliation guarantees a monitor-side sentinel can never outvote a real HTTP response. Each stage logs how many rows it removed.

## 5. Record classification by status code

**R14 — Classification table.**

| Status | Class | Effect |
| --- | --- | --- |
| `2xx` (200 observed) | **Success** | Counts in numerator and denominator. |
| `3xx` | **Success** | A redirect is a live response from the service. (None observed.) |
| `4xx`, `5xx` (500, 502, 503 observed) | **Failure** | Counts in denominator only — this is the outage signal. |
| `999` | **Invalid observation** | Excluded from the denominator; counted as a data-quality warning. |
| Malformed per R4 | **Rejected** | Excluded from all metrics; kept in the rejected-records report. |

**R15 — Rationale for 999.** `999` is a sentinel for "agent could not complete the check" (timeout, network error at the monitor, DNS) — it is not an HTTP response from the service. Treating it as a failure would penalize the service for the *monitor's* failure; treating it as success would hide potential outages. Excluding it from the denominator while surfacing it as a warning is the honest middle ground. *Observed: exactly one 999 per file — impact is negligible either way, which makes the conservative choice safe.*

## 6. Multi-agent reconciliation (no double-counted intervals)

Two agents (agent-1, agent-2) sometimes report the **same service + interval** (observed: 345–1,152 multi-observation intervals per file after dedup — the reason raw row counts exceed `days × 96 × 5`).

**R16 — One verdict per (service_id, normalized timestamp).** After R12 collapse, all surviving **valid** observations for the same interval are reconciled into exactly one check record (invalid observations were already discarded at R13).

**R17 — Worst-case status wins.** If agents disagree on status for an interval, the interval counts as **failed**. Rationale: when one monitor observes a failure, the burden of proof is on success; availability must never look better because a second probe got lucky. *Observed: exactly 1 disagreement in the shipped data (14-day file) — a `999`-vs-`200` pair, which R13 resolves by discarding the `999` first; no valid-vs-valid conflict occurs in the data. The rule governs genuine conflicts (e.g. `200` vs `500`).*

**R18 — Representative latency = max.** For a reconciled interval, store the maximum latency among its valid observations (worst customer-visible experience) and the number of observations. The surviving agent/region fields come from the worst-status **valid** observation; if several observations share the worst status, the **highest-latency** one supplies agent/region (consistent with the worst-case policy), and any remaining tie is broken by the lexicographically smallest agent identifier — fully deterministic. The full observation set is retained for audit.

## 7. SLA calculation

**R19 — Valid-check denominator.** `D` = number of reconciled check records (§6) for the service in the window, excluding invalid (999) and rejected (R4, R11) records.

**R20 — Successful-check numerator.** `N` = subset of `D` classified Success (R14).

**R21 — Availability.** `availability = N / D`, displayed as a percentage to 3 decimals (e.g. 99.956%). A single check is worth `1/D` of the month.

**R22 — SLA comparison.** The SLA target is **99.9% monthly availability**. `breached ⇔ availability < 99.9` strictly (99.900% exactly = compliant). Breach → billing-credit event, shown in the dashboard. For scale: a 30-day month has 2,880 intervals; 99.9% tolerates at most 2 failed checks (3 failures = 99.896% = breach).

**R23 — Windowing.** Availability is computed per **service × calendar month** (UTC). A dataset that only partially covers a month is computed over its covered intervals and **flagged `partial`** — the dashboard must not present a partial month as a definitive SLA verdict, since the brief's credit language assumes a full month. Whole-dataset availability is additionally shown as the headline number for an upload.

## 8. Metrics integrity: missing checks, rejected records, partial ranges

**R24 — Missing checks (grid gaps).** Expected grid per service = every 15-min step from min to max normalized timestamp. An interval with no accepted observation is **excluded from the denominator** (unknown ≠ failure) and reported as a **coverage metric** (`coverage = observed intervals / expected grid`). Rationale: a monitoring blackout must not auto-breach the SLA. *Observed: 0 gaps in all five datasets after normalization — this rule is a safeguard, not a correction.*

**R25 — Rejected records.** Every rejection (R4, R11) is counted and surfaced in the UI (`rejected: n, reasons: …`), never silently discarded. If rejected records exceed **5%** of raw rows, the upload is flagged **low-trust** in the dashboard.

**R26 — Partial date ranges.** Filters (single date or range) in the logs view recompute nothing silently: filtering to a sub-range shows that range's own N/D but labels it `partial` per R23 semantics and shows interval counts so the reader can judge significance.

**R27 — Incident cross-check (sanity, not input).** `dataset_incident_log.json` windows must appear as 5xx clusters with elevated latency (confirmed in profiling: latency rises ~4–5× above service baseline inside incident windows, up to ~3s for high-baseline services). The incident log is never an input to SLA math — only a validation aid; disagreement is surfaced as a data-quality note.

## 9. Data findings summary (observed evidence → rule)

| # | Finding (all five CSVs) | Magnitude | Handled by |
| --- | --- | --- | --- |
| 1 | Timestamps in 3 forms: `Z`, `+05:30` offset, epoch-seconds | ~2.2% (offset + epoch) | R6, R7 |
| 2 | `svc-search` reports latency in seconds, others in ms | 100% of svc-search rows | R9 |
| 3 | Empty latency values | ~1.2% of rows | R10 |
| 4 | Negative latency (always status 200) | exactly 1/file | R11 |
| 5 | Exact duplicate rows (incl. post-normalization) | 7–25/file | R12 |
| 6 | agent-1/agent-2 both report same interval | 345–1,152 intervals/file | R16–R18 |
| 7 | Agents disagree on status for one interval (999 vs 200; resolved by R13 ordering) | 1 (14d file) | R17 |
| 8 | Sentinel status `999` | exactly 1/file | R15 |
| 9 | No malformed rows, no off-grid timestamps, no grid gaps | 0 | R4, R8, R24 (safeguards) |
| 10 | Incident-log windows match 5xx clusters + latency spikes | all logged incidents | R27 |
| 11 | Datasets span 9–30 days, never full calendar months | all files | R23, R26 |

## 10. Assumptions

- **A1:** One check per service per 15-minute interval is the intended cadence (stated in the brief; confirmed — all timestamps land on the grid after normalization).
- **A2:** All timestamps, once UTC-normalized, are directly comparable across agents and files (single-region data; no clock-skew correction is attempted).
- **A3:** "Monthly availability" for the credit comparison is per calendar month (R23); uploads covering partial months are shown but flagged.
- **A4:** `999` is a monitor-side sentinel, not a service response (R15).
- **A5:** Worst-case reconciliation (R17) is the correct reading of "trustworthy": availability may under-report, never over-report.
- **A6:** Latency is a secondary signal (dashboard stats only); it never affects availability math.
- **A7:** The 5% rejected-records low-trust threshold (R25) is a pragmatic guardrail: observed rejection rate is ~0.05% of rows (≈2/file: one 999 + one invalid latency), so 5% flags gross pipeline breakage, not borderline noise.
- **A8:** Rules must be deterministic and independent of row order (R2 majority mapping with reject-on-tie; R18 worst-status → highest-latency → lexicographic tie-break), so re-running the pipeline on shuffled input yields identical results.
