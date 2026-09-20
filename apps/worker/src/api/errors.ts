import { API_ERROR_STATUS, type ApiError, type ApiErrorCode, type FileError } from "@sla-monitoring/shared";

export function apiError(code: ApiErrorCode, message: string): { status: number; body: ApiError } {
  return { status: API_ERROR_STATUS[code], body: { error: code, message } };
}

/** Ingestion file-level errors map to a single stable API code with detail in the message. */
export function fileErrorToApi(error: FileError): { status: number; body: ApiError } {
  return apiError("invalid_csv", `${error.code}: ${error.message}`);
}

/** Server errors never leak SQL, hosts, stack traces, or driver internals. */
export function internalError(log?: unknown): { status: number; body: ApiError } {
  if (log !== undefined) console.error("internal error", safeLogValue(log));
  return apiError("internal_error", "An unexpected error occurred while processing the upload.");
}

function safeLogValue(value: unknown): unknown {
  // Error messages and arbitrary thrown values can contain connection strings,
  // SQL, request data, or provider internals. Keep only non-sensitive shape.
  if (value instanceof Error) return { type: "Error" };
  return { type: typeof value };
}
