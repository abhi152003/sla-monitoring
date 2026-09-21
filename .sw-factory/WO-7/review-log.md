<!--lint disable strong-marker-->

# Review Log: WO-7

**Work Order:** WO-7 — Build and deploy the SLA monitoring dashboard
**Initialized At (UTC):** 2026-09-21T16:35:00Z

This file records review and verification rounds. Append new rounds; do not overwrite prior rounds.

---

## Round 1

### Requirements Alignment

**Blocking:**

None.

**Advisory (independent review subagent, cold review of commits `ad7d882` + `093ead4`; resolutions this round):**

1. `ApiClientError.notConfigured()` was unreachable — `resolveBaseUrl()` threw inside the `try` whose catch mapped every throw to `network_error`, so a missing `NEXT_PUBLIC_WORKER_URL` produced the misleading "Unable to reach the monitoring service" message. **Fixed:** `requestJson` and `fetchHealth` rethrow `ApiClientError` instances uncaught (`apps/web/src/lib/api/client.ts`).
2. The logs-table header announced "Loading records…" in the error state too. **Fixed:** it renders "Records unavailable" when a checks fetch has failed without data (`apps/web/src/components/dashboard/LogsTable.tsx`).
3. Statistics copy contradicted the whole-dataset scope: headings read "Overall (selected range)" / "Per service (selected range)" and the empty state referenced "current filters", while `/stats` is called with no filter params. **Fixed:** headings are "Overall" / "Per service"; the empty state reads "No services found in this dataset." (`apps/web/src/components/dashboard/StatisticsSection.tsx`).
4. `fetchHealth` accepted any body with a string `status` field before checking `response.ok`. **Fixed:** the parsed body is accepted only when `status` is `"ok"` or `"degraded"`; anything else falls through to the standard error mapping (`apps/web/src/lib/api/client.ts`).
5. TanStack Query `retry: 1` retried definitive 4xx API errors once. **Fixed:** the retry predicate returns false for non-retryable `ApiClientError`s (`apps/web/src/components/providers.tsx`).
6. `requireObject` casts for the stats/checks responses perform no per-field validation. **Accepted as-is:** the wire contract lives in the same monorepo (`@sla-monitoring/shared`) and is covered by the server-side suites; per-response runtime validation would add bulk without protecting a real failure mode.

### Blueprint Alignment

**Blocking:** None. WO-7 has no connected blueprints.

**Advisory:** None.

### Verification Evidence

- Static analysis (repo root, after the review fixes): `npm run lint` clean, `npm run type-check` clean, `npm run build` clean (web `next build` static generation + Worker `wrangler deploy --dry-run`).
- Automated tests (repo root): 8 test files / 76 tests passed, 11 skipped (gated DB/E2E suites — no database URL supplied), ingestion suite 111/111 passed, worker suite 4/4 passed.
- Owner-performed browser verification (local `next dev` against the deployed Worker): upload validation (non-CSV, >5 MiB), 201 fresh upload, 200 idempotent replay, processing summary fields, statistics incl. partial-range banner and per-service cards, logs filtering (single date / range / service / status), pagination and page-size changes, refresh returning to the empty upload state. Owner's verdict: "functionality wise everything is working correctly."
- Deployment (2026-09-21): dashboard live at <https://sla.abhip.xyz> (Vercel, owner-deployed with `NEXT_PUBLIC_WORKER_URL`); Worker redeployed as version `e4aedbb0-f728-4bb6-82e1-377f18ca0dc3` with `ALLOWED_ORIGIN=https://sla.abhip.xyz`.
- CORS verification (curl from this machine): exact-origin reflection for `https://sla.abhip.xyz` on `GET /health`; `OPTIONS` preflight for `POST /uploads` returns 204 with `Access-Control-Allow-Origin: https://sla.abhip.xyz`, `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type`; a foreign origin receives no CORS grant (`Vary: Origin`, no ACAO header).
- Owner-performed production verification (<https://sla.abhip.xyz>): healthy service header, dataset upload processed, idempotent replay, filters and pagination, refresh clears the session. Owner's verdict: "Everything is working correctly on production."
- Reviewer-verified correct (no action needed): server-authoritative pagination with the `MAX_CHECKS_PAGE_SIZE` clamp applied on both layers; `date` XOR `from`+`to` exclusivity holds client- and server-side; `keepDataForSameUpload` placeholder cannot carry data across datasets; upload invalidation covers idempotent replays; null metrics never render as zero; no XSS sinks; no persistence, no Next API routes/server actions, no direct DB access, no re-declared wire types, no duplicated SLA math; the Worker CORS change matches the deployed dashboard origin (local dev unaffected via `.dev.vars`); the README coverage table is internally consistent (44,652 row sum, 27/31 May days, per-file spans match names).

### Verdict

**APPROVED** — no blocking findings. The independent cold review confirmed the dashboard is a contract-faithful, Worker-only client. All six advisory findings were fixed this round or accepted with recorded rationale; the owner verified the full flow locally and in production.

---

## Round 2

### Requirements Alignment

**Blocking (owner review of commit `c77eda6`):**

1. Statistics retained a collapsed local state across uploads — a newly uploaded dataset did not re-expand the section. **Fixed:** `StatisticsSection` is keyed by upload id in `apps/web/src/app/page.tsx`, so a new dataset remounts the section expanded (the same keyed-remount pattern `LogsFilters` already uses).
2. The statistics and logs error panels had no live region, so screen readers were not notified when those asynchronous requests failed. **Fixed:** both panels carry `role="alert"` (`StatisticsSection.tsx`, `LogsTable.tsx`).

**Advisory:** None.

### Blueprint Alignment

**Blocking:** None. WO-7 has no connected blueprints.

### Verification Evidence

- Static analysis after the fixes: `npm run lint` clean, `npm run type-check` clean, `npm run build` clean.
- The logs error-label fix from Round 1 was confirmed working by the owner's review of `c77eda6`.

### Verdict

**APPROVED** — both owner-review findings are fixed; no open items from either round.
