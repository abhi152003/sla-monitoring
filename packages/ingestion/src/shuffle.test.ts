import { describe, expect, it } from "vitest";
import { processMonitoringCsv } from "./index";
import type { IngestionSuccess } from "@sla-monitoring/shared";

const HEADER =
  "service_id,service_name,timestamp,status_code,latency,latency_unit,agent,region\n";

interface Row {
  service_id: string;
  service_name: string;
  timestamp: string;
  status_code: string;
  latency: string;
  latency_unit: string;
  agent: string;
  region: string;
}

function baseRow(overrides: Partial<Row> = {}): Row {
  return {
    service_id: "svc-a",
    service_name: "a-api",
    timestamp: "2025-04-10T00:00:00Z",
    status_code: "200",
    latency: "120",
    latency_unit: "ms",
    agent: "agent-1",
    region: "ap-south-1",
    ...overrides,
  };
}

function toCsv(rows: Row[]): string {
  return HEADER + rows.map((r) => Object.values(r).join(",")).join("\n") + "\n";
}

/** Deterministic PRNG (mulberry32) so shuffle tests are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Strip source-row audit fields: everything that legitimately depends on row order. */
function canonical(result: IngestionSuccess): unknown {
  const stripRecords = result.records.map((r) => ({
    ...r,
    sourceRowNumber: undefined,
    observations: r.observations
      .map((o) => ({ ...o, rowNumber: undefined }))
      .sort((a, b) =>
        a.agent !== b.agent
          ? a.agent < b.agent
            ? -1
            : 1
          : a.statusCode - b.statusCode || (a.latencyMs ?? -1) - (b.latencyMs ?? -1),
      ),
  }));
  return {
    outcome: result.outcome,
    records: stripRecords,
    services: result.services,
    months: result.months,
    overall: result.overall,
    report: {
      ...result.report,
      duplicateRemovedRowNumbers: undefined,
      fileName: undefined,
      rawRows: result.report.rawRows,
      validObservations: result.report.validObservations,
      invalidObservations: result.report.invalidObservations,
      rejectedRows: result.report.rejectedRows,
      duplicateRemovals: result.report.duplicateRemovals,
      reconciledIntervals: result.report.reconciledIntervals,
      missingLatencyObservations: result.report.missingLatencyObservations,
      timestampConversions: result.report.timestampConversions,
      latencyConversions: result.report.latencyConversions,
      lowTrust: result.report.lowTrust,
      countsByRejectionReason: result.report.countsByRejectionReason,
      countsByInvalidReason: result.report.countsByInvalidReason,
    },
    rejectedReasons: result.rejected.map((r) => r.reason).sort(),
    invalidReasons: result.invalidObservations.map((o) => o.reason).sort(),
  };
}

const fixtureRows: Row[] = [
  ...Array.from({ length: 96 }, (_, i) =>
    baseRow({
      timestamp: new Date(Date.UTC(2025, 3, 10) + i * 15 * 60_000).toISOString().replace(".000Z", "Z"),
    }),
  ),
  // A second agent double-reports some intervals.
  ...Array.from({ length: 10 }, (_, i) =>
    baseRow({
      timestamp: new Date(Date.UTC(2025, 3, 10, 0, i * 15)).toISOString().replace(".000Z", "Z"),
      agent: "agent-2",
      latency: "200",
    }),
  ),
  // Exact duplicates in mixed timestamp forms.
  baseRow({ timestamp: "2025-04-10T00:00:00Z" }),
  baseRow({ timestamp: "1744243200" }),
  baseRow({ timestamp: "2025-04-10T05:30:00+05:30" }),
  // An incident: consecutive 503s.
  ...Array.from({ length: 5 }, (_, i) =>
    baseRow({
      timestamp: new Date(Date.UTC(2025, 3, 11, 12, i * 15)).toISOString().replace(".000Z", "Z"),
      status_code: "503",
      latency: "900",
    }),
  ),
  // A 999 invalid observation.
  baseRow({
    timestamp: new Date(Date.UTC(2025, 3, 12, 6, 0)).toISOString().replace(".000Z", "Z"),
    status_code: "999",
  }),
  // A negative-latency rejection.
  baseRow({
    timestamp: new Date(Date.UTC(2025, 3, 12, 7, 0)).toISOString().replace(".000Z", "Z"),
    latency: "-5",
  }),
  // Missing latency.
  baseRow({
    timestamp: new Date(Date.UTC(2025, 4, 1, 0, 0)).toISOString().replace(".000Z", "Z"),
    latency: "",
  }),
  // A minority service_name mapping.
  baseRow({
    timestamp: new Date(Date.UTC(2025, 4, 2, 0, 0)).toISOString().replace(".000Z", "Z"),
    service_name: "a-typo",
  }),
  // A second service with seconds-latency.
  baseRow({
    service_id: "svc-b",
    service_name: "b-api",
    timestamp: "2025-04-10T00:00:00Z",
    latency: "0.5",
    latency_unit: "s",
  }),
];

describe("row-order independence", () => {
  it("produces identical canonical output for many shuffles", () => {
    const reference = processMonitoringCsv(toCsv(fixtureRows));
    if (!reference.ok) throw new Error("reference failed");
    const expected = canonical(reference);

    for (const seed of [1, 42, 777, 123456, 999983]) {
      const result = processMonitoringCsv(toCsv(shuffled(fixtureRows, seed)));
      if (!result.ok) throw new Error(`shuffle seed ${seed} failed`);
      expect(canonical(result), `seed ${seed}`).toEqual(expected);
    }
  });

  it("keeps audit source-row references consistent with file order (kept duplicate = first occurrence)", () => {
    const dupFirst = processMonitoringCsv(
      toCsv([baseRow(), baseRow({ timestamp: "1744243200" })]),
    );
    const dupSecond = processMonitoringCsv(
      toCsv([baseRow({ timestamp: "1744243200" }), baseRow()]),
    );
    if (!dupFirst.ok || !dupSecond.ok) throw new Error("failed");
    // Same canonical record either way.
    expect(dupFirst.records[0]).toEqual({
      ...dupSecond.records[0],
      sourceRowNumber: 2,
      observations: [{ ...dupSecond.records[0].observations[0], rowNumber: 2 }],
    });
    expect(dupFirst.records[0].sourceRowNumber).toBe(2);
    expect(dupSecond.records[0].sourceRowNumber).toBe(2);
  });
});
