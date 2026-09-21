import type {
  ChecksPagination,
  FilteredAvailabilityMetrics,
  FilteredServiceStats,
  ReconciledCheckItem,
} from "@sla-monitoring/shared";
import type { CheckQuery } from "../api/query";
import { db } from "./client";

export class UploadNotFoundError extends Error {}
export class UploadNotCompletedError extends Error {}

interface UploadRange {
  start: Date | null;
  end: Date | null;
}

export async function requireCompletedUpload(id: string): Promise<UploadRange> {
  const rows = await db().query(
    "SELECT status, date_range_start, date_range_end FROM uploads WHERE id = $1 LIMIT 1",
    [id],
  );
  if (rows.length === 0) throw new UploadNotFoundError();
  const row: unknown = rows[0];
  if (!isRecord(row) || typeof row.status !== "string") throw new Error("Invalid upload state row");
  if (row.status !== "completed") throw new UploadNotCompletedError();
  return { start: nullableDate(row.date_range_start), end: nullableDate(row.date_range_end) };
}

export async function queryChecks(
  uploadId: string,
  query: CheckQuery,
): Promise<{ checks: ReconciledCheckItem[]; pagination: ChecksPagination }> {
  const filter = buildFilter(uploadId, query);
  const offset = (query.page - 1) * query.pageSize;
  if (!Number.isSafeInteger(offset)) throw new Error("Pagination offset is too large");
  const countRows = await db().query(
    `SELECT COUNT(*) AS total_records FROM reconciled_checks${filter.sql}`,
    filter.params,
  );
  const totalRecords = decodeCount(singleRow(countRows), "total_records");
  const listParams = [...filter.params, query.pageSize, offset];
  const rows = await db().query(
    `SELECT id, service_id, service_name, check_timestamp, status_code, status,
            latency_ms, agent, region, observation_count, source_row_number
       FROM reconciled_checks${filter.sql}
      ORDER BY check_timestamp DESC, service_id ASC, id ASC
      LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams,
  );
  const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / query.pageSize);
  return {
    checks: rows.map(mapCheckRow),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      totalRecords,
      totalPages,
      hasPreviousPage: totalPages > 0 && query.page > 1,
      hasNextPage: query.page < totalPages,
    },
  };
}

export async function queryStats(
  uploadId: string,
  query: CheckQuery,
): Promise<{ overall: FilteredAvailabilityMetrics; services: FilteredServiceStats[] }> {
  const filter = buildFilter(uploadId, query);
  const aggregate = `COUNT(*) AS valid_checks,
    COUNT(*) FILTER (WHERE status = 'success') AS successful_checks,
    COUNT(*) FILTER (WHERE status = 'failure') AS failed_checks,
    COUNT(latency_ms) AS latency_samples,
    AVG(latency_ms) AS avg_latency_ms,
    percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms)
      FILTER (WHERE latency_ms IS NOT NULL) AS p95_latency_ms`;
  const overallRows = await db().query(
    `SELECT ${aggregate} FROM reconciled_checks${filter.sql}`,
    filter.params,
  );
  const serviceRows = await db().query(
    `SELECT service_id, MIN(service_name) AS service_name, ${aggregate}
       FROM reconciled_checks${filter.sql}
      GROUP BY service_id ORDER BY service_id ASC`,
    filter.params,
  );
  return {
    overall: mapMetricsRow(singleRow(overallRows)),
    services: serviceRows.map((row) => {
      if (!isRecord(row) || typeof row.service_id !== "string" || typeof row.service_name !== "string") {
        throw new Error("Invalid persisted service statistics row");
      }
      return { serviceId: row.service_id, serviceName: row.service_name, ...mapMetricsRow(row) };
    }),
  };
}

export function isCompleteUploadRange(range: UploadRange): boolean {
  if (range.start === null || range.end === null) return false;
  const start = range.start;
  const end = range.end;
  const startsAtMonth =
    start.getUTCDate() === 1 &&
    start.getUTCHours() === 0 &&
    start.getUTCMinutes() === 0 &&
    start.getUTCSeconds() === 0 &&
    start.getUTCMilliseconds() === 0;
  const nextMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 1));
  return startsAtMonth && end.getTime() === nextMonth.getTime() - 15 * 60 * 1000;
}

function buildFilter(uploadId: string, query: CheckQuery): { sql: string; params: unknown[] } {
  const clauses = ["upload_id = $1"];
  const params: unknown[] = [uploadId];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    clauses.push(`${clause} $${params.length}`);
  };
  if (query.fromInclusive !== null) add("check_timestamp >=", query.fromInclusive);
  if (query.toExclusive !== null) add("check_timestamp <", query.toExclusive);
  if (query.range.serviceId !== null) add("service_id =", query.range.serviceId);
  if (query.range.status !== null) add("status =", query.range.status);
  return { sql: ` WHERE ${clauses.join(" AND ")}`, params };
}

function mapCheckRow(value: unknown): ReconciledCheckItem {
  if (!isRecord(value)) throw new Error("Invalid persisted check row");
  if (
    typeof value.service_id !== "string" ||
    typeof value.service_name !== "string" ||
    typeof value.status_code !== "number" ||
    !Number.isSafeInteger(value.status_code) ||
    (value.status !== "success" && value.status !== "failure") ||
    typeof value.agent !== "string" ||
    typeof value.region !== "string"
  ) {
    throw new Error("Invalid persisted check row");
  }
  const id = integerString(value.id, "check id");
  const timestamp = dateValue(value.check_timestamp, "check timestamp").toISOString();
  const observationCount = nonNegativeInteger(value.observation_count, "observation count", false);
  const sourceRowNumber = nonNegativeInteger(value.source_row_number, "source row number", false);
  const latencyMs = value.latency_ms === null ? null : finiteNonNegative(value.latency_ms, "latency");
  return {
    id,
    serviceId: value.service_id,
    serviceName: value.service_name,
    timestamp,
    statusCode: value.status_code,
    status: value.status,
    latencyMs,
    agent: value.agent,
    region: value.region,
    observationCount,
    sourceRowNumber,
  };
}

function mapMetricsRow(value: unknown): FilteredAvailabilityMetrics {
  if (!isRecord(value)) throw new Error("Invalid persisted statistics row");
  const validChecks = decodeCount(value, "valid_checks");
  const successfulChecks = decodeCount(value, "successful_checks");
  const failedChecks = decodeCount(value, "failed_checks");
  const latencySamples = decodeCount(value, "latency_samples");
  if (successfulChecks + failedChecks !== validChecks || latencySamples > validChecks) {
    throw new Error("Invalid persisted statistics counts");
  }
  const ratio = validChecks === 0 ? null : successfulChecks / validChecks;
  return {
    validChecks,
    successfulChecks,
    failedChecks,
    availabilityRatio: ratio,
    availabilityPercent: ratio === null ? null : round(ratio * 100, 3),
    breached: ratio === null ? null : ratio < 0.999,
    avgLatencyMs: nullableRounded(value.avg_latency_ms, 2),
    p95LatencyMs: nullableRounded(value.p95_latency_ms, 2),
    latencySamples,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function singleRow(rows: readonly unknown[]): unknown {
  if (rows.length !== 1) throw new Error("Invalid database aggregate result");
  return rows[0];
}

function nullableDate(value: unknown): Date | null {
  if (value === null) return null;
  return dateValue(value, "upload date range");
}

function dateValue(value: unknown, label: string): Date {
  if (typeof value !== "string" && !(value instanceof Date)) throw new Error(`Invalid ${label}`);
  const result = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(result.getTime())) throw new Error(`Invalid ${label}`);
  return result;
}

function integerString(value: unknown, label: string): string {
  if (typeof value === "bigint" && value > 0n) return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return value;
  throw new Error(`Invalid ${label}`);
}

function nonNegativeInteger(value: unknown, label: string, allowZero = true): number {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < 0 ||
    (!allowZero && parsed === 0)
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return parsed;
}

function decodeCount(value: unknown, key: string): number {
  if (!isRecord(value)) throw new Error("Invalid database count row");
  return nonNegativeInteger(value[key], key);
}

function finiteNonNegative(value: unknown, label: string): number {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label}`);
  }
  return parsed;
}

function nullableRounded(value: unknown, digits: number): number | null {
  if (value === null) return null;
  return round(finiteNonNegative(value, "latency aggregate"), digits);
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
