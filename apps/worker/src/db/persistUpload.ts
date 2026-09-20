import type { NeonQueryPromise } from "@neondatabase/serverless";
import { db } from "./client";
import type { CheckRecord, IngestionSuccess, InvalidObservation, RejectedRecord } from "@sla-monitoring/shared";

const CHECKS_PER_STATEMENT = 400; // 400 rows x 12 params, well under protocol limits
const EVIDENCE_PER_STATEMENT = 250;

type Query = NeonQueryPromise<false, false>;

export type PriorAttempt =
  | { kind: "none" }
  | { kind: "completed"; id: string }
  | { kind: "processing"; id: string; stale: boolean }
  | { kind: "failed"; id: string };

/** A processing row older than this is provably dead: children are only
 *  written in the same atomic transaction as completion, so a killed Worker
 *  can only leave an empty processing row behind. */
export const STALE_PROCESSING_MS = 5 * 60 * 1000;

export interface CreateUploadInput {
  contentHash: string;
  fileName: string;
  byteSize: number;
}

/** Look up a prior attempt by content hash (the idempotency identity). */
export async function findPriorAttempt(contentHash: string): Promise<PriorAttempt> {
  const rows = await db()`
    SELECT id, status, created_at FROM uploads WHERE content_hash = ${contentHash} LIMIT 1
  `;
  if (rows.length === 0) return { kind: "none" };
  const row: unknown = rows[0];
  if (!isPriorAttemptRow(row)) throw new Error("Invalid persisted upload attempt row");
  if (row.status === "processing") {
    const age = Date.now() - new Date(row.created_at).getTime();
    return { kind: "processing", id: row.id, stale: age > STALE_PROCESSING_MS };
  }
  if (row.status !== "completed" && row.status !== "failed") return { kind: "none" };
  return { kind: row.status, id: row.id };
}

/** Delete a prior failed or stale-processing attempt (cascade) so the content can be retried. */
export async function deleteDeadAttempt(id: string, status: "failed" | "processing"): Promise<void> {
  await db()`DELETE FROM uploads WHERE id = ${id} AND status = ${status}`;
}

/** Delete a prior failed attempt and its children (cascade). */
export async function deleteFailedAttempt(id: string): Promise<void> {
  await deleteDeadAttempt(id, "failed");
}

/**
 * Atomically claim a content hash by inserting its processing row.
 * `null` means another request already owns the hash; callers must re-read the
 * existing attempt and return the documented replay/conflict response.
 */
export async function createProcessingUpload(input: CreateUploadInput): Promise<string | null> {
  const rows = await db()`
    INSERT INTO uploads (content_hash, file_name, byte_size, status)
    VALUES (${input.contentHash}, ${input.fileName}, ${input.byteSize}, 'processing')
    ON CONFLICT (content_hash) DO NOTHING
    RETURNING id
  `;
  const row: unknown = rows[0];
  return isRecord(row) && typeof row.id === "string" ? row.id : null;
}

/** Mark an upload failed with a safe summary; safe to call on any error path. */
export async function markUploadFailed(
  uploadId: string,
  code: string,
  message: string,
): Promise<void> {
  await db()`
    UPDATE uploads
    SET status = 'failed', failure_code = ${code}, failure_message = ${message},
        completed_at = now()
    WHERE id = ${uploadId} AND status = 'processing'
  `;
}

/**
 * Persist the complete ingestion result atomically: reconciled checks,
 * rejected rows, and invalid observations as bounded bulk statements, plus
 * the completed-state update — one transaction, so partial child data can
 * never survive a failure.
 */
export async function persistCompletedUpload(
  input: CreateUploadInput & { uploadId: string; result: IngestionSuccess },
): Promise<void> {
  const { uploadId, result } = input;
  const r = result.report;

  const statements: Query[] = [
    ...checkStatements(uploadId, result.records),
    ...evidenceStatements("rejected_rows", uploadId, result.rejected),
    ...evidenceStatements("invalid_observations", uploadId, result.invalidObservations),
    db()`
      UPDATE uploads SET
        status = 'completed',
        raw_rows = ${r.rawRows},
        valid_observations = ${r.validObservations},
        invalid_observations = ${r.invalidObservations},
        rejected_rows = ${r.rejectedRows},
        duplicate_removals = ${r.duplicateRemovals},
        reconciled_intervals = ${r.reconciledIntervals},
        low_trust = ${r.lowTrust},
        date_range_start = ${r.dateRange.start ? new Date(r.dateRange.start) : null},
        date_range_end = ${r.dateRange.end ? new Date(r.dateRange.end) : null},
        report = ${JSON.stringify(r)}::jsonb,
        overall_metrics = ${JSON.stringify(result.overall)}::jsonb,
        services_metrics = ${JSON.stringify(result.services)}::jsonb,
        months_metrics = ${JSON.stringify(result.months)}::jsonb,
        completed_at = now()
      WHERE id = ${uploadId} AND status = 'processing'
    `,
  ];

  await db().transaction(statements);
}

