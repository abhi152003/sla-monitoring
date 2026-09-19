<!--lint disable strong-marker-->

# Review Log: WO-1

**Work Order:** WO-1 — Define monitoring data cleaning and SLA calculation rules
**Initialized At (UTC):** 2026-09-19T19:02:41Z

This file records review and verification rounds. Append new rounds; do not overwrite prior rounds.

---

## Round 1

_Delegate: general subagent (fresh context). Scope: README.md (deliverable) + implementation-plan.md; verified claims against docs/*.csv with read-only python3 profiling._

### Requirements Alignment

**Blocking:**

- R3 "observed vocabulary" claimed `svc-notify`/notify-api; data says `svc-notify`/`notify-worker` (14,140 rows, zero `notify-api` occurrences).

**Advisory:**

- §9 row 1 "~1.5% offset/epoch" understates combined share (~2.2%).

### Blueprint Alignment

**Blocking:**

- R16–R18 vs R15/R19: the single observed status disagreement is a 999-vs-200 pair; literal "worst-case wins" let a monitor-side sentinel convert a real 200 into a failure — contradicting R15's rationale. Ordering not specified.

**Advisory:**

### Architecture And Conventions

**Blocking:**

**Advisory:**

- R11 caveat direction backwards: rejecting a success lowers availability ((N−1)/(D−1) < N/D), not raises.
- R10 "Empty/non-numeric-with-empty latency" garbled; non-empty non-numeric latency undefined. R11 "rejected per R4-class handling" loose — not self-contained for test traceability.
- R5% threshold (R25) had no recorded rationale (fold into §10).

### Tests And Build

**Commands run:** read-only python3 profiling of all 5 CSVs by the delegate; verified 44,652 rows, dupes 7/10/10/18/25, multi-obs intervals 345/460/539/806/1152, one 999 and one negative latency per file, epoch all 10-digit, offsets only +05:30, 0 off-grid, 0 gaps, incident windows = 5xx clusters, R22 arithmetic.

**Blocking:**

**Advisory:**

### User-Facing Verification

**Skipped:** yes — documentation-only WO; no user-visible behavior to exercise.

**Evidence:** delegate's independent verification runs above.

**Blocking:**

**Advisory:**

- R27 "~3s spikes" only true for high-baseline services (svc-notify peaks at 527 ms); suggest "~4–5× baseline".

### Security, Privacy, And Data Safety

**Skipped:** yes — no code, no secrets, no PII processing in this WO.

**Blocking:**

**Advisory:**

### Round 1 Verdict

- Total blocking: 2
- Total advisory: 5
- Files reviewed: README.md, .sw-factory/WO-1/implementation-plan.md
- **Verdict:** CHANGES_REQUESTED

---

## Round 2

_Delegate: fresh general subagent. Scope: verify all 7 round-1 fixes + sweep for new inconsistencies introduced by the edits._

### Requirements Alignment

**Blocking:**

**Advisory:**

- (informational, no severity) R27 "~4–5×" holds for peak-in-window vs baseline (3.8–4.7×); window-mean ratios run 3.2–4.1×. Wording defensible as-is.

### Blueprint Alignment

**Blocking:**

**Advisory:**

### Architecture And Conventions

**Blocking:**

**Advisory:**

### Tests And Build

**Commands run:** delegate re-ran independent CSV checks (grep for notify-worker; 999-vs-200 pair isolation in 14d file; all §9 magnitudes; rule cross-reference resolution R4/R7/R8/R10/R11/R12/R13/R14/R16–R19/R25/R26).

**Blocking:**

**Advisory:**

### User-Facing Verification

**Skipped:** yes — documentation-only WO.

**Evidence:** all 7 findings verified fixed with per-item evidence; cross-reference sweep clean; no new issues.

**Blocking:**

**Advisory:**

### Security, Privacy, And Data Safety

**Skipped:** yes — no code, no secrets, no PII.

**Blocking:**

**Advisory:**

### Round 2 Verdict

- Total blocking: 0
- Total advisory: 0 (1 informational note)
- Files reviewed: README.md
- **Verdict:** APPROVED

---

## Round 3

_External review: user verified WO-1 in the factory UI post-handoff. Verdict: "Minor changes required." Scope: README.md._

### Requirements Alignment

**Blocking:**

**Advisory:**

1. R1 self-contradiction: "exactly" 8 columns vs "extra columns are ignored".
2. R2 row-order dependence: first-observed service_id/name pair authoritative — a bad first row could reject valid later rows.
3. R18 missing tie-breaker: several observations can share worst status; unspecified which supplies agent/region.

### Blueprint Alignment

**Blocking:**

**Advisory:**

### Architecture And Conventions

**Blocking:**

**Advisory:**

### Tests And Build

**Commands run:** none (documentation edits).

**Blocking:**

**Advisory:**

### User-Facing Verification

**Skipped:** yes — documentation-only.

**Evidence:** fixes below.

**Blocking:**

**Advisory:**

### Security, Privacy, And Data Safety

**Skipped:** yes — no code, no secrets, no PII.

**Blocking:**

**Advisory:**

### Resolution

- Finding 1 → R1 rewritten: all eight required columns must be present; extra columns allowed and ignored.
- Finding 2 → R2 rewritten: majority `(service_id, service_name)` mapping per service_id is authoritative (order-independent); minority rows rejected with `inconsistent_service_name`; exact tie rejects all rows for that service_id.
- Finding 3 → R18 rewritten: worst-status → highest-latency → lexicographically smallest agent identifier.
- Added A8 recording the determinism/no-row-order-dependence principle.

### Round 3 Verdict

- Total blocking: 0
- Total advisory: 3 (all resolved)
- Files reviewed: README.md
- **Verdict:** RESOLVED — fixes applied; ready for re-verification

---
