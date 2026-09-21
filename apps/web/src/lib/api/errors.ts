import type { ApiErrorCode } from "@sla-monitoring/shared";

/** Error codes the web client can classify, extending the shared API codes with transport failures. */
export type ApiClientErrorCode =
  | ApiErrorCode
  | "network_error"
  | "invalid_response"
  | "not_configured"
  | "unknown_error";

const MESSAGES: Record<ApiClientErrorCode, string> = {
  invalid_query: "The request contained invalid filters. Adjust the filters and try again.",
  malformed_request: "The upload request was not formed correctly. Re-select the CSV file and try again.",
  invalid_file: "Only .csv files can be uploaded.",
  payload_too_large: "The file is larger than the 5 MiB upload limit.",
  not_found: "This dataset no longer exists on the server.",
  method_not_allowed: "The request method is not supported by the monitoring service.",
  upload_conflict: "The same dataset is currently being processed. Wait a few seconds and try again.",
  upload_not_completed: "This dataset has not finished processing yet. Try again shortly.",
  invalid_csv: "The CSV file could not be processed.",
  internal_error: "The monitoring service had an internal error. Please try again.",
  network_error: "Unable to reach the monitoring service. Check your connection and try again.",
  invalid_response: "The monitoring service returned an unreadable response.",
  not_configured: "The monitoring service URL is not configured for this deployment.",
  unknown_error: "An unexpected error occurred. Please try again.",
};

const RETRYABLE_CODES: ReadonlySet<ApiClientErrorCode> = new Set([
  "network_error",
  "invalid_response",
  "internal_error",
  "upload_conflict",
  "upload_not_completed",
  "unknown_error",
]);

const SHARED_ERROR_CODES: ReadonlySet<string> = new Set([
  "invalid_query",
  "malformed_request",
  "invalid_file",
  "payload_too_large",
  "not_found",
  "method_not_allowed",
  "upload_conflict",
  "upload_not_completed",
  "invalid_csv",
  "internal_error",
]);

/**
 * Error thrown by the API client for every failure mode (HTTP error body, network
 * failure, unreadable response, missing configuration). Carries a stable code so
 * callers can branch on failure kind without matching on prose.
 */
export class ApiClientError extends Error {
  readonly code: ApiClientErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(code: ApiClientErrorCode, status: number | null, message: string, retryable: boolean) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }

  static network(): ApiClientError {
    return new ApiClientError("network_error", null, MESSAGES.network_error, true);
  }

  static invalidResponse(): ApiClientError {
    return new ApiClientError("invalid_response", null, MESSAGES.invalid_response, true);
  }

  static notConfigured(): ApiClientError {
    return new ApiClientError("not_configured", null, MESSAGES.not_configured, false);
  }

  /** Decodes a `{ error, message }` error body into a readable error without exposing internals. */
  static fromResponse(status: number, body: unknown): ApiClientError {
    let code: ApiClientErrorCode = "unknown_error";
    let serverMessage: string | null = null;

    if (body !== null && typeof body === "object") {
      const record = body as { error?: unknown; message?: unknown };
      if (typeof record.error === "string" && SHARED_ERROR_CODES.has(record.error)) {
        code = record.error as ApiErrorCode;
      }
      if (typeof record.message === "string" && record.message.trim().length > 0) {
        serverMessage = record.message;
      }
    }

    if (code === "unknown_error" && status >= 500) {
      code = "internal_error";
    }

    let message = MESSAGES[code];
    // The server's CSV diagnostics are intentional operator-facing detail; surface them,
    // but never invent detail for other codes.
    if (code === "invalid_csv" && serverMessage) {
      message = `${MESSAGES.invalid_csv} ${serverMessage}`;
    }

    return new ApiClientError(code, status, message, RETRYABLE_CODES.has(code));
  }
}

/** Renders any thrown value as a safe, readable message. */
export function describeError(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }
  return MESSAGES.unknown_error;
}
