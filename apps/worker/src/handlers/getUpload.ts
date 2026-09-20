import { getUploadRow } from "../db/persistUpload";
import { summaryFromRow } from "../db/mapRow";
import { apiError } from "../api/errors";
import { jsonResponse } from "../api/respond";

/** GET /uploads/:id — persisted status and summary, no reprocessing. */
export async function handleGetUpload(id: string, request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  try {
    const row = await getUploadRow(id);
    if (!row) {
      const err = apiError("not_found", `No upload found for id ${id}.`);
      return jsonResponse(err.body, err.status, origin);
    }
    return jsonResponse({ upload: summaryFromRow(row) }, 200, origin);
  } catch {
    const err = apiError("internal_error", "An unexpected error occurred.");
    return jsonResponse(err.body, err.status, origin);
  }
}
