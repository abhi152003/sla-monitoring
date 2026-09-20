/**
 * Public ingestion result contracts: the stable surface between the
 * ingestion library (packages/ingestion) and the Worker / dashboard code.
 * Cleaning and SLA semantics are defined in the root README.
 */

/** Columns every input file must provide. */
export const REQUIRED_COLUMNS = [
  "service_id",
  "service_name",
  "timestamp",
  "status_code",
  "latency",
  "latency_unit",
  "agent",
  "region",
] as const;

export type RequiredColumn = (typeof REQUIRED_COLUMNS)[number];

/** Machine-readable reason a row was rejected and excluded from all metrics. */
export type RejectionReason =
  | "malformed_row" // field count differs from the header
  | "empty_required_field" // any required field except latency is empty
  | "ambiguous_service_mapping" // service_id has a mapping-frequency tie; all its rows are rejected
  | "inconsistent_service_name" // service_name is not the majority mapping for its service_id
  | "invalid_status_code" // not an integer, or outside supported HTTP classes
  | "invalid_latency_unit" // neither "ms" nor "s"
  | "invalid_latency" // non-numeric, non-finite, or negative
  | "invalid_timestamp"; // unparseable, overflowed, or off the 15-minute grid

/** Reason an observation is invalid (excluded from SLA records, counted as a warning). */
export type InvalidObservationReason = "status_999";

/** File-level error codes: the whole file is rejected before row processing. */
export type FileErrorCode =
  | "empty_file"
  | "header_only"
  | "missing_columns"
  | "duplicate_required_headers"
  | "malformed_csv";

export interface FileError {
  code: FileErrorCode;
  message: string;
  /** missing_columns: absent required names, in REQUIRED_COLUMNS order. */
  missingColumns?: string[];
  /** duplicate_required_headers: required names appearing more than once. */
  duplicateColumns?: string[];
}

export interface SourceMetadata {
  fileName?: string;
}

export interface RejectedRecord {
  /** One-based CSV record number (header = 1, first data row = 2). */
  rowNumber: number;
  reason: RejectionReason;
  values: Record<string, string>;
}

/** An invalid observation (status 999) removed before dedupe/reconciliation. */
export interface InvalidObservation {
  rowNumber: number;
  reason: InvalidObservationReason;
  values: Record<string, string>;
}

export type CheckStatus = "success" | "failure";

export interface ObservationEvidence {
  rowNumber: number;
  agent: string;
  statusCode: number;
  latencyMs: number | null;
}

/** One verdict per (service_id, 15-minute interval). */
export interface CheckRecord {
  serviceId: string;
  serviceName: string;
  /** Canonical UTC form: YYYY-MM-DDTHH:mm:00Z. */
  timestamp: string;
  statusCode: number;
  status: CheckStatus;
  /** Max latency across the interval's observations; null when none reported one. */
  latencyMs: number | null;
  /** From the representative observation: worst status, then highest latency, then lex agent. */
  agent: string;
  region: string;
  observationCount: number;
  sourceRowNumber: number;
  /** Full valid observation set for audit, sorted by rowNumber. */
  observations: ObservationEvidence[];
}

/** Availability metrics shared by every scope (whole upload, service, month). */
export interface AvailabilityMetrics {
  /** Denominator D: reconciled valid intervals. */
  validChecks: number;
  /** Numerator N: successful intervals. */
  successfulChecks: number;
  /** N/D, or null when D = 0. */
  availabilityRatio: number | null;
  /** Ratio * 100, 3 decimals, or null. */
  availabilityPercent: number | null;
  /** ratio < 0.999 strictly; exactly 99.9% is compliant; null when D = 0. */
  breached: boolean | null;
  /** Mean of non-null latencies, 2 decimals; null when no samples. */
  avgLatencyMs: number | null;
  /** Nearest-rank p95 of non-null latencies; null when no samples. */
  p95LatencyMs: number | null;
  latencySamples: number;
}

export interface ServiceMetrics extends AvailabilityMetrics {
  serviceId: string;
  serviceName: string | null;
  /** Intervals / expected 15-min grid (per-service min..max), 3 decimals. */
  coveragePercent: number | null;
  /** Expected grid size minus intervals. */
  missingIntervals: number | null;
  rangeStart: string | null;
  rangeEnd: string | null;
}

export interface MonthlyMetrics extends AvailabilityMetrics {
  serviceId: string;
  /** UTC calendar month. */
  month: string;
  /** true unless the service's observed range covers the entire month. */
  partial: boolean;
}

export interface OverallMetrics extends AvailabilityMetrics {
  services: number;
  intervals: number;
}

export interface TimestampConversionCounts {
  isoUtc: number;
  isoOffset: number;
  epochSeconds: number;
  epochMilliseconds: number;
}

export interface LatencyConversionCounts {
  fromMs: number;
  fromSeconds: number;
}

/**
 * Processing report. Count definitions:
 * - rawRows: data records (header excluded, blank records skipped)
 * - validObservations: rows entering the dedupe stage (999s excluded)
 * - invalidObservations: rows whose only problem is status 999
 * - rejectedRows: rows rejected for any RejectionReason
 * - duplicateRemovals/duplicateRemovedRowNumbers: post-normalization exact
 *   duplicates removed; the lowest row number of each group is kept
 * - reconciledIntervals: CheckRecords produced
 * - missingLatencyObservations: post-dedupe observations with null latency
 * - timestampConversions / latencyConversions: per-field conversion counts,
 *   taken at normalization regardless of a row's fate in later stages
 * - lowTrust: rejectedRows > 5% of rawRows
 */
export interface ProcessingReport {
  fileName: string | null;
  rawRows: number;
  validObservations: number;
  invalidObservations: number;
  rejectedRows: number;
  duplicateRemovals: number;
  duplicateRemovedRowNumbers: number[];
  reconciledIntervals: number;
  missingLatencyObservations: number;
  timestampConversions: TimestampConversionCounts;
  latencyConversions: LatencyConversionCounts;
  lowTrust: boolean;
  dateRange: { start: string | null; end: string | null };
  countsByRejectionReason: Partial<Record<RejectionReason, number>>;
  countsByInvalidReason: Partial<Record<InvalidObservationReason, number>>;
}

export type IngestionOutcome =
  | "processed"
  | "no_valid_intervals"; // no file-level error, but no valid intervals survived

export interface IngestionSuccess {
  ok: true;
  outcome: IngestionOutcome;
  /** Sorted by (serviceId, timestamp). */
  records: CheckRecord[];
  /** Sorted by rowNumber. */
  rejected: RejectedRecord[];
  invalidObservations: InvalidObservation[];
  /** Sorted by serviceId. */
  services: ServiceMetrics[];
  /** Sorted by (serviceId, month). */
  months: MonthlyMetrics[];
  overall: OverallMetrics;
  report: ProcessingReport;
}

export type IngestionResult = IngestionSuccess | { ok: false; error: FileError };
