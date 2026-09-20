import { chmodSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { processMonitoringCsv } from "@sla-monitoring/ingestion";
import type { IngestionSuccess, UploadSummary } from "@sla-monitoring/shared";

/**
 * Local end-to-end: wrangler dev serving the real Worker, backed by the
 * TEST_DATABASE_URL Neon (or local Postgres) database. Sends the supplied
 * 9-day and 12-day CSVs through the HTTP endpoint and compares the returned
 * summaries and persisted counts with direct processMonitoringCsv results.
 *
 * Run from apps/worker:
 *   TEST_DATABASE_URL=postgres://... npx vitest run --config vitest.e2e.config.ts
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const PORT = 8790;
const BASE = `http://127.0.0.1:${PORT}`;

const here = dirname(fileURLToPath(import.meta.url));
const workerDir = resolve(here, "..");
const docsDir = resolve(workerDir, "../../docs");
const devVarsPath = resolve(workerDir, ".dev.vars");

describe.skipIf(!TEST_DB)("end-to-end through wrangler dev", () => {
  let wrangler: ReturnType<typeof spawn>;
  const createdIds: string[] = [];
  let previousDevVars: string | null = null;
  let previousDevVarsMode: number | null = null;

  const restoreDevVars = () => {
    if (previousDevVars === null) {
      rmSync(devVarsPath, { force: true });
      return;
    }
    writeFileSync(devVarsPath, previousDevVars);
    if (previousDevVarsMode !== null) chmodSync(devVarsPath, previousDevVarsMode);
  };

  beforeAll(async () => {
    previousDevVars = existsSync(devVarsPath) ? readFileSync(devVarsPath, "utf8") : null;
    previousDevVarsMode = existsSync(devVarsPath) ? statSync(devVarsPath).mode & 0o777 : null;
    try {
      writeFileSync(
        devVarsPath,
        `DATABASE_URL=${TEST_DB}\nALLOWED_ORIGIN=http://localhost:3000\n`,
      );
      wrangler = spawn("npx", ["wrangler", "dev", "--port", String(PORT)], {
        cwd: workerDir,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const log = (chunk: Buffer) => process.stderr.write(`[wrangler] ${chunk}`);
      wrangler.stdout?.on("data", log);
      wrangler.stderr?.on("data", log);

      // Wait for readiness.
      const deadline = Date.now() + 60_000;
      for (;;) {
        try {
          const res = await fetch(`${BASE}/health`);
          if (res.status === 200) break;
        } catch {
          /* not up yet */
        }
        if (Date.now() > deadline) throw new Error("wrangler dev did not become ready");
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (error) {
      wrangler?.kill("SIGTERM");
      restoreDevVars();
      throw error;
    }
  }, 90_000);

  afterAll(async () => {
    // Clean up only the exact uploads recorded by this run. Broad filename/time
    // predicates can delete benchmark or developer data created concurrently.
    if (TEST_DB && createdIds.length > 0) {
      const { neon } = await import("@neondatabase/serverless");
      const sql = neon(TEST_DB);
      for (const id of createdIds) await sql`DELETE FROM uploads WHERE id = ${id}`;
    }
    wrangler?.kill("SIGTERM");
    restoreDevVars();
  });

  const datasets = ["monitoring_checks_9d_seed101.csv", "monitoring_checks_12d_seed505.csv"];

  it.each(datasets)("%s: upload, retrieve, and match direct processing", async (file) => {
    // A trailing blank record is semantically ignored but gives each E2E run a
    // fresh content hash instead of colliding with manual/deployed benchmarks.
    const bytes = Buffer.concat([readFileSync(resolve(docsDir, file)), Buffer.from(`\n\n`)]);
    const runFileName = `e2e-${Date.now()}-${file}`;
    const direct = processMonitoringCsv(bytes, { fileName: runFileName }) as IngestionSuccess;
    expect(direct.ok).toBe(true);

    const form = new FormData();
    form.append("file", new File([bytes], runFileName, { type: "text/csv" }));
    const res = await fetch(`${BASE}/uploads`, {
      method: "POST",
      body: form,
      headers: { Origin: "http://localhost:3000" },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { created: boolean; upload: UploadSummary };
    expect(body.created).toBe(true);
    createdIds.push(body.upload.id);

    expect(body.upload.status).toBe("completed");
    expect(body.upload.report.reconciledIntervals).toBe(direct.report.reconciledIntervals);
    expect(body.upload.report.rejectedRows).toBe(direct.report.rejectedRows);
    expect(body.upload.report.duplicateRemovals).toBe(direct.report.duplicateRemovals);
    expect(body.upload.report.invalidObservations).toBe(direct.report.invalidObservations);
    expect(body.upload.overall?.validChecks).toBe(direct.overall.validChecks);
    expect(body.upload.overall?.availabilityPercent).toBe(direct.overall.availabilityPercent);
    expect(body.upload.services?.length).toBe(direct.services.length);

    // Retrieval returns the persisted summary without reprocessing.
    const fetched = await fetch(`${BASE}/uploads/${body.upload.id}`);
    expect(fetched.status).toBe(200);
    const fetchedBody = (await fetched.json()) as { upload: UploadSummary };
    expect(fetchedBody.upload.id).toBe(body.upload.id);
    expect(fetchedBody.upload.overall?.validChecks).toBe(direct.overall.validChecks);
    expect(fetchedBody.upload.report?.duplicateRemovedRowNumbers).toEqual(
      direct.report.duplicateRemovedRowNumbers,
    );

    // Idempotent replay: identical bytes -> 200, created=false.
    const replayForm = new FormData();
    replayForm.append("file", new File([bytes], runFileName, { type: "text/csv" }));
    const replay = await fetch(`${BASE}/uploads`, { method: "POST", body: replayForm });
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as { created: boolean; upload: UploadSummary };
    expect(replayBody.created).toBe(false);
    expect(replayBody.upload.id).toBe(body.upload.id);
  });

  it("unknown upload id returns 404", async () => {
    const res = await fetch(`${BASE}/uploads/00000000-0000-4000-8000-000000000000`);
    expect(res.status).toBe(404);
  });
});
