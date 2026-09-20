import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/persistUpload", () => ({
  findPriorAttempt: vi.fn(),
  deleteFailedAttempt: vi.fn(),
  deleteDeadAttempt: vi.fn(),
  createProcessingUpload: vi.fn(),
  markUploadFailed: vi.fn(),
  persistCompletedUpload: vi.fn(),
  getUploadRow: vi.fn(),
}));

import worker from "../src/index";
import {
  createProcessingUpload,
  deleteDeadAttempt,
  deleteFailedAttempt,
  findPriorAttempt,
  getUploadRow,
  markUploadFailed,
  persistCompletedUpload,
} from "../src/db/persistUpload";
import type { IngestionSuccess } from "@sla-monitoring/shared";

const TINY_CSV =
  "service_id,service_name,timestamp,status_code,latency,latency_unit,agent,region\n" +
  "svc-a,a-api,2025-04-10T00:00:00Z,200,120,ms,agent-1,ap-south-1\n" +
  "svc-a,a-api,2025-04-10T00:15:00Z,503,800,ms,agent-1,ap-south-1\n" +
  "svc-a,a-api,2025-04-10T00:30:00Z,200,130,ms,agent-1,ap-south-1\n";

const PERSISTED_REPORT = {
  fileName: "checks.csv",
  rawRows: 3,
  validObservations: 3,
  invalidObservations: 0,
  rejectedRows: 0,
  duplicateRemovals: 0,
  duplicateRemovedRowNumbers: [],
  reconciledIntervals: 3,
  missingLatencyObservations: 0,
  timestampConversions: { isoUtc: 3, isoOffset: 0, epochSeconds: 0, epochMilliseconds: 0 },
  latencyConversions: { fromMs: 3, fromSeconds: 0 },
  lowTrust: false,
  dateRange: { start: "2025-04-10T00:00:00.000Z", end: "2025-04-10T00:30:00.000Z" },
  countsByRejectionReason: {},
  countsByInvalidReason: {},
};

const PERSISTED_OVERALL = {
  validChecks: 3,
  successfulChecks: 2,
  availabilityRatio: 2 / 3,
  availabilityPercent: 66.667,
  breached: true,
  avgLatencyMs: 350,
  p95LatencyMs: 800,
  latencySamples: 3,
  services: 1,
  intervals: 3,
};

function uploadRequest(body: string | Uint8Array, name = "checks.csv") {
  const form = new FormData();
  form.append("file", new File([body], name, { type: "text/csv" }));
  return new Request("http://worker.local/uploads", {
    method: "POST",
    body: form,
    headers: { Origin: "http://localhost:3000" },
  });
}

const env = {
  DATABASE_URL: "postgres://test:test@db.local/test",
  ALLOWED_ORIGIN: "http://localhost:3000",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUploadRow).mockReset();
  vi.mocked(findPriorAttempt).mockResolvedValue({ kind: "none" });
  vi.mocked(createProcessingUpload).mockResolvedValue("11111111-1111-4111-8111-111111111111");
  vi.mocked(deleteFailedAttempt).mockResolvedValue(undefined);
  vi.mocked(deleteDeadAttempt).mockResolvedValue(undefined);
  vi.mocked(markUploadFailed).mockResolvedValue(undefined);
  vi.mocked(persistCompletedUpload).mockResolvedValue(undefined);
});

