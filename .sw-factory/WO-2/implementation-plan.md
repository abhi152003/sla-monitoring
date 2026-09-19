# WO-2 Implementation Plan: Initialize npm workspace and application foundations

## Summary

Scaffold the monorepo: npm-workspaces root, Next.js web app (`apps/web`), Cloudflare Worker (`apps/worker`), and two private shared packages (`packages/shared`, `packages/ingestion`), plus root validation scripts, `.gitignore`, `.env.example` files, `database/migrations` placeholder, and a README setup section. No business logic — the only behavior is the Worker's `GET /health`. Verification must prove a clean-checkout `npm ci` + build/lint/type-check/test pass, and both apps run locally.

## Code Reuse And Package Structure

Greenfield — no existing code to reuse. The WO-1 README rules are the policy anchor (must remain intact; setup content is additive).

```
package.json                  private root, workspaces: apps/*, packages/*
package-lock.json             single root lockfile (no nested lockfiles)
.gitignore                    root-level
database/migrations/.gitkeep  tracked placeholder
apps/web/                     Next.js 15 (create-next-app: TS, ESLint, Tailwind, App Router, src/, @/* alias), name @sla-monitoring/web
apps/worker/                  hand-written Worker: wrangler.jsonc, src/index.ts, tsconfig, name @sla-monitoring/worker
  wrangler.jsonc, .dev.vars ignored via root .gitignore
packages/shared/              @sla-monitoring/shared — TS-source entry, typed exports (APP_NAME, HealthResponse)
packages/ingestion/           @sla-monitoring/ingestion — TS-source entry, typed placeholder (no behavior)
apps/*/.env.example           placeholder-only env templates (no secrets)
```

Packages export TS source (`main`/`types` → `src/index.ts`): both consumers (Next webpack/turbopack, Wrangler esbuild) transpile workspace-linked TS directly; no package build step, no task orchestrator (per exclusions).

## Components And Flow

- **Worker** (`apps/worker/src/index.ts`): `fetch` handler routes `GET /health` → `Response.json({ status: "ok", service: "@sla-monitoring/worker", version, timestamp })` (200); unknown routes → 404 JSON. Imports `APP_NAME` from `@sla-monitoring/shared` and includes it in the payload — the compile-time-safe workspace proof.
- **Web**: create-next-app starter page, modified only to render `APP_NAME` from `@sla-monitoring/shared` — proves workspace resolution in the web build too.
- **Root scripts**: `dev:web`, `dev:worker`, `build` (`npm run build --workspaces`; skips workspaces without a build script), `lint` (`--workspaces`), `type-check` (`typecheck` script in every workspace), `test` (`vitest run` where defined — shared/ingestion get vitest + one trivial test each so the harness is proven; workspaces without tests are skipped, satisfying the no-failure requirement).
- **Worker scripts**: `dev` (wrangler dev), `build` (wrangler deploy --dry-run --outdir=dist), `typecheck` (tsc --noEmit).
- **Web scripts**: template defaults + `typecheck` (tsc --noEmit).

## Steps

1. Root: `package.json`, `.gitignore`, `database/migrations/.gitkeep`.
2. `npx create-next-app@latest apps/web` with TS/ESLint/Tailwind/App Router/src-dir/`@/*` flags; rename to `@sla-monitoring/web`; remove any nested lockfile.
3. Hand-write `apps/worker` (package.json, tsconfig, wrangler.jsonc, src/index.ts).
4. Hand-write `packages/shared` and `packages/ingestion` (+ vitest minimal tests).
5. Root `npm install` (creates root lockfile, links workspaces); wire `@sla-monitoring/shared` imports into web page + worker payload.
6. `.env.example` files for web (API base URL placeholder) and worker (DATABASE_URL placeholder) — placeholders only.
7. README: insert Getting Started section (prerequisites, install, commands, URLs, `/health` contract) above the WO-1 policy content; policy untouched.
8. Full verification pass (below), then clean working tree.

## Testing

- `npm ci` (after wiping `node_modules` — proves clean-checkout install from lockfile).
- Root `npm run build` — web `next build` + worker dry-run deploy both pass.
- Root `npm run lint` — web ESLint passes.
- Root `npm run type-check` — tsc --noEmit in web, worker, shared, ingestion.
- Root `npm test` — vitest runs in shared + ingestion; app workspaces without test scripts skipped, exit 0.
- Live checks: `wrangler dev` (port 8787) → `curl /health` expect `200 {"status":"ok",...}`; `next dev` (port 3000) → `curl /` expect 200. Commands + observed responses recorded as review evidence (checklist + review-log).
- `git status` clean after verification; no nested lockfiles (`find . -name package-lock.json -not -path ./package-lock.json`).
