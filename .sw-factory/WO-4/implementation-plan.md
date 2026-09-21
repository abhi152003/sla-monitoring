# WO-4 Implementation Plan: Build and benchmark the persistent Worker ingestion API

## Summary

Deployed vertical slice: multipart CSV upload → Worker → `processMonitoringCsv` (unchanged) → Neon PostgreSQL persistence (hash-idempotent, atomic) → retrievable upload summary. Includes health-with-DB-check, CORS, full test layers, migration/schema verification, dataset benchmarks, and an evidence-based routing decision for any out-of-scope chunking work.

**Follow-up delivery:** WO-5 — Configure the server-side CSV ingestion CPU budget (`ec4ff265-9881-45a7-944e-4e700d998fe3`, In Review; child of WO-4) owns the operational follow-up triggered by the 530 ms deployed CPU observation.

## Code Reuse And Package Structure

Reuses: `@sla-monitoring/ingestion` verbatim (no logic duplication), `@sla-monitoring/shared` contracts (extended), Worker `/health` skeleton, vitest/eslint patterns, root scripts (unchanged).

```
database/schema.prisma                    Prisma schema for migration tooling
database/migrations/                      checked-in Prisma SQL migrations for uploads and integrity constraints
apps/worker/src/
  index.ts                               thin router (fetch → route match → handler)
  routes.ts                              route table (testable pure module)
  handlers/upload.ts                     POST /uploads: multipart parse, size gate, hash, idempotency, ingest, persist, respond
  handlers/getUpload.ts                  GET /uploads/:id
  handlers/health.ts                     worker + db reachability
  db/client.ts                           Neon HTTP client from DATABASE_URL
  db/mapRow.ts                           runtime validation and mapping of persisted summaries
  db/persistUpload.ts                    transaction: lock-by-hash → insert children bulk → lifecycle update
  api/errors.ts                          ingestion FileError → ApiError mapping, HTTP statuses
  api/respond.ts                         JSON response + CORS helpers
  api/multipart.ts                       multipart/form-data file extraction
packages/shared/src/api.ts               upload lifecycle, request/response, ApiError contracts
packages/shared/src/index.ts             re-export
apps/worker/test/                        unit tests (db mocked at the boundary)
apps/worker/test/db-integration.test.ts  DB integration + schema verification (TEST_DATABASE_URL gated)
apps/worker/test-e2e/                    local wrangler dev HTTP e2e (gated)
README.md                                deployed benchmark evidence and the WO-5 routing decision
```

## Components And Flow

**Upload flow (POST /uploads):**
1. CORS/size gate (5 MB) → multipart parse (`file` field, CSV expectations) → 413/400 on failure
2. SHA-256 content hash → `SELECT ... WHERE content_hash` idempotency check:
   - completed → 200 replay (stored summary)
   - processing (stale) / failed → delete children if any + replace, same row (deterministic)
3. `processMonitoringCsv(bytes, { fileName })` — file errors map: empty_file/header_only/missing_columns/duplicate headers/malformed_csv → 422; unexpected → 500
4. Persist in one HTTP transaction (`BEGIN; ... COMMIT` via neon atomic batch): upload row (processing) → bulk multi-row INSERTs for checks (with nested observations via jsonb on check row), rejected (jsonb), invalid (jsonb) → update upload to completed with report+metrics JSON. On failure → mark failed (retryable).
5. 201 (new) with full summary: id, status, source metadata, report, overall/services/months metrics.

**Check row design:** reconciled_checks holds all CheckRecord columns (service_id, ts, status, latency, agent, region, observation_count, source_row) plus `observations JSONB` (the full evidence array — bounded ≤2 today). Avoids a second table + join; WO's "complete observation evidence attached to each reconciled check" satisfied. Rejected/invalid are separate tables per WO wording.

**Idempotency:** UNIQUE(content_hash). Replay of identical bytes → single stored summary, no new rows/children.

**Health:** `GET /health` → `SELECT 1` via Neon; typed `{status, database}` — degraded (503) on DB failure with generic message only.

**CORS:** `ALLOWED_ORIGIN` var; reflect exactly that origin, preflight OPTIONS handling, no wildcard.

