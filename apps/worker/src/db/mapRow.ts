import type {
  IngestionSuccess,
  MonthlyMetrics,
  OverallMetrics,
  ServiceMetrics,
  UploadProcessingReport,
  UploadSource,
  UploadStatus,
  UploadSummary,
} from "@sla-monitoring/shared";

/** Map a persisted uploads row to the API summary contract. */
export function summaryFromRow(row: unknown): UploadSummary {
  if (!isRecord(row)) throw new Error("Invalid persisted upload row");
  const requiredKeys = [
    "id",
    "status",
    "file_name",
    "byte_size",
    "content_hash",
    "report",
    "overall_metrics",
    "services_metrics",
    "months_metrics",
    "failure_code",
    "failure_message",
    "created_at",
    "completed_at",
  ];
  if (!requiredKeys.every((key) => Object.hasOwn(row, key))) {
    throw new Error("Invalid persisted upload row");
  }

  if (
    typeof row.id !== "string" ||
    typeof row.file_name !== "string" ||
    typeof row.content_hash !== "string" ||
    !isNullableString(row.failure_code) ||
    !isNullableString(row.failure_message) ||
    !isDateInput(row.created_at) ||
    !isNullableDateInput(row.completed_at)
  ) {
    throw new Error("Invalid persisted upload row");
  }

  const byteSize = persistedByteSize(row.byte_size);
  const status = uploadStatus(row.status);
  const createdAt = iso(row.created_at);
  const completedAt = row.completed_at === null ? null : iso(row.completed_at);

  return {
    id: row.id,
    status,
    source: {
      fileName: row.file_name,
      byteSize,
      contentHash: row.content_hash,
    },
    createdAt,
    completedAt,
    report: nullableDecoded(row.report, isProcessingReport, "processing report"),
    overall: nullableDecoded(row.overall_metrics, isOverallMetrics, "overall metrics"),
    services: nullableDecoded(row.services_metrics, isServiceMetricsArray, "service metrics"),
    months: nullableDecoded(row.months_metrics, isMonthlyMetricsArray, "monthly metrics"),
    failure:
      row.status === "failed" && row.failure_code
        ? { code: row.failure_code, message: row.failure_message ?? "" }
        : null,
  };
}

function persistedByteSize(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new Error("Invalid persisted byte size");
  }
  const byteSize = Number(value);
  if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
    throw new Error("Invalid persisted byte size");
  }
  return byteSize;
}

/** Build the summary for a fresh completion without a read-back. */
export function summaryFromResult(
  uploadId: string,
  result: IngestionSuccess,
  source: UploadSource,
): UploadSummary {
  const now = new Date().toISOString();
  return {
    id: uploadId,
    status: "completed",
    source,
    createdAt: now,
    completedAt: now,
    report: result.report,
    overall: result.overall,
    services: result.services,
    months: result.months,
    failure: null,
  };
}

function isDateInput(value: unknown): value is string | Date {
  return typeof value === "string" || value instanceof Date;
}

function isNullableDateInput(value: unknown): value is string | Date | null {
  return value === null || isDateInput(value);
}

function iso(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid persisted timestamp");
  return date.toISOString();
}

function uploadStatus(value: unknown): UploadStatus {
  if (value === "processing" || value === "completed" || value === "failed") return value;
  throw new Error("Invalid persisted upload status");
}

