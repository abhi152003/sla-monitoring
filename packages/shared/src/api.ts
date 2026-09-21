import type {
  MonthlyMetrics,
  OverallMetrics,
  ProcessingReport,
  ServiceMetrics,
} from "./ingestion";
import type { CheckStatus } from "./ingestion";

/** Upload lifecycle states. */
export type UploadStatus = "processing" | "completed" | "failed";

export interface UploadSource {
  fileName: string | null;
  byteSize: number;
  /** SHA-256 of the file bytes; the idempotency identity. */
  contentHash: string;
}

export interface UploadFailure {
  code: string;
  message: string;
}

/** Persisted reports retain duplicate-row audit data; it stays optional for legacy rows. */
export type UploadProcessingReport = Omit<ProcessingReport, "duplicateRemovedRowNumbers"> & {
  duplicateRemovedRowNumbers?: number[];
};

/** Summary persisted per upload and returned by POST /uploads and GET /uploads/:id. */
export interface UploadSummary {
  id: string;
  status: UploadStatus;
  source: UploadSource;
  createdAt: string;
  completedAt: string | null;
  report: UploadProcessingReport | null;
  overall: OverallMetrics | null;
  services: ServiceMetrics[] | null;
  months: MonthlyMetrics[] | null;
  failure: UploadFailure | null;
}

/** Stable API error codes with their HTTP statuses. */
export type ApiErrorCode =
  | "invalid_query" // 400: malformed filters or pagination
  | "malformed_request" // 400: not multipart or missing file field
  | "invalid_file" // 400: wrong extension/content type
  | "payload_too_large" // 413: over the max request file size
  | "not_found" // 404
  | "method_not_allowed" // 405
  | "upload_conflict" // 409: identical content currently processing
  | "upload_not_completed" // 409: read endpoint requires a completed upload
  | "invalid_csv" // 422: ingestion-level file error (details in message)
  | "internal_error"; // 500

export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  invalid_query: 400,
  malformed_request: 400,
  invalid_file: 400,
  payload_too_large: 413,
  not_found: 404,
  method_not_allowed: 405,
  upload_conflict: 409,
  upload_not_completed: 409,
  invalid_csv: 422,
  internal_error: 500,
};

export interface UploadResponse {
  /** true when this request created the upload; false on idempotent replay. */
  created: boolean;
  upload: UploadSummary;
}

export type DatabaseHealth = "ok" | "unreachable";

/** Extended /health contract: worker + database reachability. */
export interface HealthCheckResponse {
  /** "ok" when the worker and database are both reachable, otherwise "degraded". */
  status: "ok" | "degraded";
  service: string;
  app: string;
  database: DatabaseHealth;
  timestamp: string;
}

/** Documented upload endpoint contract: multipart field name and limits. */
export const UPLOAD_FIELD_NAME = "file";
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const DEFAULT_CHECKS_PAGE = 1;
export const DEFAULT_CHECKS_PAGE_SIZE = 50;
export const MAX_CHECKS_PAGE_SIZE = 100;
export const MAX_SERVICE_ID_LENGTH = 128;

export interface SelectedCheckRange {
  date: string | null;
  from: string | null;
  to: string | null;
  fromInclusive: string | null;
  toExclusive: string | null;
  serviceId: string | null;
  status: CheckStatus | null;
}

export interface ReconciledCheckItem {
  id: string;
  serviceId: string;
  serviceName: string;
  timestamp: string;
  statusCode: number;
  status: CheckStatus;
  latencyMs: number | null;
  agent: string;
  region: string;
  observationCount: number;
  sourceRowNumber: number;
}

export interface ChecksPagination {
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}

export interface UploadChecksResponse {
  uploadId: string;
  selectedRange: SelectedCheckRange;
  checks: ReconciledCheckItem[];
  pagination: ChecksPagination;
}

export interface FilteredAvailabilityMetrics {
  validChecks: number;
  successfulChecks: number;
  failedChecks: number;
  availabilityRatio: number | null;
  availabilityPercent: number | null;
  breached: boolean | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  latencySamples: number;
}

export interface FilteredServiceStats extends FilteredAvailabilityMetrics {
  serviceId: string;
  serviceName: string;
}

export interface UploadStatsResponse {
  uploadId: string;
  selectedRange: SelectedCheckRange;
  partial: boolean;
  overall: FilteredAvailabilityMetrics;
  services: FilteredServiceStats[];
}
