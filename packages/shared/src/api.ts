import type {
  MonthlyMetrics,
  OverallMetrics,
  ProcessingReport,
  ServiceMetrics,
} from "./ingestion";

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
  | "malformed_request" // 400: not multipart or missing file field
  | "invalid_file" // 400: wrong extension/content type
  | "payload_too_large" // 413: over the max request file size
  | "not_found" // 404
  | "method_not_allowed" // 405
  | "upload_conflict" // 409: identical content currently processing
  | "invalid_csv" // 422: ingestion-level file error (details in message)
  | "internal_error"; // 500

export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  malformed_request: 400,
  invalid_file: 400,
  payload_too_large: 413,
  not_found: 404,
  method_not_allowed: 405,
  upload_conflict: 409,
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
