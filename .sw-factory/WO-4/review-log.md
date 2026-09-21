<!--lint disable strong-marker-->

# Review Log: WO-4

**Work Order:** WO-4 — Build and benchmark the persistent Worker ingestion API
**Initialized At (UTC):** 2026-09-20T08:39:07Z

This file records review and verification rounds. Append new rounds; do not overwrite prior rounds.

---

## Round 1

### Requirements Alignment

**Blocking:**

- **Broad integration-test cleanup is unsafe.** The database integration cleanup uses a broad `LIKE` predicate against upload filenames, so a test run can delete unrelated rows that happen to match the pattern. Cleanup must target exact IDs created by that run (or an equally isolated test namespace).
- **Persisted report data is incomplete.** `duplicateRemovedRowNumbers` is stripped before the processing report is persisted, losing audit evidence that is present in the in-memory ingestion result and required to explain duplicate handling.

**Advisory:**

### Blueprint Alignment

**Blocking:**

**Advisory:**

### Architecture And Conventions

**Blocking:**

- **Database row decoding trusts unchecked casts.** Rows returned from Neon are cast directly to application shapes without validating required fields, lifecycle values, or JSON summaries at the database boundary. Malformed or drifted persisted data can therefore produce incorrect API responses or runtime failures.
- **The E2E harness overwrites developer state.** The local E2E setup writes `apps/worker/.dev.vars` unconditionally and leaves the replacement file behind. It must preserve/restore existing local configuration or use a temporary Wrangler vars file.

**Advisory:**

### Tests And Build

**Commands run:** Independent static review of the current WO-4 implementation, tests, migration/configuration, and review artifacts. No code or test changes were made in this review round.

**Blocking:**

- The broad cleanup predicate and `.dev.vars` overwrite make the database/E2E verification destructive outside the test's own data and non-reproducible for a developer's local environment.

**Advisory:**

### User-Facing Verification

**Skipped:** yes — this round was a static implementation and test-safety review; no new live request was issued.

**Evidence:** The five findings above are directly traceable to the current database integration cleanup, persisted-report mapping, database row decoding, E2E setup, and internal-error handling paths.

**Blocking:**

**Advisory:**

### Security, Privacy, And Data Safety

**Skipped:** no

**Blocking:**

- **Internal error handling leaks exception messages.** `internalError` logs an `Error` object's message and the error path can expose that message to logs; database/driver messages can contain connection details or other secrets. The external error contract must remain generic, and logging must sanitize/redact provider messages before emission.

**Advisory:**

### Round 1 Verdict

- Total blocking: 5 distinct findings (the cleanup issue is also called out under test-safety evidence)
- Total advisory: 0
- Files reviewed: `apps/worker/test/db-integration.test.ts`, `apps/worker/test-e2e/e2e.test.ts`, `apps/worker/src/db/mapRow.ts`, `apps/worker/src/db/persistUpload.ts`, `apps/worker/src/api/errors.ts`, `README.md`, and the WO-4 checklist/plan
- **Verdict:** CHANGES_REQUESTED

### Remediation status

The implementation team has acknowledged these findings and remediation is underway. A fresh verification round is required after the fixes land; this review does not approve Round 2 and does not certify WO-4 completion.

---

## Round 2

### Requirements Alignment

**Blocking:**

- All five Round-1 blockers are resolved: database integration cleanup is exact-ID scoped, persisted report audit evidence retains `duplicateRemovedRowNumbers`, Neon row decoding validates persisted values before mapping, E2E setup preserves local Wrangler configuration, and internal error logging/redaction no longer leaks provider or exception details.

**Advisory:**

- The dashboard UI is not part of WO-4's Worker/API scope. Its absence is future work, not a WO-4 implementation defect.

### Blueprint Alignment

**Blocking:** None. No project blueprints are linked to WO-4.

**Advisory:**

### Architecture And Conventions

**Blocking:** None from Round 1 remain after remediation.

**Advisory:**

### Tests And Build

**Commands run:** 54 Worker tests (including Neon integration coverage), Wrangler E2E 3/3, workspace lint, workspace type-check, and webpack/production build all passed.

**Blocking:**

- None identified in this round. The controlled deployed 30-day upload measured 530 ms Cloudflare CPU time. This evidence is preserved and routed to WO-5 as an operational follow-up; it is not a blocker to the completed single-request WO-4 behavior.

**Advisory:**

### User-Facing Verification

**Skipped:** no

**Evidence:** Deployed Worker health, fresh uploads for the supplied datasets, persisted retrieval, and identical replay were exercised. The latest controlled 30-day request completed successfully; its 530 ms CPU measurement is retained as the trigger for WO-5, not a functional correctness failure or WO-4 scope expansion.

**Blocking:**

**Advisory:**

### Security, Privacy, And Data Safety

**Skipped:** no

**Blocking:** None from Round 1 remain after remediation.

**Advisory:**

### Round 2 Verdict

- Total blocking: 0
- Total advisory: 1 (dashboard is outside WO-4 scope/future work)
- Files reviewed: remediation diff, Worker tests, Neon integration evidence, Wrangler E2E evidence, build/lint/type-check results, README benchmark record, and WO-4 checklist
- **Verdict:** NON-FINAL — a fresh independent review is required before approval.

### Follow-up status

The five Round-1 blockers are resolved and verified. WO-5 — Configure the server-side CSV ingestion CPU budget (`ec4ff265-9881-45a7-944e-4e700d998fe3`, In Review; child of WO-4) owns the operational follow-up for the 530 ms CPU path. This Round 2 record is non-final and does not approve WO-4; a fresh independent review must provide the final verdict.

---

## Round 3

_Delegate: fresh independent review subagent; final verdict round._

### Verification performed

- All five Round-1 remediations re-verified in the current tree (exact-ID cleanup, full report round-trip incl. duplicateRemovedRowNumbers, validated row decoding in mapRow.ts, .dev.vars backup/restore, redacted error logging).
- 405+Allow routing verified in source AND live via local wrangler dev; 16-CHECK migration verified against schema.prisma documentation and asserted in integration tests.
- apps/web build verified clean (build exit 0 with TypeScript still running inside the build; independent tsc --noEmit exit 0) — --webpack is bundler selection, not error suppression.
- README accuracy confirmed (setup, API docs, wall-clock + CPU benchmark tables incl. 530ms evidence, WO-5 routing); R1-R27 verified intact 27/27.
- Commands: root type-check/lint/test exit 0 (ingestion 111, shared 2); worker 47 passed + 8 DB-gated skips; web build exit 0; deployed /health 200 ok.
- Security: no tracked secrets; .env/.dev.vars ignored; deployed ALLOWED_ORIGIN=localhost documented as intentional.

### Findings

- Blocking: 0
- Advisory: 2 — (a) redeploy final bundle (deployed 405 lacked Allow header); (b) confirm 16-CHECK migration applied to prod Neon.
- Nits: README lacks a literal "405" mention (prose covers it); deployed ALLOWED_ORIGIN stays localhost until web deploys (documented).

### Round 3 Verdict

- Total blocking: 0
- Total advisory: 2 (both resolved post-review: `prisma migrate deploy` reports 3/3 migrations applied to prod Neon; `wrangler deploy` version f3b423a1 re-tested live — PUT /uploads now returns 405 + `Allow: POST, OPTIONS`)
- **Verdict:** APPROVED

---

<!-- Subsequent rounds: copy the structure above and increment the round number. -->
