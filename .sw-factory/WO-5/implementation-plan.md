<!--lint disable no-undefined-references strong-marker-->

# Implementation Plan: WO-5

**Work Order:** WO-5 — Configure the server-side CSV ingestion CPU budget
**Created At (UTC):** 2026-09-20T18:08:48Z
**Revised At (UTC):** 2026-09-21T00:00:00Z

## Summary

Run the complete CSV ingestion pipeline in the deployed Cloudflare Worker, as required by `docs/problem_statement.md`. The browser sends the original CSV as multipart form data and performs no parsing, validation, cleaning, hashing, reconciliation, or metric calculation. Configure a bounded 1,000 ms CPU limit; production telemetry measured 331 ms for the maximum supplied dataset.

WO-4's concurrency-safe SHA-256 idempotency, upload lifecycle, atomic Neon persistence, database constraints, runtime row validation, and summary retrieval remain the implementation foundation.

## Code Reuse And Package Structure

- `packages/ingestion`: authoritative R1–R27 CSV parser and processing pipeline.
- `apps/worker/src/api/multipart.ts`: bounded multipart extraction and CSV validation.
- `apps/worker/src/handlers/upload.ts`: content hashing, idempotency claims, ingestion, failure handling, and response mapping.
- `apps/worker/src/db/persistUpload.ts`: atomic persistence of the completed result and upload lifecycle.
- `apps/worker/src/routes.ts` and `src/index.ts`: upload, retrieval, health, CORS, 404, and 405 routing.
- Existing Worker unit, Neon integration, and Wrangler E2E suites for authoritative server-side processing.

Intentional changes:

- `apps/worker/wrangler.jsonc`: set `limits.cpu_ms` to 1,000.
- `README.md`: document the raw browser-to-Worker path, CPU ceiling, and measured telemetry.
- `.sw-factory/WO-5/*`: record verification, review, and handoff evidence.

## Components And Flow

1. The browser submits one original CSV using multipart field `file` to `POST /uploads`.
2. The Worker enforces the request/file size and CSV type, then reads the bounded bytes.
3. The Worker computes the authoritative SHA-256 content hash and resolves completed, active, failed, or stale attempts.
4. The Worker invokes `processMonitoringCsv(bytes, { fileName })` to parse, validate, clean, deduplicate, reconcile, and calculate metrics.
5. The Worker persists the complete result atomically to Neon and returns the stored summary.
6. `GET /uploads/:id` provides the persisted summary without reprocessing.

## Steps

1. Keep raw multipart CSV processing inside the Worker.
2. Configure `limits.cpu_ms = 1000` in Wrangler while retaining the 5 MiB request limit.
3. Update architecture, deployment, benchmark, and verification documentation.
4. Run root build, lint, type-check, and tests; run gated integration suites when their database URL is available.
5. Verify a fresh production upload and persisted retrieval, then obtain an independent review verdict.

## Testing

Automated verification:

- `npm run build`
- `npm run lint`
- `npm run type-check`
- `npm test`
- Worker unit tests for multipart limits, idempotency, failure lifecycle, route methods, response safety, and summary retrieval.
- Neon integration and local Wrangler E2E suites when `TEST_DATABASE_URL` is configured.

Manual/external verification:

- Wrangler dry-run confirms the CPU limit configuration and deployable bundle.
- Production version `16dc69e1-3fe3-419e-a324-5a64154bc11d` processed the maximum supplied dataset: HTTP 201, provider `outcome: ok`, 1,077 ms wall time, and 331 ms CPU time. Persisted retrieval returned the same 15,577 raw rows and 14,398 reconciled intervals.
- Confirm the browser sends raw multipart CSV and has no import or invocation of `@sla-monitoring/ingestion`.
