<!--lint disable no-undefined-references strong-marker-->

# Implementation Plan: WO-6

**Work Order:** WO-6 — Implement dashboard statistics and paginated logs APIs
**Created At (UTC):** 2026-09-21T07:05:07Z

## Summary

Add read-only `GET /uploads/:id/stats` and `GET /uploads/:id/checks` Worker APIs over persisted reconciled checks. Both endpoints will share one strict UTC/filter parser and upload-state guard, use parameterized PostgreSQL queries, validate every database row before mapping it into shared API contracts, and retain the existing CORS, safe-error, logging, and method-handling behavior.

## Code Reuse And Package Structure

Reuse `routes.ts` and `index.ts` for dispatch, `api/respond.ts` and `api/errors.ts` for exact-origin/safe responses, `db/client.ts` for the cached Neon client, `persistUpload.getUploadRow` for upload existence/state, and the metric definitions in `packages/ingestion/src/metrics.ts` as the reference for rounding, strict breach, and nearest-rank p95. Follow the existing `mapRow.ts` pattern: database values remain `unknown` until fully validated and deliberately converted.

Planned shared-contract changes:

- `packages/shared/src/api.ts`: filter, selected-range, check-row, pagination, aggregate/service-stat, and endpoint response types; query bounds/default constants; validation/conflict error codes.
- `packages/shared/src/index.test.ts`: stable contract constants and error-status coverage.

Planned Worker changes:

- `apps/worker/src/api/query.ts`: parse and validate date/range, service, status, page, and page-size values into a normalized UTC half-open interval.
- `apps/worker/src/db/readChecks.ts`: upload-state lookup plus parameterized list/count and aggregate queries, fixed-clause construction, row validation, numeric/timestamp decoding, and response mapping.
- `apps/worker/src/handlers/getChecks.ts` and `getStats.ts`: thin request adapters with structured timing/count logs.
- `apps/worker/src/routes.ts`, `index.ts`, and `api/errors.ts`: route dispatch and stable 400/409 behavior.
- Worker unit/integration/E2E tests: query, mapping/metrics, routing, HTTP, real-database filtering/order/pagination, and Wrangler endpoint checks.
- `README.md`: complete endpoint contracts, UTC and metric semantics, examples, limits, and verification evidence.

Schema/index changes are conditional on query-plan evidence. The existing indexes already lead with `upload_id` for service/time and status access, so no migration is planned initially.

## Components And Flow

There are no linked Blueprint-defined components. The concrete flow is:

1. `matchRoute` captures upload id and selects `getStats` or `getChecks`; the top-level Worker preserves OPTIONS and `Allow` behavior.
2. `parseCheckQuery(URLSearchParams, mode)` produces a `CheckQuery` containing optional `fromInclusive`/`toExclusive` ISO instants, optional service/status values, and checks-only pagination. It rejects duplicate scalar parameters, impossible UTC dates, mixed `date` and range forms, reversed ranges, blank/oversized service IDs, unknown statuses, and out-of-range integers.
3. The handler loads the upload state. Unknown ids return the existing 404 contract; any non-completed lifecycle returns `upload_not_completed` (409). No checks query runs before that guard succeeds.
4. `readChecks` builds SQL only from fixed code-owned predicates while binding every upload/filter/pagination value. Results order by `check_timestamp DESC, service_id ASC, id ASC`; a separate count supplies stable pagination metadata.
5. `readStats` uses the identical predicate builder. PostgreSQL groups totals and services, uses `percentile_disc(0.95)` for nearest-rank p95, and returns raw numeric values that the mapper validates and rounds to the public contract. Empty populations and empty latency sets map to `null`, never fabricated zero/NaN/infinity.
6. Response metadata echoes the selected filter and normalized UTC bounds. Any explicit date/range makes stats partial. An unfiltered response derives partial from whether the persisted upload range covers complete UTC calendar months, preserving R23 rather than declaring a partial upload definitive.

## Steps

1. **Contracts and parser** — add shared response/error contracts and implement strict URL query normalization with boundary-focused unit tests.
2. **Routes and state guard** — recognize both nested resources, preserve method/OPTIONS behavior, and add thin handlers with stable 404/409/400/safe-500 responses.
3. **Checks data path** — implement parameterized filters, validated row mapping, deterministic order, counts, bounded offset pagination, and unit plus database integration cases.
4. **Statistics data path** — implement overall/per-service aggregates and nearest-rank p95, validate/round persisted values, derive partial semantics, and cover null/no-match/status/service/date cases.
5. **End-to-end and documentation** — extend Wrangler E2E to call representative stats/checks filters after a real upload and document all contracts and semantics in README.
6. **Verification and review** — run focused suites, full build/lint/type-check/test, database-gated and Wrangler E2E when credentials exist, then follow the independent review phase and resolve every finding.
7. **Deployment evidence** — deploy without changing the 1,000 ms ceiling, verify the required production request matrix, capture wall/CPU telemetry, and record evidence. If deployment credentials/telemetry are unavailable, keep the corresponding acceptance item explicitly incomplete rather than claiming completion.

## Testing

Automated coverage will include route recognition and `Allow`, exact-origin CORS, scalar-query duplication, real UTC leap/non-leap dates, half-open boundaries, mixed/reversed ranges, service/status validation, pagination defaults/maxima/errors, row decoding, stable tie ordering, page metadata, empty/null metrics, rounding, strict 99.9% comparison, p95 sample-size boundaries (including n=19/20), partial flags, generic errors, and injection-shaped filter values.

Database integration tests gated by `TEST_DATABASE_URL` will migrate the schema, seed isolated uploads/checks, exercise both query modules across date/service/status/page boundaries, unknown/non-completed uploads and no-match populations, and delete only the exact seeded upload identifiers. Wrangler E2E will upload a supplied dataset and compare endpoint totals/records with direct persisted/ingestion expectations.

Commands: focused `npm test --workspace apps/worker` and `npm test --workspace packages/shared`; gated `TEST_DATABASE_URL=… npm test --workspace apps/worker`; gated `TEST_DATABASE_URL=… npx vitest run --config apps/worker/vitest.e2e.config.ts`; then clean-checkout-equivalent `npm ci`, `npm run build`, `npm run lint`, `npm run type-check`, and `npm test`. Production verification will use the deployed Worker for unfiltered stats, UTC range, paginated checks, service/failure filters, invalid input, and unknown id, with timing/telemetry recorded in the review log and README.
