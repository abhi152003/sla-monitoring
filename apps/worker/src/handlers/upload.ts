import { processMonitoringCsv } from "@sla-monitoring/ingestion";
import {
  createProcessingUpload,
  deleteDeadAttempt,
  deleteFailedAttempt,
  findPriorAttempt,
  getUploadRow,
  markUploadFailed,
  persistCompletedUpload,
} from "../db/persistUpload";
import { summaryFromResult, summaryFromRow } from "../db/mapRow";
import { apiError, fileErrorToApi, internalError } from "../api/errors";
import { jsonResponse } from "../api/respond";
import { parseMultipartFile } from "../api/multipart";
import { sha256Hex } from "../util/hash";
import { logEvent } from "../util/log";

/** POST /uploads: multipart CSV -> ingestion -> atomic persistence -> summary. */
export async function handleUpload(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  let activeUploadId: string | null = null;

  const parsed = await parseMultipartFile(request);
  if (!parsed.ok) {
    const err = apiError(parsed.code, parsed.message);
    return jsonResponse(err.body, err.status, origin);
  }

  const { fileName, bytes } = parsed.file;
  const contentHash = await sha256Hex(bytes);
  const byteSize = bytes.byteLength;

  try {
    const prior = await findPriorAttempt(contentHash);
    if (prior.kind === "completed") {
      const row = await getUploadRow(prior.id);
      if (row) {
        logEvent("upload.replay", { uploadId: prior.id, contentHash });
        return jsonResponse({ created: false, upload: summaryFromRow(row) }, 200, origin);
      }
    } else if (prior.kind === "processing") {
      if (!prior.stale) {
        const err = apiError(
          "upload_conflict",
          "Identical content is currently being processed. Retry shortly.",
        );
        return jsonResponse(err.body, err.status, origin);
      }
      // Stale processing row: the previous attempt was killed before it could
      // finish or fail (e.g. a runtime resource limit). It is provably empty,
      // so delete it and retry.
      await deleteDeadAttempt(prior.id, "processing");
    } else if (prior.kind === "failed") {
      await deleteFailedAttempt(prior.id);
    }

    const uploadId = await createProcessingUpload({ contentHash, fileName, byteSize });
    if (uploadId === null) {
      // Another request won the UNIQUE(content_hash) claim after our initial
      // lookup/delete. Resolve from persisted state instead of leaking a 500.
      const winner = await findPriorAttempt(contentHash);
      if (winner.kind === "completed") {
        const row = await getUploadRow(winner.id);
        if (row) {
          logEvent("upload.replay", { uploadId: winner.id, contentHash });
          return jsonResponse({ created: false, upload: summaryFromRow(row) }, 200, origin);
        }
      }
      const err = apiError(
        "upload_conflict",
        "Identical content is currently being processed or retried. Retry shortly.",
      );
      return jsonResponse(err.body, err.status, origin);
    }
    activeUploadId = uploadId;
    logEvent("upload.created", { uploadId, fileName, byteSize });

    const result = processMonitoringCsv(bytes, { fileName });
    if (!result.ok) {
      await markUploadFailed(uploadId, result.error.code, result.error.message);
      activeUploadId = null;
      logEvent("upload.failed", { uploadId, code: result.error.code });
      const err = fileErrorToApi(result.error);
      return jsonResponse(err.body, err.status, origin);
    }

    const started = Date.now();
    await persistCompletedUpload({ uploadId, contentHash, fileName, byteSize, result });
    activeUploadId = null;
    logEvent("upload.completed", {
      uploadId,
      durationMs: Date.now() - started,
      intervals: result.report.reconciledIntervals,
      rejected: result.report.rejectedRows,
    });

    return jsonResponse(
      { created: true, upload: summaryFromResult(uploadId, result, { fileName, byteSize, contentHash }) },
      201,
      origin,
    );
  } catch (e) {
    if (activeUploadId !== null) {
      try {
        await markUploadFailed(
          activeUploadId,
          "internal_error",
          "An unexpected error occurred while processing the upload.",
        );
        logEvent("upload.failed", { uploadId: activeUploadId, code: "internal_error" });
      } catch (markError) {
        console.error("failed to mark upload failed", {
          type: markError instanceof Error ? "Error" : typeof markError,
        });
      }
    }
    const err = internalError(e);
    return jsonResponse(err.body, err.status, origin);
  }
}