/** Persisted upload row shape returned by getUploadRow. */
export interface UploadDbRow {
  id: string;
  status: string;
  file_name: string;
  byte_size: number | string;
  content_hash: string;
  report: unknown;
  overall_metrics: unknown;
  services_metrics: unknown;
  months_metrics: unknown;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string | Date;
  completed_at: string | Date | null;
}

/** Load the persisted upload row, or null when the id is unknown. */
export async function getUploadRow(id: string): Promise<UploadDbRow | null> {
  const rows = await db()`
    SELECT id, status, file_name, byte_size, content_hash, report, overall_metrics,
           services_metrics, months_metrics, failure_code, failure_message,
           created_at, completed_at
    FROM uploads WHERE id = ${id} LIMIT 1
  `;
  if (rows.length === 0) return null;
  const row: unknown = rows[0];
  if (!isUploadDbRow(row)) throw new Error("Invalid persisted upload row");
  return row;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDateValue(value: unknown): value is string | Date {
  return (
    (typeof value === "string" && !Number.isNaN(Date.parse(value))) ||
    (value instanceof Date && !Number.isNaN(value.getTime()))
  );
}

function isPriorAttemptRow(value: unknown): value is {
  id: string;
  status: string;
  created_at: string | Date;
} {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.status === "string" &&
    isDateValue(value.created_at)
  );
}

function isUploadDbRow(value: unknown): value is UploadDbRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.status === "string" &&
    typeof value.file_name === "string" &&
    (typeof value.byte_size === "number" || typeof value.byte_size === "string") &&
    typeof value.content_hash === "string" &&
    "report" in value &&
    "overall_metrics" in value &&
    "services_metrics" in value &&
    "months_metrics" in value &&
    (value.failure_code === null || typeof value.failure_code === "string") &&
    (value.failure_message === null || typeof value.failure_message === "string") &&
    isDateValue(value.created_at) &&
    (value.completed_at === null || isDateValue(value.completed_at))
  );
}

function checkStatements(uploadId: string, records: CheckRecord[]): Query[] {
  const sql = db();
  const statements: Query[] = [];
  for (let start = 0; start < records.length; start += CHECKS_PER_STATEMENT) {
    const chunk = records.slice(start, start + CHECKS_PER_STATEMENT);
    const params: unknown[] = [];
    const tuples = chunk.map((rec) => {
      params.push(
        uploadId,
        rec.serviceId,
        rec.serviceName,
        rec.timestamp,
        rec.statusCode,
        rec.status,
        rec.latencyMs,
        rec.agent,
        rec.region,
        rec.observationCount,
        rec.sourceRowNumber,
        JSON.stringify(rec.observations),
      );
      return "(" + placeholders(params.length, 12) + ")";
    });
    const text =
      "INSERT INTO reconciled_checks (upload_id, service_id, service_name, check_timestamp, " +
      "status_code, status, latency_ms, agent, region, observation_count, source_row_number, observations) VALUES " +
      tuples.join(", ");
    statements.push(sql.query(text, params));
  }
  return statements;
}

function evidenceStatements(
  table: "rejected_rows" | "invalid_observations",
  uploadId: string,
  rows: RejectedRecord[] | InvalidObservation[],
): Query[] {
  const sql = db();
  const statements: Query[] = [];
  for (let start = 0; start < rows.length; start += EVIDENCE_PER_STATEMENT) {
    const chunk = rows.slice(start, start + EVIDENCE_PER_STATEMENT);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      params.push(uploadId, row.rowNumber, row.reason, JSON.stringify(row.values));
      return "(" + placeholders(params.length, 4) + ")";
    });
    const text = `INSERT INTO ${table} (upload_id, row_number, reason, row_values) VALUES ` + tuples.join(", ");
    statements.push(sql.query(text, params));
  }
  return statements;
}

function placeholders(end: number, width: number): string {
  const parts: string[] = [];
  for (let p = end - width + 1; p <= end; p++) parts.push(`$${p}`);
  return parts.join(", ");
}
