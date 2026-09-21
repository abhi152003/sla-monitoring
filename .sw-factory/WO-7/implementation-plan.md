<!--lint disable no-undefined-references strong-marker-->

# Implementation Plan: WO-7

**Work Order:** WO-7 — Build and deploy the SLA monitoring dashboard
**Created At (UTC):** 2026-09-21T16:35:00Z

## Summary

Replace the `apps/web` placeholder with the complete single-screen SLA Monitoring Dashboard: a typed HTTP client layer over the deployed Worker's upload/summary/stats/checks/health APIs, a responsive and accessible operator UI (upload panel → processing summary → collapsible statistics → filterable, paginated logs), TanStack Query for server state, local browser verification against the real Worker, Vercel deployment with tightened Worker CORS, production verification with the supplied datasets, and README documentation. No Next.js API routes, server actions, direct Neon access, or duplicated backend calculations — the browser talks to the Cloudflare Worker only.

**Scope decision (2026-09-21, project owner):** a frontend unit/component test suite is deliberately out of scope — this is not production software, and the backend/API/DB behavior (parsing, metrics, pagination, reconciliation — the parts that can silently corrupt results) is already covered by the test suites in `packages/core` and `apps/worker`. **Browser verification is likewise owner-performed:** the implementer hands over run instructions and a verification matrix; the project owner exercises the dashboard in the browser (local + production) and reports results, which are recorded with evidence in `review-log.md`, satisfying the work order's "documented browser verification" clause.

**Scope decision (2026-09-21, project owner):** refresh restoration is dropped. The work order asked for the upload id to be persisted (URL or browser storage) so a refresh restores the dashboard, but with no accounts or authentication the owner judged a restored "session" misleading — refreshing now returns to the clean upload state. The `localStorage` layer, the `GET /uploads/:id` restore path, and the restore/not-found UI states were removed; the dataset lives only in page memory for the current visit. The Worker's `GET /uploads/:id` contract is unchanged (only the web client no longer calls it).

**Scope decision (2026-09-21, project owner):** filters apply to the logs table only, not the statistics. The work order specified synchronized stats+checks filtering; the owner preferred statistics as a fixed whole-dataset view. `GET /uploads/:id/stats` is now called once per dataset with no filter params (so `partial` reflects dataset month coverage alone), date/service/status filters drive only `GET /uploads/:id/checks`, and both sections' copy states this split ("Statistics — Entire dataset", "Log filters … narrow the health-check logs below only").

## Code Reuse And Package Structure

- All wire contracts, limits, and error codes come from `@sla-monitoring/shared` (`UploadSummary`, `UploadResponse`, `UploadStatsResponse`, `UploadChecksResponse`, `HealthCheckResponse`, `ApiErrorCode`, `UPLOAD_FIELD_NAME`, `MAX_UPLOAD_BYTES`, `MAX_CHECKS_PAGE_SIZE`, `DEFAULT_CHECKS_PAGE_SIZE`). Zero backend logic is copied into the web app or test fixtures.
- Design language is ported from the untracked reference prototype (`3803c3f1…/src/components/sla/*`): status badges with leading dots, metric cards with mono tabular-nums values, card sections, semantic success/warning/danger tokens, draft-then-apply filters, server-authoritative pagination. The prototype's mock api/types are NOT reused — our client consumes the real shared contracts.
- Server state uses `@tanstack/react-query` v5: `keepPreviousData` preserves content during filter refreshes, keyed queries prevent stale overwrites, and `isPending`/`isFetching`/`isError`/`refetch` give per-section loading/refreshing/error/retry semantics. Upload is an explicit one-shot action (not a cached query) with duplicate-submission guards.
- No frontend test runner is configured in `apps/web` (owner decision, see Summary). The web app is verified by static analysis (`tsc --noEmit`, ESLint) plus documented browser verification against the real Worker.

Planned `apps/web` structure:

- `src/lib/api/client.ts` — typed fetch client: `healthCheck`, `uploadDataset` (multipart `file` field, 200-replay/201-created), `getUpload`, `getStats`, `getChecks`; never leaks raw internals; decodes `{error, message}` bodies and non-JSON responses into a typed `ApiClientError`.
- `src/lib/api/errors.ts` — `ApiClientError` taxonomy (code, status, retryable) and readable user-facing messages for 400/404/409/413/422/500/network/invalid-JSON.
- `src/lib/filters.ts` — dashboard filter state (date mode single/range/none, date/from/to, serviceId, status), empty default, and strict serialization to query params (`date` XOR `from`+`to`; pagination params only on `/checks`).
- `src/lib/format.ts` — percent/latency/count/file-size/UTC formatters with a `NOT_AVAILABLE` sentinel for null metrics.
- `src/components/dashboard/*` — `DashboardHeader`, `UploadPanel`, `ProcessingSummary`, `StatisticsSection` (+ `MetricCard`, `ServiceCard`), `StatusBadge`, `LogsFilters`, `LogsTable`.
- `src/components/providers.tsx` — client `QueryClientProvider`.
- `src/app/page.tsx` — the single dashboard screen; `src/app/layout.tsx` metadata; `src/app/globals.css` Tailwind v4 semantic tokens.

