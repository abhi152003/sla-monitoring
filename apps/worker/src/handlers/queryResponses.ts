import { apiError, internalError } from "../api/errors";
import { InvalidQueryError } from "../api/query";
import { jsonResponse } from "../api/respond";
import { UploadNotCompletedError, UploadNotFoundError } from "../db/readChecks";

export function queryErrorResponse(error: unknown, origin: string | null, uploadId: string): Response {
  if (error instanceof InvalidQueryError) {
    const result = apiError("invalid_query", error.message);
    return jsonResponse(result.body, result.status, origin);
  }
  if (error instanceof UploadNotFoundError) {
    const result = apiError("not_found", `No upload found for id ${uploadId}.`);
    return jsonResponse(result.body, result.status, origin);
  }
  if (error instanceof UploadNotCompletedError) {
    const result = apiError("upload_not_completed", "Statistics and checks require a completed upload.");
    return jsonResponse(result.body, result.status, origin);
  }
  const result = internalError(error);
  return jsonResponse(result.body, result.status, origin);
}
