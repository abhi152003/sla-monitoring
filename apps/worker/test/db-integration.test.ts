import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { processMonitoringCsv } from "@sla-monitoring/ingestion";
import type { IngestionSuccess } from "@sla-monitoring/shared";
import { setEnv } from "../src/env";

/**
 * Database integration tests over the Neon HTTP driver. Gated on
 * TEST_DATABASE_URL (a disposable or dedicated test database). Run:
 *   TEST_DATABASE_URL=postgres://... npm test --workspace apps/worker
 *
 * The schema is owned by Prisma Migrate (database/schema.prisma); the
 * runtime uses raw parameterized SQL.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../database/migrations");

describe.skipIf(!TEST_DB)("database integration", () => {
  const runTag = Math.random().toString(36).slice(2, 10);
  const contentHash = `test-hash-${runTag}`;
  const fileName = `integration-${runTag}.csv`;
  const createdIds = new Set<string>();

  const TINY_CSV =
    "service_id,service_name,timestamp,status_code,latency,latency_unit,agent,region\n" +
    "svc-a,a-api,2025-04-10T00:00:00Z,200,120,ms,agent-1,ap-south-1\n" +
    "svc-a,a-api,2025-04-10T00:15:00Z,999,116,ms,agent-1,ap-south-1\n" +
    "svc-a,a-api,2025-04-10T00:30:00Z,200,-5,ms,agent-1,ap-south-1\n" +
    "svc-a,a-api,2025-04-10T00:45:00Z,503,800,ms,agent-1,ap-south-1\n" +
    "svc-a,a-api,2025-04-10T00:45:00Z,200,300,ms,agent-2,ap-south-1\n";

  beforeAll(async () => {
    setEnv({ DATABASE_URL: TEST_DB!, ALLOWED_ORIGIN: "http://localhost:3000" });
  });

  afterAll(async () => {
    const { db } = await import("../src/db/client");
    for (const id of createdIds) await db()`DELETE FROM uploads WHERE id = ${id}`;
  });

  it("schema has all tables, uniqueness, and cascade FKs", async () => {
    const { db } = await import("../src/db/client");
    const tables = (await db()`
      SELECT table_name::text AS name FROM information_schema.tables WHERE table_schema = 'public'
    `) as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    for (const expected of [
      "uploads",
      "reconciled_checks",
      "rejected_rows",
      "invalid_observations",
      "_prisma_migrations",
    ]) {
      expect(names).toContain(expected);
    }

    const indexes = (await db()`
      SELECT indexname::text AS name FROM pg_indexes
      WHERE schemaname = 'public' AND tablename IN ('uploads', 'reconciled_checks')
    `) as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("uploads_content_hash_key");
    expect(indexNames.some((n) => n.includes("service_id_check_timestamp"))).toBe(true);

    const fk = (await db()`
      SELECT rc.delete_rule::text AS rule
      FROM information_schema.referential_constraints rc
      JOIN information_schema.table_constraints tc
        ON rc.constraint_name = tc.constraint_name AND tc.constraint_schema = tc.constraint_schema
      WHERE tc.constraint_schema = 'public' AND tc.table_name = 'reconciled_checks'
    `) as Array<{ rule: string }>;
    expect(fk.map((r) => r.rule)).toContain("CASCADE");

    const checks = await db()`
      SELECT c.relname::text AS table_name,
             pc.conname::text AS name,
             pg_get_constraintdef(pc.oid)::text AS definition
      FROM pg_constraint pc
      JOIN pg_class c ON c.oid = pc.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE pc.contype = 'c'
        AND n.nspname = 'public'
        AND c.relname IN ('uploads', 'reconciled_checks', 'rejected_rows', 'invalid_observations')
    `;
    const checkKeys = checks.map((row) => `${String(row.table_name)}:${String(row.name)}`);
    expect(checkKeys).toEqual(
      expect.arrayContaining([
        "uploads:uploads_status_check",
        "uploads:uploads_byte_size_nonnegative_check",
        "uploads:uploads_raw_rows_nonnegative_check",
        "uploads:uploads_valid_observations_nonnegative_check",
        "uploads:uploads_invalid_observations_nonnegative_check",
        "uploads:uploads_rejected_rows_nonnegative_check",
        "uploads:uploads_duplicate_removals_nonnegative_check",
        "uploads:uploads_reconciled_intervals_nonnegative_check",
        "uploads:uploads_date_range_order_check",
        "uploads:uploads_completed_at_order_check",
        "reconciled_checks:reconciled_checks_status_check",
        "reconciled_checks:reconciled_checks_latency_nonnegative_check",
        "reconciled_checks:reconciled_checks_observation_count_positive_check",
        "reconciled_checks:reconciled_checks_source_row_number_positive_check",
        "rejected_rows:rejected_rows_row_number_positive_check",
        "invalid_observations:invalid_observations_row_number_positive_check",
      ]),
    );
  });

  it("applied migrations match the migration directories in order", async () => {
    const { db } = await import("../src/db/client");
    const applied = (await db()`
      SELECT migration_name::text AS name FROM _prisma_migrations ORDER BY migration_name
    `) as Array<{ name: string }>;
    const dirs = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(applied.map((a) => a.name)).toEqual(dirs);
  });

  it("persists a new upload atomically with children and metrics", async () => {
    const { createProcessingUpload, persistCompletedUpload, getUploadRow } = await import(
      "../src/db/persistUpload"
    );
    const result = processMonitoringCsv(TINY_CSV, { fileName }) as IngestionSuccess;
    expect(result.ok).toBe(true);

    const uploadId = await createProcessingUpload({ contentHash, fileName, byteSize: 400 });
    if (uploadId === null) throw new Error("expected a newly claimed upload");
    createdIds.add(uploadId);
    await persistCompletedUpload({ uploadId, contentHash, fileName, byteSize: 400, result });

    const { db } = await import("../src/db/client");
    const row = await getUploadRow(uploadId);
    expect(row!.status).toBe("completed");
    expect(row!.report).toEqual(result.report);
    expect((row!.report as { reconciledIntervals: number }).reconciledIntervals).toBe(
      result.report.reconciledIntervals,
    );
    expect((row!.report as { duplicateRemovedRowNumbers: number[] }).duplicateRemovedRowNumbers).toEqual(
      result.report.duplicateRemovedRowNumbers,
    );

    const checks = (await db()`
      SELECT * FROM reconciled_checks WHERE upload_id = ${uploadId} ORDER BY check_timestamp
    `) as Array<Record<string, unknown>>;
    expect(checks).toHaveLength(result.records.length);
    const at = (c: Record<string, unknown>) => (c.check_timestamp as Date).toISOString();
    const worst = checks.find((c) => at(c).includes("T00:45:00")) as unknown as {
      status: string;
      status_code: number;
      latency_ms: string;
      observation_count: number;
      observations: unknown[];
    };
    expect(worst.status).toBe("failure");
    expect(worst.status_code).toBe(503);
    expect(Number(worst.latency_ms)).toBe(800);
    expect(worst.observation_count).toBe(2);
    expect(worst.observations).toHaveLength(2);

    const rejected = (await db()`
      SELECT * FROM rejected_rows WHERE upload_id = ${uploadId}
    `) as Array<{ reason: string; row_values: Record<string, string> }>;
    expect(rejected).toHaveLength(result.rejected.length);
    expect(rejected[0].reason).toBe("invalid_latency");
    expect(rejected[0].row_values.service_id).toBe("svc-a");

    const invalid = (await db()`
      SELECT * FROM invalid_observations WHERE upload_id = ${uploadId}
    `) as Array<{ reason: string }>;
    expect(invalid).toHaveLength(result.invalidObservations.length);
    expect(invalid[0].reason).toBe("status_999");
  });

  it("finds the completed attempt by content hash (idempotency identity)", async () => {
    const { findPriorAttempt } = await import("../src/db/persistUpload");
    const prior = await findPriorAttempt(contentHash);
    expect(prior.kind).toBe("completed");
  });

  it("failed attempts are deletable with cascading children (retry path)", async () => {
    const { createProcessingUpload, markUploadFailed, deleteFailedAttempt } = await import(
      "../src/db/persistUpload"
    );
    const { db } = await import("../src/db/client");
    const retryHash = `test-hash-${runTag}-retry`;
    const id = await createProcessingUpload({ contentHash: retryHash, fileName, byteSize: 10 });
    if (id === null) throw new Error("expected a newly claimed retry upload");
    createdIds.add(id);
    await db()`
      INSERT INTO rejected_rows (upload_id, row_number, reason, row_values)
      VALUES (${id}, 2, 'invalid_latency', '{"service_id":"svc-a"}'::jsonb)
    `;
    await markUploadFailed(id, "internal_error", "simulated");
    await deleteFailedAttempt(id);

    const rows = await db()`SELECT id FROM uploads WHERE id = ${id}`;
    expect(rows).toHaveLength(0);
    const orphans = await db()`SELECT id FROM rejected_rows WHERE upload_id = ${id}`;
    expect(orphans).toHaveLength(0);
  });

  it("stale processing attempts are taken over for retry", async () => {
    const { createProcessingUpload, findPriorAttempt } = await import("../src/db/persistUpload");
    const { db } = await import("../src/db/client");
    const staleHash = `test-hash-${runTag}-stale`;
    const id = await createProcessingUpload({ contentHash: staleHash, fileName, byteSize: 10 });
    if (id === null) throw new Error("expected a newly claimed stale upload");
    createdIds.add(id);

    const fresh = await findPriorAttempt(staleHash);
    expect(fresh.kind).toBe("processing");
    if (fresh.kind === "processing") expect(fresh.stale).toBe(false);

    await db().query(
      "UPDATE uploads SET created_at = now() - interval '10 minutes' WHERE id = $1",
      [id],
    );
    const aged = await findPriorAttempt(staleHash);
    expect(aged.kind).toBe("processing");
    if (aged.kind === "processing") expect(aged.stale).toBe(true);
  });

  it("a failed transaction leaves no partial child data", async () => {
    const { createProcessingUpload } = await import("../src/db/persistUpload");
    const { db } = await import("../src/db/client");
    const txHash = `test-hash-${runTag}-tx`;
    const id = await createProcessingUpload({ contentHash: txHash, fileName, byteSize: 10 });
    if (id === null) throw new Error("expected a newly claimed transaction upload");
    createdIds.add(id);
    await expect(
      db().transaction([
        db()`INSERT INTO rejected_rows (upload_id, row_number, reason, row_values)
             VALUES (${id}, 2, 'invalid_latency', '{}'::jsonb)`,
        db().query("INSERT INTO reconciled_checks (upload_id) VALUES ($1)", [id]),
      ]),
    ).rejects.toThrow();

    const children = await db()`SELECT id FROM rejected_rows WHERE upload_id = ${id}`;
    expect(children).toHaveLength(0);
    await db()`DELETE FROM uploads WHERE id = ${id}`;
  });

  it("GET row round-trips into the summary contract", async () => {
    const { getUploadRow, findPriorAttempt } = await import("../src/db/persistUpload");
    const { summaryFromRow } = await import("../src/db/mapRow");
    const prior = await findPriorAttempt(contentHash);
    if (prior.kind !== "completed") throw new Error("expected completed");
    const row = await getUploadRow(prior.id);
    const summary = summaryFromRow(row!);
    expect(summary.status).toBe("completed");
    expect(summary.source.contentHash).toBe(contentHash);
    expect(summary.overall).toBeTruthy();
    expect(summary.services).toBeTruthy();
    expect(summary.months).toBeTruthy();
    expect(summary.completedAt).toBeTruthy();
  });
});
