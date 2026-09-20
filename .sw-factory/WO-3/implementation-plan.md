# WO-3 Implementation Plan: Implement and test the TypeScript CSV processing library

## Summary

Replace the `packages/ingestion` placeholder with a dependency-free TypeScript library implementing README rules R1–R27 end to end: RFC 4180 parsing, R1/R2 file+mapping validation, timestamp/latency/status normalization (R5–R11, R14/R15), R13 pipeline ordering (validate → drop invalid → dedupe → reconcile), R17/R18 deterministic reconciliation, R19–R26 metrics (availability, coverage, p95, months, partial flags, low-trust), and a fully documented processing report. Public result contracts live in `packages/shared`. Golden integration numbers are produced by an independent Python reference implementation of the same rules, then asserted by vitest against all five real CSVs.

## Code Reuse And Package Structure

Reuses: `packages/shared` (extends with ingestion contracts), existing vitest/tsconfig patterns from WO-2, root scripts (unchanged — `--workspaces --if-present` picks up new scripts). Datasets are read directly from `docs/*.csv` (no copies).

```
packages/shared/src/
  app.ts          existing (APP_NAME, HealthResponse...)
  ingestion.ts    NEW - all public result contracts + reason codes
  index.ts        re-exports
packages/ingestion/src/
  index.ts        public entry: processMonitoringCsv(input, options)
  csv.ts          RFC 4180 parser (hand-rolled, deterministic, no deps)
  normalize.ts    timestamp (manual regex + Date.UTC, TZ-free), latency, status classification
  pipeline.ts     R2 mapping resolution, row validation, invalid-observation removal, dedupe, reconciliation
  metrics.ts      availability, coverage grid, p95 (nearest-rank), UTC calendar months, partial flags, low-trust
  *.test.ts       unit tests per rule branch (csv, timestamps, latency, status, mapping, dedupe, reconcile, metrics, report, shuffle)
  datasets.test.ts integration: all 5 CSVs vs golden summaries + incident-window cross-check
/tmp/opencode/    Python reference implementation → golden numbers (scratch, not committed)
```

Modified: `packages/ingestion/package.json` (add lint script + eslint deps), `README.md` (implementation-notes section).

## Components And Flow

**Public entry** — `processMonitoringCsv(input: string | Uint8Array, options?: { fileName?: string }): IngestionResult` where `IngestionResult` is a discriminated union:

- `{ ok: false; error: FileError }` — `empty_file | header_only | missing_columns (all names listed) | duplicate_required_headers | malformed_csv`
- `{ ok: true; outcome: "processed" | "no_valid_intervals"; records; rejected; invalidObservations; duplicateRemovals; services: ServiceMetrics[]; overall: OverallMetrics; months: MonthlyMetrics[]; report: ProcessingReport }`

**Flow:** decode → parse (csv.ts) → header validation (R1) → R2 mapping resolution (majority per service_id, minority rows → `inconsistent_service_name`, ties → `ambiguous_service_mapping` for all rows of that id) → per-row validation/normalization (R5–R11, R14) → 999 removal to invalid-observations bucket (R15) → post-normalization exact-duplicate collapse (R12, key = all normalized fields, first row kept, removals logged) → interval reconciliation (R16–R18: worst status class [2xx<3xx<4xx<5xx, then higher code], then highest non-null latency [null ranks lowest for selection], then lex-smallest agent; interval latency = max non-null or null; full valid observation set preserved) → metrics (R19–R26) → report.

**Determinism:** output records sorted by (serviceId, timestamp); rejected/invalid by rowNumber; months by (serviceId, month). Comparator never consults input order — fully tied observations have identical canonical fields.

**Metrics contract:** `availabilityPercent` (3dp) + `availabilityRatio` + `breached = ratio < 0.999`; coverage = reconciled intervals / expected 15-min grid from per-service min..max; p95 = nearest-rank (ceil(0.95·n), 1-based) over interval latencies; monthly groups partial unless range covers the whole month; null (never NaN/0/∞) when denominator or sample set is empty; `lowTrust = rejectedRows > 5% of rawDataRows`.

## Steps

1. Write shared contracts (`ingestion.ts`).
2. Write the Python reference implementation of R1–R27; generate golden summaries for all five datasets (per-service D/N/availability/coverage/avg/p95, months, report counts); store output in `/tmp/opencode/golden.json` for test authoring.
3. Implement `csv.ts`, `normalize.ts`, `pipeline.ts`, `metrics.ts`, `index.ts`.
4. Unit tests per rule branch and edge case (incl. p95 boundaries, availability 99.9 exact boundary, header variants, quoted CSV, ties, null-latency ties, 1xx/6xx rejection, empty/header-only/malformed outcomes).
5. Shuffle tests: same rows in several orders → identical canonical records/metrics/reports modulo source-row audit fields.
6. `datasets.test.ts` with golden numbers + incident-window failure-cluster assertions (incident log used for validation only).
7. Add ESLint to ingestion (flat config, typescript-eslint), wire `lint` script.
8. README implementation-notes section (contract, count definitions, p95 convention, focused test commands); WO-1 rules untouched.
9. Full clean-checkout verification; review phase; handoff.

## Testing

- `npm test` (root) — all suites incl. 5-dataset integration; keep total fast (<30s target; datasets read via fs from `docs/`, no copies).
- Focused: `npm test --workspace packages/ingestion`; single file: `npx vitest run src/metrics.test.ts` (documented in README).
- `npm run lint` now lints web + ingestion; `npm run type-check` all four workspaces; `npm run build` unaffected; `npm ci` from clean state.
- Golden cross-check: TS output must equal Python reference numbers exactly (D, N, availabilityPercent, coverage, avg/p95 latency, dupes, invalid, rejections, intervals, month partial flags). Any mismatch = stop and reconcile implementation vs rules, not the test.
