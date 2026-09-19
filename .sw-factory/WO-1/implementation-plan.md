# WO-1 Implementation Plan: Define monitoring data cleaning and SLA calculation rules

## Summary

Deliver the authoritative data-cleaning and SLA-calculation policy as `README.md` at the repository root. The document converts the WO-1 scope items into concrete, testable rules grounded in the actual contents of the five `docs/monitoring_checks_*.csv` datasets (profiled 2026-09-19: 44,652 rows). No implementation code — this document is the contract that ingestion, persistence, dashboard, tests, and the eventual README sections will obey.

## Code Reuse And Package Structure

No code yet; repository contains only `docs/` (problem statement, 5 CSVs, incident log). This WO creates:

- `README.md` (root) — the rules document (user-directed location)
- `.sw-factory/WO-1/*` — execution artifacts

## Components And Flow

Document sections, each mapping to a WO-1 in-scope bullet:

1. **Accepted schema & values** — 8 required columns; known services/agents/regions; status-code classification; latency units.
2. **Timestamp normalization** — the 3 observed forms (ISO-8601 `Z`, ISO-8601 `+05:30` offset, 10-digit epoch-seconds) → UTC `YYYY-MM-DDTHH:mm:00Z`; 15-minute grid validation.
3. **Latency normalization** — `s` (svc-search only) and `ms` → milliseconds; missing latency; negative latency (observed: exactly 1 per file, always status 200).
4. **Duplicate handling** — exact-row duplicates (6–25/file) and multi-agent interval overlap (agent-1/agent-2 double-reporting, 352–1,173 intervals/file).
5. **Record classification** — accept / reject rules for 200, 500, 502, 503, 999, malformed rows (none observed, rule still defined).
6. **Multi-agent reconciliation** — one verdict per (service, interval); precedence rule; observed status-conflict count = 1 (14d file).
7. **SLA calculation** — numerator/denominator definitions, 99.9% comparison, credit-trigger language, monthly-boundary handling.
8. **Metrics integrity** — effect of rejected records, missing checks (none observed after normalization), partial date ranges, incident-window cross-check.
9. **Assumptions & data findings** — every discovered data-quality issue + the decision taken.

## Steps

1. Write `README.md` with sections above, each rule numbered (R1, R2, …) for traceability.
2. Cross-reference observed evidence (counts from the profiling runs) in a data-findings table.
3. Self-verify: every WO-1 in-scope bullet maps to at least one numbered rule; no out-of-scope content (no parser/Worker/DB/dashboard design).

## Testing

Documentation-only WO. Verification:

- Manual audit: map each WO-1 in-scope bullet → README section (recorded in `review-log.md`).
- Evidence audit: every rule is either grounded in observed data (cite counts) or flagged as an assumption.
- Reproducibility spot-check: re-run key profiling counts for one dataset to confirm the numbers cited.