function nullableDecoded<T>(
  value: unknown,
  guard: (candidate: unknown) => candidate is T,
  label: string,
): T | null {
  if (value === null) return null;
  if (!guard(value)) throw new Error(`Invalid persisted ${label}`);
  return value;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isNonNegativeInteger = (value: unknown): value is number =>
  isFiniteNumber(value) && Number.isSafeInteger(value) && value >= 0;
const isPositiveInteger = (value: unknown): value is number =>
  isNonNegativeInteger(value) && value > 0;
const isNullableNonNegativeNumber = (value: unknown): value is number | null =>
  value === null || (isFiniteNumber(value) && value >= 0);
const isNullableBoolean = (value: unknown): value is boolean | null =>
  value === null || typeof value === "boolean";
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

function hasAvailabilityMetrics(value: Record<string, unknown>): boolean {
  return (
    isNonNegativeInteger(value.validChecks) &&
    isNonNegativeInteger(value.successfulChecks) &&
    value.successfulChecks <= value.validChecks &&
    isNullableRatio(value.availabilityRatio) &&
    isNullablePercent(value.availabilityPercent) &&
    isNullableBoolean(value.breached) &&
    isNullableNonNegativeNumber(value.avgLatencyMs) &&
    isNullableNonNegativeNumber(value.p95LatencyMs) &&
    isNonNegativeInteger(value.latencySamples) &&
    value.latencySamples <= value.validChecks
  );
}

function isNullableRatio(value: unknown): value is number | null {
  return value === null || (isFiniteNumber(value) && value >= 0 && value <= 1);
}

function isNullablePercent(value: unknown): value is number | null {
  return value === null || (isFiniteNumber(value) && value >= 0 && value <= 100);
}

function isOverallMetrics(value: unknown): value is OverallMetrics {
  return (
    isRecord(value) &&
    hasAvailabilityMetrics(value) &&
    isNonNegativeInteger(value.services) &&
    isNonNegativeInteger(value.intervals)
  );
}

function isServiceMetrics(value: unknown): value is ServiceMetrics {
  return (
    isRecord(value) &&
    hasAvailabilityMetrics(value) &&
    typeof value.serviceId === "string" &&
    isNullableString(value.serviceName) &&
    isNullablePercent(value.coveragePercent) &&
    isNullableNonNegativeInteger(value.missingIntervals) &&
    isNullableTimestamp(value.rangeStart) &&
    isNullableTimestamp(value.rangeEnd)
  );
}

function isServiceMetricsArray(value: unknown): value is ServiceMetrics[] {
  return Array.isArray(value) && value.every(isServiceMetrics);
}

function isMonthlyMetrics(value: unknown): value is MonthlyMetrics {
  return (
    isRecord(value) &&
    hasAvailabilityMetrics(value) &&
    typeof value.serviceId === "string" &&
    typeof value.month === "string" &&
    /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value.month) &&
    typeof value.partial === "boolean"
  );
}

function isMonthlyMetricsArray(value: unknown): value is MonthlyMetrics[] {
  return Array.isArray(value) && value.every(isMonthlyMetrics);
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || isNonNegativeInteger(value);
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && !Number.isNaN(Date.parse(value)));
}

function isCounterRecord(value: unknown, keys: readonly string[]): boolean {
  return isRecord(value) && keys.every((key) => isNonNegativeInteger(value[key]));
}

function isNonNegativeIntegerRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(isNonNegativeInteger);
}

function isProcessingReport(value: unknown): value is UploadProcessingReport {
  if (!isRecord(value) || !isRecord(value.dateRange)) return false;
  const numericFields = [
    "rawRows",
    "validObservations",
    "invalidObservations",
    "rejectedRows",
    "duplicateRemovals",
    "reconciledIntervals",
    "missingLatencyObservations",
  ];
  if (!numericFields.every((field) => isNonNegativeInteger(value[field]))) return false;
  if (value.fileName !== null && typeof value.fileName !== "string") return false;
  if (typeof value.lowTrust !== "boolean") return false;
  if (!isNullableTimestamp(value.dateRange.start) || !isNullableTimestamp(value.dateRange.end)) return false;
  if (
    value.dateRange.start !== null &&
    value.dateRange.end !== null &&
    Date.parse(value.dateRange.start) > Date.parse(value.dateRange.end)
  ) {
    return false;
  }
  if (
    !isCounterRecord(value.timestampConversions, [
      "isoUtc",
      "isoOffset",
      "epochSeconds",
      "epochMilliseconds",
    ]) ||
    !isCounterRecord(value.latencyConversions, ["fromMs", "fromSeconds"])
  ) {
    return false;
  }
  if (
    !isNonNegativeIntegerRecord(value.countsByRejectionReason) ||
    !isNonNegativeIntegerRecord(value.countsByInvalidReason)
  ) {
    return false;
  }
  return (
    value.duplicateRemovedRowNumbers === undefined ||
    (Array.isArray(value.duplicateRemovedRowNumbers) &&
      value.duplicateRemovedRowNumbers.every(isPositiveInteger))
  );
}
