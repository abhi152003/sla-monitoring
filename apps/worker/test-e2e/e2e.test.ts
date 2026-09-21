import { chmodSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { processMonitoringCsv } from "@sla-monitoring/ingestion";
import type {
  IngestionSuccess,
  UploadChecksResponse,
  UploadStatsResponse,
  UploadSummary,
} from "@sla-monitoring/shared";

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

    const stats = await fetch(`${BASE}/uploads/${body.upload.id}/stats`);
    expect(stats.status).toBe(200);
    const statsBody = (await stats.json()) as UploadStatsResponse;
    expect(statsBody.overall.validChecks).toBe(direct.overall.validChecks);
    expect(statsBody.overall.successfulChecks).toBe(direct.overall.successfulChecks);
    expect(statsBody.overall.availabilityPercent).toBe(direct.overall.availabilityPercent);
    expect(statsBody.overall.p95LatencyMs).toBe(direct.overall.p95LatencyMs);
    expect(statsBody.partial).toBe(true);

    const checks = await fetch(`${BASE}/uploads/${body.upload.id}/checks?page=1&pageSize=10`);
    expect(checks.status).toBe(200);
    const checksBody = (await checks.json()) as UploadChecksResponse;
    expect(checksBody.pagination.totalRecords).toBe(direct.records.length);
    expect(checksBody.checks).toHaveLength(10);
    expect(checksBody.checks[0]?.timestamp >= checksBody.checks[1]?.timestamp).toBe(true);

    const checksPage2 = await fetch(`${BASE}/uploads/${body.upload.id}/checks?page=2&pageSize=10`);
    expect(checksPage2.status).toBe(200);
    const page2Body = (await checksPage2.json()) as UploadChecksResponse;
    expect(page2Body.pagination).toMatchObject({ page: 2, hasPreviousPage: true });
    expect(page2Body.checks[0]?.id).not.toBe(checksBody.checks[0]?.id);
    // Ordering continues across the page boundary under the complete stable
    // order: timestamp descending, service ID ascending, then database ID ascending.
    const boundary = [checksBody.checks[9], page2Body.checks[0]];
    expect(boundary.every((check) => check !== undefined)).toBe(true);
    const sortedBoundary = [...boundary].sort((left, right) => {
      if (left === undefined || right === undefined) return 0;
      const timestampOrder = right.timestamp.localeCompare(left.timestamp);
      if (timestampOrder !== 0) return timestampOrder;
      const serviceOrder = left.serviceId.localeCompare(right.serviceId);
      if (serviceOrder !== 0) return serviceOrder;
      return BigInt(left.id) < BigInt(right.id) ? -1 : BigInt(left.id) > BigInt(right.id) ? 1 : 0;
    });
    expect(boundary).toEqual(sortedBoundary);

    const selectedDate = direct.records[0]?.timestamp.slice(0, 10);
    if (selectedDate === undefined) throw new Error("expected direct records");
    const ranged = await fetch(
      `${BASE}/uploads/${body.upload.id}/stats?from=${selectedDate}&to=${selectedDate}`,
    );
    expect(ranged.status).toBe(200);
    const rangedBody = (await ranged.json()) as UploadStatsResponse;
    expect(rangedBody.overall.validChecks).toBe(
      direct.records.filter((record) => record.timestamp.startsWith(selectedDate)).length,
    );
    expect(rangedBody.partial).toBe(true);

    const invalidQuery = await fetch(`${BASE}/uploads/${body.upload.id}/checks?date=2025-02-30`);
    expect(invalidQuery.status).toBe(400);

    const serviceId = direct.records[0]?.serviceId;
    if (serviceId === undefined) throw new Error("expected direct records");
    const filtered = await fetch(
      `${BASE}/uploads/${body.upload.id}/stats?serviceId=${encodeURIComponent(serviceId)}&status=failure`,
    );
    expect(filtered.status).toBe(200);
    const filteredBody = (await filtered.json()) as UploadStatsResponse;
    const directFailures = direct.records.filter(
      (record) => record.serviceId === serviceId && record.status === "failure",
    );
    expect(filteredBody.overall.validChecks).toBe(directFailures.length);
    expect(filteredBody.overall.failedChecks).toBe(directFailures.length);

    // Latency aggregates over the filtered subset must match an independent
    // nearest-rank computation over the directly ingested records.
    const samples = directFailures
      .map((record) => record.latencyMs)
      .filter((value): value is number => typeof value === "number");
    const directAvg =
      samples.length === 0
        ? null
        : Math.round((samples.reduce((a, b) => a + b, 0) / samples.length) * 100) / 100;
    const sorted = [...samples].sort((a, b) => a - b);
    const directP95 = samples.length === 0 ? null : sorted[Math.ceil(0.95 * samples.length) - 1];
    expect(filteredBody.overall.latencySamples).toBe(samples.length);
    expect(filteredBody.overall.avgLatencyMs).toBe(directAvg);
    expect(filteredBody.overall.p95LatencyMs).toBe(directP95);
    expect(filteredBody.services).toEqual([
      expect.objectContaining({ serviceId, failedChecks: directFailures.length }),
    ]);

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
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect((await fetch(`${BASE}/uploads/${unknown}`)).status).toBe(404);
    expect((await fetch(`${BASE}/uploads/${unknown}/stats`)).status).toBe(404);
    expect((await fetch(`${BASE}/uploads/${unknown}/checks`)).status).toBe(404);
  });
});