## Components And Flow

1. The dashboard starts empty each visit (no persistence — owner decision above); the dataset lives in page memory only.
2. `POST /uploads` sends the original file bytes as multipart field `file`; 201 → "uploaded and processed", 200 → "identical dataset restored (idempotent replay)"; 400/409/413/422/500/network/invalid-JSON map to readable messages with retry only where meaningful. The processing summary renders from `upload.report` (raw rows, reconciled intervals, rejected rows, invalid observations, duplicates removed, missing-latency, normalized UTC range, low-trust badge).
3. Statistics (`GET /uploads/:id/stats`, no filter params — fixed whole-dataset view) and logs (`GET /uploads/:id/checks`, filtered) share one filter state; filter changes reset the logs page to 1, and pagination params are never sent to `/stats`.
4. Collapsible statistics section (expanded after upload; `aria-expanded`/`aria-controls`) shows overall metrics (valid/successful/failed checks, availability %, SLA status vs 99.9%, avg/p95 latency, latency samples), a partial-range warning banner, and per-service cards distinguishing compliant/breached/empty/unavailable; null is never rendered as zero.
5. Logs table renders timestamp (explicit UTC), service, HTTP status, result badge, latency (explicit unavailable value), agent, region, observation count, source row; server-side pagination from response metadata with page-size selector ≤ 100; controlled horizontal scroll on narrow screens.
6. Deployment: Vercel project for `apps/web` with `NEXT_PUBLIC_WORKER_URL`; Worker `ALLOWED_ORIGIN` updated to the exact Vercel origin (no wildcard) and redeployed; production verification with the 9-day and 30-day datasets.

## Steps

1. **Web tooling foundation** — add runtime dependencies and `.env.local` handling.
2. **Client and utility layer** — API client with typed error decoding, filter serialization, formatters, storage helpers.
3. **UI components** — status badge, metric/service cards, upload panel (drag-drop + picker + validation + states), processing summary, collapsible statistics, logs filters (draft-then-apply), logs table + pagination.
4. **Page assembly** — providers, dashboard state, TanStack Query wiring (keys from filter state), refresh restoration, dataset switching.
5. ~~**Component tests**~~ — removed from scope by the owner (2026-09-21): backend/API/DB tests already cover correctness-critical behavior; the web app is verified via documented browser verification instead.
6. **Local verification (owner-performed)** — hand over run instructions (`npm run dev:worker` + `npm run dev:web`) and the verification matrix; the owner exercises the dashboard locally and reports results.
7. **Clean verification** — `npm ci`, `npm run build`, `npm run lint`, `npm run type-check`, `npm test` from a clean checkout-equivalent tree.
8. **Deployment** — Vercel deploy, `NEXT_PUBLIC_WORKER_URL` config, Worker `ALLOWED_ORIGIN` update + redeploy, CORS verification; owner then repeats the verification matrix in production with both supplied datasets.
9. **Documentation** — README: live URL, architecture flow, web setup, Vercel steps, environment config, workflow, UI description, verified-live date, limitations.
10. **Review** — fresh independent review subagent, resolve all blocking/advisory findings, rerun affected tests, record evidence in `review-log.md`, clean working tree, status → In Review.

## Testing

**Automated tests (backend):** the existing suites in `packages/core` (CSV parsing, cleaning, reconciliation, SLA metrics, pagination math) and `apps/worker` (API routes, query validation, Neon persistence) remain the correctness safety net. Commands: repo-wide `npm ci`, `npm run build`, `npm run lint`, `npm run type-check`, `npm test`.

**Frontend:** no unit/component suite, by owner decision (see Summary). Correctness at the HTTP boundary and in the UI is verified by owner-performed browser verification — locally against `next dev` + `wrangler dev` with a supplied dataset, and in production on the deployed Worker + Vercel dashboard. The verification matrix covers: file validation (non-CSV, >5 MiB); upload success (201) and idempotent replay (200); readable errors for 400/409/413/422/500/network/invalid-JSON; processing summary fields; statistics incl. partial-range banner and null-never-zero states; collapse behavior; single-date vs date-range filtering (mutual exclusion); synchronized stats/checks requests and page reset on filter change; pagination controls and page-size changes; refresh clears the session back to the empty upload state; loading/empty/error/retry states; mobile and desktop widths; browser console free of errors. Results are reported by the owner and recorded in `review-log.md`.