**Contracts (`shared/api.ts`):** UploadStatus = processing|completed|failed; UploadSummary; ApiError codes; HealthResponse extended (keep `status:"ok"` + add `database`).

## Steps

1. Migrations (tables, PK/FK cascades, checks, indexes: upload hash/status, checks (upload_id, service_id, ts), status).
2. Shared API contracts.
3. DB modules (client, row mapping/query helpers, persistence) with transaction-batched multi-value inserts: 400 `reconciled_checks` rows per statement and 250 rows per statement for each `rejected_rows` and `invalid_observations` collection. Report and metric collections are serialized into the upload row lifecycle update rather than inserted as separate batches.
4. Worker handlers + routing + multipart + CORS + errors; keep `/health` contract backward compatible.
5. Unit tests (mock db module boundary only).
6. `npm run db:migrate` script (local + CI-able); schema verification test.
7. Integration tests + e2e tests (gated by env; skip cleanly when absent per `--if-present` philosophy but WO wants them run — run locally against user-provided TEST_DATABASE_URL / Neon).
8. Ask user for DATABASE_URL (Neon) + Cloudflare login → migrate dev DB → `wrangler deploy` → deployed health/upload/retrieval/replay + benchmarks 9d → 12d → 30d with timing + CPU evidence. If the free-plan budget is exceeded, preserve the evidence and route a separate chunked/background-ingestion work order; do not expand WO-4 into that redesign.
9. README (Neon setup, migration/deploy commands, API examples, benchmark results, chunking decision) + `.env.example` updates.
10. Review phase, checklist, in_review.

## Testing

- Unit (always run): routing table, multipart validation, 5MB gate, file-error → HTTP mapping, idempotent replay behavior (mocked db), failed-state handling, health shapes, CORS reflection, serialization, no-leak assertions (no SQL/host/stack in error bodies).
- Integration (`TEST_DATABASE_URL`): schema verification (tables/constraints/indexes/order), new upload, identical replay (200, no dupes), failed-attempt retry, atomic child persistence (failure mid-write leaves no partial children), FK integrity, JSONB originals, GET round-trip. Isolated: random suffix uploads, cleanup deletes.
- E2E (local wrangler dev + TEST_DATABASE_URL): POST 9d + 12d files via real HTTP → compare returned summaries + persisted counts vs direct `processMonitoringCsv`.
- Deployed: health, upload 9d/12d/30d, retrieval, replay idempotency; record status/size/rows/duration/CPU; conclude chunking need.
- Root: npm ci / build / lint / type-check / test all green.

## Blocking-Issue Remediation Addendum

The WO-4 audit identified five completion blockers. Before review and handoff:

1. Make the upload lifecycle fail-safe: once an upload row exists, unexpected ingestion or persistence failures must make a best-effort transition to `failed` without masking the original error.
2. Make the content-hash claim concurrency-safe. A unique-key race must resolve to the documented completed replay or processing conflict response instead of a generic 500; stale/failed retry deletion must remain guarded.
3. Add PostgreSQL `CHECK` constraints for lifecycle/status domains and non-negative or positive numeric invariants, and extend schema verification tests to assert them.
4. Preserve single-request ingestion for the supplied datasets and record deployed Worker CPU and wall-time evidence. A free-plan overage is evidence for a separate chunked/background-ingestion work order, not a WO-4 implementation failure; database statement batching remains separate from upload chunking.
5. Update README/environment documentation and the WO review evidence with the deployed URL, Neon migration/deployment flow, API examples, benchmark table, limitations, and the final scoped chunking decision.

Additional bounded hardening discovered during the audit is included where it directly supports these blockers: reject obviously oversized multipart requests before body parsing when `Content-Length` proves they cannot fit, return 405 for recognized paths with unsupported methods, and validate persisted summary values at the database boundary without adding a new validation dependency.

Remediation tests cover persistence failure state, concurrent hash-claim races, guarded stale takeover, database constraints, early size rejection, method handling, persisted-row decoding, the full root build/lint/type-check/test matrix, live health, deployed upload/retrieval/replay, and Worker invocation telemetry where the provider exposes it.
