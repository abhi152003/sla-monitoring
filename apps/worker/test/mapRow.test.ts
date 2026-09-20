import { describe, expect, it } from "vitest";
import { summaryFromRow } from "../src/db/mapRow";

const report = {
  fileName: "checks.csv",
  rawRows: 4,
  validObservations: 3,
  invalidObservations: 1,
  rejectedRows: 0,
  duplicateRemovals: 1,
  duplicateRemovedRowNumbers: [3, 4],
  reconciledIntervals: 2,
  missingLatencyObservations: 0,
  timestampConversions: { isoUtc: 4, isoOffset: 0, epochSeconds: 0, epochMilliseconds: 0 },
  latencyConversions: { fromMs: 4, fromSeconds: 0 },
  lowTrust: false,
  dateRange: { start: "2026-09-20T00:00:00.000Z", end: "2026-09-20T00:15:00.000Z" },
  countsByRejectionReason: {},
  countsByInvalidReason: { status_999: 1 },
};

const overall = {
  validChecks: 2,
  successfulChecks: 2,
  availabilityRatio: 1,
  availabilityPercent: 100,
  breached: false,
  avgLatencyMs: 120,
  p95LatencyMs: 130,
  latencySamples: 2,
  services: 1,
  intervals: 2,
};

function persistedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    status: "completed",
    file_name: "checks.csv",
    byte_size: 123,
    content_hash: "abc",
    report,
    overall_metrics: overall,
    services_metrics: [],
    months_metrics: [],
    failure_code: null,
    failure_message: null,
    created_at: "2026-09-20T00:00:00.000Z",
    completed_at: "2026-09-20T00:00:01.000Z",
    ...overrides,
  };
}

describe("summaryFromRow", () => {
  it("maps a complete persisted report and retains duplicate row numbers", () => {
    const summary = summaryFromRow(persistedRow());

    expect(summary.status).toBe("completed");
    expect(summary.source.byteSize).toBe(123);
    expect(summary.report).toEqual(report);
    expect(summary.report?.duplicateRemovedRowNumbers).toEqual([3, 4]);
  });

  it.each([
    ["a missing row", null],
    ["an unknown status", persistedRow({ status: "corrupt" })],
    ["a negative byte size", persistedRow({ byte_size: -1 })],
    ["an invalid created timestamp", persistedRow({ created_at: "not-a-date" })],
    ["a malformed processing report", persistedRow({ report: { ...report, rawRows: -1 } })],
    ["malformed overall metrics", persistedRow({ overall_metrics: { ...overall, availabilityRatio: 2 } })],
    ["malformed service metrics", persistedRow({ services_metrics: [{ serviceId: "svc" }] })],
  ])("rejects %s", (_label, row) => {
    expect(() => summaryFromRow(row)).toThrow();
  });
});
