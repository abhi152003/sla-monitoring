import { describe, expect, it } from "vitest";
import { availabilityMetrics, monthlyMetrics, percentileNearestRank, serviceMetrics } from "./metrics";
import type { CheckRecord, MonthlyMetrics } from "@sla-monitoring/shared";

function rec(overrides: Partial<CheckRecord> = {}): CheckRecord {
  return {
    serviceId: "svc",
    serviceName: "svc-api",
    timestamp: "2025-04-10T00:00:00Z",
    statusCode: 200,
    status: "success",
    latencyMs: 100,
    agent: "agent-1",
    region: "ap-south-1",
    observationCount: 1,
    sourceRowNumber: 2,
    observations: [],
    ...overrides,
  };
}

describe("percentileNearestRank (p95 convention)", () => {
  it("returns null for no samples", () => {
    expect(percentileNearestRank([], 0.95)).toBeNull();
  });
  it("returns the only sample for n=1", () => {
    expect(percentileNearestRank([42], 0.95)).toBe(42);
  });
  it("uses 1-based nearest rank: n=20 -> 19th value", () => {
    const vals = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20
    expect(percentileNearestRank(vals, 0.95)).toBe(19);
  });
  it("n=19 -> ceil(18.05)=19th value (the maximum)", () => {
    const vals = Array.from({ length: 19 }, (_, i) => i + 1);
    expect(percentileNearestRank(vals, 0.95)).toBe(19);
  });
  it("n=100 -> 95th value", () => {
    const vals = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentileNearestRank(vals, 0.95)).toBe(95);
  });
  it("sorts before ranking", () => {
    expect(percentileNearestRank([20, 1, 15, 3], 0.95)).toBe(20);
  });
});

describe("availabilityMetrics", () => {
  it("computes N/D, percent (3dp), and breach flag", () => {
    const records = [
      ...Array.from({ length: 2877 }, () => rec()),
      ...Array.from({ length: 3 }, () => rec({ status: "failure", statusCode: 503 })),
    ];
    const m = availabilityMetrics(records);
    expect(m.validChecks).toBe(2880);
    expect(m.successfulChecks).toBe(2877);
    expect(m.availabilityPercent).toBe(99.896);
    expect(m.breached).toBe(true); // 3 failures breach a 2880-interval month
  });
  it("exactly 99.9% is NOT a breach (strict <)", () => {
    const records = [
      ...Array.from({ length: 999 }, () => rec()),
      rec({ status: "failure", statusCode: 500 }),
    ];
    const m = availabilityMetrics(records);
    expect(m.availabilityPercent).toBe(99.9);
    expect(m.breached).toBe(false);
  });
  it("2878/2880 is compliant, 2877/2880 is breached", () => {
    const mk = (fails: number) =>
      availabilityMetrics([
        ...Array.from({ length: 2880 - fails }, () => rec()),
        ...Array.from({ length: fails }, () => rec({ status: "failure" })),
      ]);
    expect(mk(2).breached).toBe(false);
    expect(mk(3).breached).toBe(true);
  });
  it("returns nulls (never NaN/0/Infinity) for empty input", () => {
    const m = availabilityMetrics([]);
    expect(m.availabilityRatio).toBeNull();
    expect(m.availabilityPercent).toBeNull();
    expect(m.breached).toBeNull();
    expect(m.avgLatencyMs).toBeNull();
    expect(m.p95LatencyMs).toBeNull();
    expect(m.latencySamples).toBe(0);
  });
  it("excludes null latencies from avg/p95", () => {
    const m = availabilityMetrics([
      rec({ latencyMs: null }),
      rec({ latencyMs: 200 }),
      rec({ latencyMs: 100 }),
    ]);
    expect(m.avgLatencyMs).toBe(150);
    expect(m.p95LatencyMs).toBe(200);
    expect(m.latencySamples).toBe(2);
  });
});

describe("serviceMetrics coverage", () => {
  const at = (day: number, minutes: number) =>
    `2025-04-${String(day).padStart(2, "0")}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00Z`;

  it("full grid -> 100% coverage, 0 missing", () => {
    const records = [rec({ timestamp: at(10, 0) }), rec({ timestamp: at(10, 15) }), rec({ timestamp: at(10, 30) })];
    const m = serviceMetrics("svc", "svc-api", records);
    expect(m.coveragePercent).toBe(100);
    expect(m.missingIntervals).toBe(0);
    expect(m.rangeStart).toBe(at(10, 0));
    expect(m.rangeEnd).toBe(at(10, 30));
  });

  it("gap in the middle -> coverage < 100 with missing intervals", () => {
    // 00:00, 00:30, 00:45 — the 00:15 interval is missing.
    const records = [rec({ timestamp: at(10, 0) }), rec({ timestamp: at(10, 30) }), rec({ timestamp: at(10, 45) })];
    const m = serviceMetrics("svc", "svc-api", records);
    expect(m.coveragePercent).toBe(75);
    expect(m.missingIntervals).toBe(1);
  });

  it("empty service -> null coverage/range", () => {
    const m = serviceMetrics("svc", "svc-api", []);
    expect(m.coveragePercent).toBeNull();
    expect(m.missingIntervals).toBeNull();
    expect(m.rangeStart).toBeNull();
  });
});

describe("monthlyMetrics", () => {
  function recordsFor(days: Array<[string, string]>): CheckRecord[] {
    return days.map(([ts, status]) =>
      rec({ timestamp: ts, status: status as CheckRecord["status"] }),
    );
  }

  it("flags partial months and keeps full months whole", () => {
    // Range spans exactly Apr 1 00:00 -> May 31 23:45 (both month edges).
    const recs = [
      ...recordsFor([
        ["2025-04-01T00:00:00Z", "success"],
        ["2025-04-30T23:45:00Z", "success"],
      ]),
      ...recordsFor([
        ["2025-05-01T00:00:00Z", "success"],
        ["2025-05-31T23:45:00Z", "failure"],
      ]),
    ];
    const range = {
      startMs: Date.parse("2025-04-01T00:00:00Z"),
      endMs: Date.parse("2025-05-31T23:45:00Z"),
    };
    const months: MonthlyMetrics[] = monthlyMetrics("svc", recs, range);
    const april = months.find((m) => m.month === "2025-04");
    const may = months.find((m) => m.month === "2025-05");
    expect(april?.partial).toBe(false); // range covers whole April
    expect(may?.partial).toBe(false); // range covers whole May
    expect(may?.validChecks).toBe(2);
    expect(may?.successfulChecks).toBe(1);
    expect(may?.breached).toBe(true);
  });

  it("a range starting mid-month marks that month partial", () => {
    const recs = recordsFor([
      ["2025-04-10T00:00:00Z", "success"],
      ["2025-04-11T00:00:00Z", "success"],
    ]);
    const range = {
      startMs: Date.parse("2025-04-10T00:00:00Z"),
      endMs: Date.parse("2025-04-11T00:00:00Z"),
    };
    const months = monthlyMetrics("svc", recs, range);
    expect(months).toHaveLength(1);
    expect(months[0].partial).toBe(true);
  });
});
