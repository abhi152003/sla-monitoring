import type { UploadStatsResponse } from "@sla-monitoring/shared";
import { parseCheckQuery } from "../api/query";
import { jsonResponse } from "../api/respond";
import { isCompleteUploadRange, queryStats, requireCompletedUpload } from "../db/readChecks";
import { logEvent } from "../util/log";
import { queryErrorResponse } from "./queryResponses";

export async function handleGetStats(id: string, request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  const started = Date.now();
  try {
    const query = parseCheckQuery(new URL(request.url).searchParams, false);
    const uploadRange = await requireCompletedUpload(id);
    const result = await queryStats(id, query);
    const explicitlyFiltered = query.range.date !== null || query.range.from !== null || query.range.to !== null;
    const body: UploadStatsResponse = {
      uploadId: id,
      selectedRange: query.range,
      partial: explicitlyFiltered || !isCompleteUploadRange(uploadRange),
      overall: result.overall,
      services: result.services,
    };
    logEvent("stats.queried", {
      uploadId: id,
      durationMs: Date.now() - started,
      validChecks: result.overall.validChecks,
      services: result.services.length,
    });
    return jsonResponse(body, 200, origin);
  } catch (error) {
    return queryErrorResponse(error, origin, id);
  }
}
