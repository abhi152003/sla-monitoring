<!--lint disable strong-marker-->

# Work Order Entity Index: WO-5

**Initialized At (UTC):** 2026-09-20T18:08:48Z
**Current Status:** in_review

## Work Order

- WO-5: Configure the server-side CSV ingestion CPU budget (`ec4ff265-9881-45a7-944e-4e700d998fe3`)

## Requirements

## Blueprints

## Referenced Blueprints

Blueprints reached through `@…` mentions and links while reading linked blueprints.

## Delivery

- Branch: main
- Pull Request URL:
- Parent evidence: WO-4 (`1ac44e3c-9a3b-43a1-a16c-023945799992`) measured 530 ms Cloudflare CPU for a fresh 30-day upload.
- Architecture decision: the browser sends the original multipart CSV and the deployed Cloudflare Worker authoritatively hashes, parses, validates, cleans, reconciles, calculates, and atomically persists it. The Worker uses a 1,000 ms CPU ceiling. Version `16dc69e1-3fe3-419e-a324-5a64154bc11d` deployed on 2026-09-21; production `/health` returned HTTP 200 with database status `ok`.
- Production evidence: upload `3b83c504-fa54-4042-b3f4-d723fddadf2b` returned HTTP 201 in 1.771 s; provider telemetry reported `outcome: ok`, 1,077 ms wall and 331 ms CPU; persisted GET returned HTTP 200 with 15,577 raw rows and 14,398 reconciled intervals.
