import type { UploadChecksResponse } from "@sla-monitoring/shared";
import { parseCheckQuery } from "../api/query";
import { jsonResponse } from "../api/respond";
import { queryChecks, requireCompletedUpload } from "../db/readChecks";
import { logEvent } from "../util/log";
import { queryErrorResponse } from "./queryResponses";

export async function handleGetChecks(id: string, request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  const started = Date.now();
  try {
    const query = parseCheckQuery(new URL(request.url).searchParams, true);
    await requireCompletedUpload(id);
    const result = await queryChecks(id, query);
    const body: UploadChecksResponse = {
      uploadId: id,
      selectedRange: query.range,
      checks: result.checks,
      pagination: result.pagination,
    };
    logEvent("checks.queried", {
      uploadId: id,
      durationMs: Date.now() - started,
      records: result.checks.length,
      totalRecords: result.pagination.totalRecords,
    });
    return jsonResponse(body, 200, origin);
  } catch (error) {
    return queryErrorResponse(error, origin, id);
  }
}
