import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../src/db/client", () => ({ db: () => ({ query }) }));

import worker from "../src/index";

const env = {
  DATABASE_URL: "postgres://test:test@db.local/test",
  ALLOWED_ORIGIN: "http://localhost:3000",
};
const id = "55555555-5555-4555-8555-555555555555";

function request(resource: string): Request {
  return new Request(`http://worker.local/uploads/${id}/${resource}`, {
    headers: { Origin: "http://localhost:3000" },
  });
}

beforeEach(() => query.mockReset());

describe("dashboard read APIs", () => {
  it("returns validated, paginated checks with stable metadata", async () => {
    query
      .mockResolvedValueOnce([{ status: "completed", date_range_start: null, date_range_end: null }])
      .mockResolvedValueOnce([{ total_records: "2" }])
      .mockResolvedValueOnce([
        {
          id: "9",
          service_id: "svc-a",
          service_name: "A",
          check_timestamp: "2025-04-10T10:00:00Z",
          status_code: 503,
          status: "failure",
          latency_ms: "812.50",
          agent: "agent-1",
          region: "ap-south-1",
          observation_count: 2,
          source_row_number: 4,
        },
      ]);
    const response = await worker.fetch(request("checks?page=1&pageSize=1&status=failure"), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
    const body = await response.json();
    expect(body).toMatchObject({
      uploadId: id,
      checks: [{ id: "9", status: "failure", latencyMs: 812.5 }],
      pagination: { page: 1, pageSize: 1, totalRecords: 2, totalPages: 2, hasNextPage: true },
    });
    expect(query.mock.calls[2]?.[0]).toContain("ORDER BY check_timestamp DESC, service_id ASC, id ASC");
    expect(query.mock.calls[2]?.[1]).toEqual([id, "failure", 1, 0]);
  });

  it("returns rounded overall and service statistics with partial metadata", async () => {
    const aggregate = {
      valid_checks: "3",
      successful_checks: "2",
      failed_checks: "1",
      latency_samples: "2",
      avg_latency_ms: "125.555",
      p95_latency_ms: "151.005",
    };
    query
      .mockResolvedValueOnce([
        {
          status: "completed",
          date_range_start: "2025-04-01T00:00:00Z",
          date_range_end: "2025-04-30T23:45:00Z",
        },
      ])
      .mockResolvedValueOnce([aggregate])
      .mockResolvedValueOnce([{ service_id: "svc-a", service_name: "A", ...aggregate }]);
    const response = await worker.fetch(request("stats?date=2025-04-10"), env);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      partial: true,
      overall: {
        validChecks: 3,
        successfulChecks: 2,
        failedChecks: 1,
        availabilityPercent: 66.667,
        breached: true,
        avgLatencyMs: 125.56,
        p95LatencyMs: 151.01,
        latencySamples: 2,
      },
      services: [{ serviceId: "svc-a", serviceName: "A" }],
    });
  });

  it("returns null statistics for an empty selected population", async () => {
    query
      .mockResolvedValueOnce([{ status: "completed", date_range_start: null, date_range_end: null }])
      .mockResolvedValueOnce([
        {
          valid_checks: "0",
          successful_checks: "0",
          failed_checks: "0",
          latency_samples: "0",
          avg_latency_ms: null,
          p95_latency_ms: null,
        },
      ])
      .mockResolvedValueOnce([]);
    const response = await worker.fetch(request("stats"), env);
    const body = await response.json();
    expect(body.overall).toMatchObject({
      availabilityRatio: null,
      availabilityPercent: null,
      breached: null,
      avgLatencyMs: null,
      p95LatencyMs: null,
    });
  });

  it("marks a complete unfiltered UTC month non-partial", async () => {
    query
      .mockResolvedValueOnce([
        {
          status: "completed",
          date_range_start: "2025-04-01T00:00:00.000Z",
          date_range_end: "2025-04-30T23:45:00.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          valid_checks: "0",
          successful_checks: "0",
          failed_checks: "0",
          latency_samples: "0",
          avg_latency_ms: null,
          p95_latency_ms: null,
        },
      ])
      .mockResolvedValueOnce([]);
    const response = await worker.fetch(request("stats"), env);
    expect(await response.json()).toMatchObject({ partial: false });
  });

  it("returns no previous page for an empty page 2", async () => {
    query
      .mockResolvedValueOnce([{ status: "completed", date_range_start: null, date_range_end: null }])
      .mockResolvedValueOnce([{ total_records: "0" }])
      .mockResolvedValueOnce([]);
    const response = await worker.fetch(request("checks?page=2"), env);
    expect(await response.json()).toMatchObject({
      pagination: { page: 2, totalPages: 0, hasPreviousPage: false, hasNextPage: false },
    });
  });

  it("rejects inconsistent aggregate rows", async () => {
    query
      .mockResolvedValueOnce([{ status: "completed", date_range_start: null, date_range_end: null }])
      .mockResolvedValueOnce([
        {
          valid_checks: "2",
          successful_checks: "2",
          failed_checks: "1",
          latency_samples: "0",
          avg_latency_ms: null,
          p95_latency_ms: null,
        },
      ]);
    const response = await worker.fetch(request("stats"), env);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "internal_error" });
  });

  it("returns stable 404, conflict, validation, and safe internal errors", async () => {
    query.mockResolvedValueOnce([]);
    expect((await worker.fetch(request("checks"), env)).status).toBe(404);

    query.mockResolvedValueOnce([{ status: "processing", date_range_start: null, date_range_end: null }]);
    const conflict = await worker.fetch(request("stats"), env);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: "upload_not_completed" });

    const invalid = await worker.fetch(request("checks?date=2025-02-30"), env);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "invalid_query" });

    query.mockResolvedValueOnce([{ status: "completed", date_range_start: null, date_range_end: null }]);
    query.mockRejectedValueOnce(new Error("postgres://user:secret@host/db"));
    const failed = await worker.fetch(request("checks"), env);
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain("secret");
  });

  it("rejects non-GET methods on the nested read resources with 405 and Allow", async () => {
    for (const resource of ["stats", "checks"]) {
      const response = await worker.fetch(
        new Request(`http://worker.local/uploads/${id}/${resource}`, {
          method: "POST",
          headers: { Origin: "http://localhost:3000" },
        }),
        env,
      );
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("GET, OPTIONS");
      expect(await response.json()).toMatchObject({ error: "method_not_allowed" });
    }
  });

  it("rejects malformed persisted rows through a generic 500", async () => {
    query
      .mockResolvedValueOnce([{ status: "completed", date_range_start: null, date_range_end: null }])
      .mockResolvedValueOnce([{ total_records: "1" }])
      .mockResolvedValueOnce([{ id: "1", service_id: "svc" }]);
    const response = await worker.fetch(request("checks"), env);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "internal_error" });
  });
});