describe("POST /uploads", () => {
  it("returns 201 with a complete summary for a new upload", async () => {
    const res = await worker.fetch(uploadRequest(TINY_CSV), env);
    expect(res.status).toBe(201);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");

    const body = (await res.json()) as { created: boolean; upload: IngestionSuccess & { id: string } };
    expect(body.created).toBe(true);
    expect(body.upload.status).toBe("completed");
    expect(body.upload.report.reconciledIntervals).toBe(3);
    expect(body.upload.overall.validChecks).toBe(3);
    expect(body.upload.overall.successfulChecks).toBe(2);
    expect(body.upload.services).toHaveLength(1);
    expect(body.upload.months).toHaveLength(1);
    expect(body.upload.source.contentHash).toHaveLength(64);
    expect(createProcessingUpload).toHaveBeenCalledOnce();
    expect(persistCompletedUpload).toHaveBeenCalledOnce();
  });

  it("returns 200 created=false on idempotent replay of completed content", async () => {
    vi.mocked(findPriorAttempt).mockResolvedValue({
      kind: "completed",
      id: "22222222-2222-4222-8222-222222222222",
    });
    vi.mocked(getUploadRow).mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      status: "completed",
      file_name: "checks.csv",
      byte_size: 123,
      content_hash: "abc",
      report: PERSISTED_REPORT,
      overall_metrics: PERSISTED_OVERALL,
      services_metrics: [],
      months_metrics: [],
      failure_code: null,
      failure_message: null,
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    } as never);

    const res = await worker.fetch(uploadRequest(TINY_CSV), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: boolean; upload: { id: string } };
    expect(body.created).toBe(false);
    expect(body.upload.id).toBe("22222222-2222-4222-8222-222222222222");
    expect(persistCompletedUpload).not.toHaveBeenCalled();
    expect(createProcessingUpload).not.toHaveBeenCalled();
  });

  it("returns 409 when identical content is still processing (fresh)", async () => {
    vi.mocked(findPriorAttempt).mockResolvedValue({
      kind: "processing",
      id: "33333333-3333-4333-8333-333333333333",
      stale: false,
    });
    const res = await worker.fetch(uploadRequest(TINY_CSV), env);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("upload_conflict");
  });

  it("returns 409 when another request wins the content-hash claim", async () => {
    vi.mocked(findPriorAttempt)
      .mockResolvedValueOnce({ kind: "none" })
      .mockResolvedValueOnce({
        kind: "processing",
        id: "33333333-3333-4333-8333-333333333333",
        stale: false,
      });
    vi.mocked(createProcessingUpload).mockResolvedValueOnce(null);

    const res = await worker.fetch(uploadRequest(TINY_CSV), env);

    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "upload_conflict" });
    expect(persistCompletedUpload).not.toHaveBeenCalled();
  });

  it("returns the completed replay when another request finishes the content-hash claim", async () => {
    const winnerId = "22222222-2222-4222-8222-222222222222";
    vi.mocked(findPriorAttempt)
      .mockResolvedValueOnce({ kind: "none" })
      .mockResolvedValueOnce({ kind: "completed", id: winnerId });
    vi.mocked(createProcessingUpload).mockResolvedValueOnce(null);
    vi.mocked(getUploadRow).mockResolvedValueOnce({
      id: winnerId,
      status: "completed",
      file_name: "checks.csv",
      byte_size: 123,
      content_hash: "abc",
      report: PERSISTED_REPORT,
      overall_metrics: PERSISTED_OVERALL,
      services_metrics: [],
      months_metrics: [],
      failure_code: null,
      failure_message: null,
      created_at: "2026-09-20T00:00:00.000Z",
      completed_at: "2026-09-20T00:00:01.000Z",
    });

    const res = await worker.fetch(uploadRequest(TINY_CSV), env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: boolean; upload: { id: string } };
    expect(body).toMatchObject({ created: false, upload: { id: winnerId } });
    expect(persistCompletedUpload).not.toHaveBeenCalled();
  });

  it("takes over a stale processing attempt: deletes it and reprocesses", async () => {
    vi.mocked(findPriorAttempt).mockResolvedValue({
      kind: "processing",
      id: "33333333-3333-4333-8333-333333333333",
      stale: true,
    });
    const { deleteDeadAttempt } = await import("../src/db/persistUpload");
    const res = await worker.fetch(uploadRequest(TINY_CSV), env);
    expect(res.status).toBe(201);
    expect(deleteDeadAttempt).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333", "processing");
    expect(createProcessingUpload).toHaveBeenCalledOnce();
  });

  it("deletes a failed prior attempt and retries the same content", async () => {
    vi.mocked(findPriorAttempt).mockResolvedValue({
      kind: "failed",
      id: "44444444-4444-4444-8444-444444444444",
    });
    const res = await worker.fetch(uploadRequest(TINY_CSV), env);
    expect(res.status).toBe(201);
    expect(deleteFailedAttempt).toHaveBeenCalledWith("44444444-4444-4444-8444-444444444444");
    expect(createProcessingUpload).toHaveBeenCalledOnce();
  });

  it("maps ingestion file errors to 422 and marks the upload failed", async () => {
    const res = await worker.fetch(uploadRequest("", "empty.csv"), env);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("invalid_csv");
    expect(body.message).toContain("empty_file");
    expect(markUploadFailed).toHaveBeenCalledOnce();
    expect(persistCompletedUpload).not.toHaveBeenCalled();
  });

  it("returns a generic 500 without leaking internals when persistence fails", async () => {
    vi.mocked(persistCompletedUpload).mockRejectedValue(
      new Error("connect ECONNREFUSED postgres://user:secret@host/db"),
    );
    const res = await worker.fetch(uploadRequest(TINY_CSV), env);
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("secret");
    expect(text).not.toContain("postgres://");
    expect(text).toContain("internal_error");
    expect(markUploadFailed).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "internal_error",
      "An unexpected error occurred while processing the upload.",
    );
  });

  it("does not mask the original 500 when marking a failed upload also fails", async () => {
    vi.mocked(persistCompletedUpload).mockRejectedValueOnce(new Error("database write failed"));
    vi.mocked(markUploadFailed).mockRejectedValueOnce(new Error("database unavailable"));

    const res = await worker.fetch(uploadRequest(TINY_CSV), env);

    expect(res.status).toBe(500);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "internal_error" });
  });

  it("rejects oversized files with 413 before touching the database", async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    const res = await worker.fetch(uploadRequest(big, "big.csv"), env);
    expect(res.status).toBe(413);
    expect(findPriorAttempt).not.toHaveBeenCalled();
  });

  it("rejects non-multipart bodies with 400", async () => {
    const res = await worker.fetch(
      new Request("http://worker.local/uploads", {
        method: "POST",
        body: "hello",
        headers: { "content-type": "text/plain" },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /uploads/:id", () => {
  it("returns the persisted summary without reprocessing", async () => {
    vi.mocked(getUploadRow).mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
      status: "completed",
      file_name: "checks.csv",
      byte_size: 100,
      content_hash: "hash",
      report: null,
      overall_metrics: PERSISTED_OVERALL,
      services_metrics: null,
      months_metrics: null,
      failure_code: null,
      failure_message: null,
      created_at: "2026-09-20T00:00:00.000Z",
      completed_at: "2026-09-20T00:00:01.000Z",
    } as never);
    const res = await worker.fetch(
      new Request("http://worker.local/uploads/55555555-5555-4555-8555-555555555555"),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { upload: { id: string; status: string } };
    expect(body.upload.id).toBe("55555555-5555-4555-8555-555555555555");
    expect(body.upload.status).toBe("completed");
  });

  it("returns a stable 404 for unknown ids", async () => {
    vi.mocked(getUploadRow).mockResolvedValue(null);
    const res = await worker.fetch(new Request("http://worker.local/uploads/nope"), env);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("not_found");
    expect(body.message).toContain("nope");
  });
});

describe("method handling", () => {
  it("returns 405 for a known path with an unsupported method", async () => {
    const res = await worker.fetch(new Request("http://worker.local/health", { method: "POST" }), env);
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, OPTIONS");
    expect((await res.json()) as { error: string }).toMatchObject({ error: "method_not_allowed" });
  });
});
