import { describe, expect, it } from "vitest";
import { processMonitoringCsv } from "./index";
import { collapseDuplicates, reconcile, resolveServiceMappings, type NormalizedObservation } from "./pipeline";
import type { RejectionReason } from "@sla-monitoring/shared";

const HEADER =
  "service_id,service_name,timestamp,status_code,latency,latency_unit,agent,region\n";

function row(overrides: Record<string, string> = {}): string {
  const base: Record<string, string> = {
    service_id: "svc-a",
    service_name: "a-api",
    timestamp: "2025-04-10T00:00:00Z",
    status_code: "200",
    latency: "100",
    latency_unit: "ms",
    agent: "agent-1",
    region: "ap-south-1",
  };
  const merged = { ...base, ...overrides };
  return Object.values(merged).join(",");
}

function csv(...rows: string[]): string {
  return HEADER + rows.join("\n") + "\n";
}

function rejectionReasons(input: string): RejectionReason[] {
  const r = processMonitoringCsv(input);
  if (!r.ok) throw new Error(`unexpected file error: ${r.error.code}`);
  return r.rejected.map((x) => x.reason);
}

describe("file-level outcomes", () => {
  it("rejects an empty file", () => {
    const r = processMonitoringCsv("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("empty_file");
  });
  it("rejects a whitespace-only file", () => {
    const r = processMonitoringCsv("   \n\n ");
    expect(!r.ok && r.error.code).toBe("empty_file");
  });
  it("rejects a header-only file", () => {
    const r = processMonitoringCsv(HEADER);
    expect(!r.ok && r.error.code).toBe("header_only");
  });
  it("rejects a file missing required columns and lists all of them", () => {
    const r = processMonitoringCsv("service_id,timestamp\nsvc-a,2025-04-10T00:00:00Z\n");
    expect(!r.ok && r.error.code).toBe("missing_columns");
    if (!r.ok) {
      expect(r.error.missingColumns).toEqual([
        "service_name",
        "status_code",
        "latency",
        "latency_unit",
        "agent",
        "region",
      ]);
    }
  });
  it("accepts reordered headers and extra columns", () => {
    const header = "region,extra,timestamp,latency,service_id,agent,status_code,latency_unit,service_name\n";
    const r = processMonitoringCsv(
      header +
        "ap-south-1,x,2025-04-10T00:00:00Z,100,svc-a,agent-1,200,ms,a-api\n",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.records).toHaveLength(1);
      expect(r.records[0].serviceName).toBe("a-api");
    }
  });
  it("rejects duplicate required header names", () => {
    const dup = "service_id,service_name,timestamp,status_code,latency,latency_unit,agent,region,timestamp\n";
    const r = processMonitoringCsv(dup + row() + ",2025-04-10T00:15:00Z\n");
    expect(!r.ok && r.error.code).toBe("duplicate_required_headers");
    if (!r.ok) expect(r.error.duplicateColumns).toEqual(["timestamp"]);
  });
  it("rejects malformed CSV syntax (unterminated quote)", () => {
    const r = processMonitoringCsv(HEADER + '"svc-a,a-api\n');
    expect(!r.ok && r.error.code).toBe("malformed_csv");
  });
  it("accepts bytes as input", () => {
    const r = processMonitoringCsv(new TextEncoder().encode(csv(row())));
    expect(r.ok && r.records).toHaveLength(1);
  });
});

describe("row-level validation", () => {
  it("rejects rows with a wrong field count as malformed_row with row number and original values", () => {
    const r = processMonitoringCsv(HEADER + row() + "\nsvc-a,a-api,oops\n");
    if (!r.ok) throw new Error("expected ok");
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].rowNumber).toBe(3);
    expect(r.rejected[0].reason).toBe("malformed_row");
    expect(r.rejected[0].values.service_id).toBe("svc-a");
  });

  it("rejects empty required fields but allows empty latency", () => {
    expect(rejectionReasons(csv(row({ latency: "" })))).toEqual([]);
    expect(rejectionReasons(csv(row({ agent: "" })))).toEqual(["empty_required_field"]);
    expect(rejectionReasons(csv(row({ service_name: "" })))).toEqual(["empty_required_field"]);
  });

  it("rejects bad status codes (non-integer or unsupported class)", () => {
    expect(rejectionReasons(csv(row({ status_code: "200.5" })))).toEqual(["invalid_status_code"]);
    expect(rejectionReasons(csv(row({ status_code: "abc" })))).toEqual(["invalid_status_code"]);
    expect(rejectionReasons(csv(row({ status_code: "100" })))).toEqual(["invalid_status_code"]);
    expect(rejectionReasons(csv(row({ status_code: "600" })))).toEqual(["invalid_status_code"]);
  });

  it("rejects bad latency units and invalid latency", () => {
    expect(rejectionReasons(csv(row({ latency_unit: "us" })))).toEqual(["invalid_latency_unit"]);
    expect(rejectionReasons(csv(row({ latency: "-1" })))).toEqual(["invalid_latency"]);
    expect(rejectionReasons(csv(row({ latency: "NaN" })))).toEqual(["invalid_latency"]);
  });

  it("rejects off-grid and invalid timestamps", () => {
    expect(rejectionReasons(csv(row({ timestamp: "2025-04-10T00:07:00Z" })))).toEqual([
      "invalid_timestamp",
    ]);
    expect(rejectionReasons(csv(row({ timestamp: "2025-02-30T00:00:00Z" })))).toEqual([
      "invalid_timestamp",
    ]);
  });

  it("routes 999 to invalid observations, not rejections", () => {
    const r = processMonitoringCsv(csv(row({ status_code: "999" })));
    if (!r.ok) throw new Error("expected ok");
    expect(r.rejected).toHaveLength(0);
    expect(r.invalidObservations).toHaveLength(1);
    expect(r.invalidObservations[0].reason).toBe("status_999");
    expect(r.report.countsByInvalidReason).toEqual({ status_999: 1 });
  });
});

describe("service mapping", () => {
  it("keeps the majority mapping and rejects minority rows as inconsistent_service_name", () => {
    const rows = [
      row({ timestamp: "2025-04-10T00:00:00Z" }),
      row({ timestamp: "2025-04-10T00:15:00Z", service_name: "a-typo" }),
      row({ timestamp: "2025-04-10T00:30:00Z" }),
    ];
    const r = processMonitoringCsv(csv(...rows));
    if (!r.ok) throw new Error("expected ok");
    expect(r.rejected.map((x) => x.reason)).toEqual(["inconsistent_service_name"]);
    expect(r.records).toHaveLength(2);
  });

  it("rejects every row for a service_id when mappings tie exactly", () => {
    const rows = [
      row({ service_name: "a-api", timestamp: "2025-04-10T00:00:00Z" }),
      row({ service_name: "a-alt", timestamp: "2025-04-10T00:15:00Z" }),
    ];
    const r = processMonitoringCsv(csv(...rows));
    if (!r.ok) throw new Error("expected ok");
    expect(r.rejected.map((x) => x.reason)).toEqual([
      "ambiguous_service_mapping",
      "ambiguous_service_mapping",
    ]);
    expect(r.outcome).toBe("no_valid_intervals");
  });

  it("is deterministic regardless of row order", () => {
    const rowsA = [
      row({ service_name: "a-api", timestamp: "2025-04-10T00:00:00Z" }),
      row({ service_name: "a-alt", timestamp: "2025-04-10T00:15:00Z" }),
      row({ service_name: "a-alt", timestamp: "2025-04-10T00:30:00Z" }),
    ];
    const rowsB = [...rowsA].reverse();
    const a = processMonitoringCsv(csv(...rowsA));
    const b = processMonitoringCsv(csv(...rowsB));
    if (!a.ok || !b.ok) throw new Error("expected ok");
    // a-alt is the majority in both orders; the a-api row is rejected in both.
    expect(a.rejected).toHaveLength(1);
    expect(b.rejected).toHaveLength(1);
    expect(a.records).toHaveLength(2);
    expect(b.records).toHaveLength(2);
  });

  it("resolveServiceMappings ignores rows with empty id or name", () => {
    const res = resolveServiceMappings([
      { values: { service_id: "", service_name: "x" } },
      { values: { service_id: "svc", service_name: "" } },
    ]);
    expect(res.authoritative.size).toBe(0);
    expect(res.ambiguous.size).toBe(0);
  });
});

describe("duplicate collapse", () => {
  it("collapses post-normalization duplicates across timestamp forms and keeps the first row", () => {
    const rows = [
      row({ timestamp: "2025-04-10T00:00:00Z" }), // row 2 (kept)
      row({ timestamp: "1744243200" }), // row 3: same instant as epoch seconds
      row({ timestamp: "2025-04-10T05:30:00+05:30" }), // row 4: same instant as offset
    ];
    const r = processMonitoringCsv(csv(...rows));
    if (!r.ok) throw new Error("expected ok");
    expect(r.records).toHaveLength(1);
    expect(r.records[0].sourceRowNumber).toBe(2);
    expect(r.report.duplicateRemovals).toBe(2);
    expect(r.report.duplicateRemovedRowNumbers).toEqual([3, 4]);
  });

  it("does not collapse rows that differ in any normalized field", () => {
    const rows = [
      row({ timestamp: "2025-04-10T00:00:00Z", agent: "agent-1" }),
      row({ timestamp: "2025-04-10T00:00:00Z", agent: "agent-2" }),
    ];
    const r = processMonitoringCsv(csv(...rows));
    if (!r.ok) throw new Error("expected ok");
    expect(r.report.duplicateRemovals).toBe(0);
  });

  it("treats null and 0 latency as different observations", () => {
    const a: NormalizedObservation[] = [
      {
        rowNumber: 1,
        serviceId: "s",
        serviceName: "n",
        timestamp: new Date(Date.UTC(2025, 3, 10)),
        timestampForm: "isoUtc",
        statusCode: 200,
        latencyMs: null,
        latencyUnit: "ms",
        agent: "agent-1",
        region: "r",
        values: {},
      },
      {
        rowNumber: 2,
        serviceId: "s",
        serviceName: "n",
        timestamp: new Date(Date.UTC(2025, 3, 10)),
        timestampForm: "isoUtc",
        statusCode: 200,
        latencyMs: 0,
        latencyUnit: "ms",
        agent: "agent-1",
        region: "r",
        values: {},
      },
    ];
    expect(collapseDuplicates(a).deduped).toHaveLength(2);
  });
});

describe("reconciliation", () => {
  function obs(n: number, code: number, lat: number | null, agent: string): NormalizedObservation {
    return {
      rowNumber: n,
      serviceId: "svc",
      serviceName: "svc-api",
      timestamp: new Date(Date.UTC(2025, 3, 10, 0, 0)),
      timestampForm: "isoUtc",
      statusCode: code,
      latencyMs: lat,
      latencyUnit: "ms",
      agent,
      region: "ap-south-1",
      values: {},
    };
  }

  it("worst valid status wins: 200 + 500 -> failure", () => {
    const rec = reconcile([obs(1, 200, 100, "agent-1"), obs(2, 500, 900, "agent-2")]);
    expect(rec).toHaveLength(1);
    expect(rec[0].status).toBe("failure");
    expect(rec[0].statusCode).toBe(500);
    expect(rec[0].observationCount).toBe(2);
  });

  it("a 999 never outvotes a real response: it is removed before reconciliation", () => {
    const r = processMonitoringCsv(
      csv(
        row({ timestamp: "2025-04-10T00:00:00Z", status_code: "999" }),
        row({ timestamp: "2025-04-10T00:00:00Z", agent: "agent-2" }),
      ),
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.records).toHaveLength(1);
    expect(r.records[0].status).toBe("success");
    expect(r.records[0].observationCount).toBe(1);
  });

  it("same-status ties resolve by highest latency", () => {
    const rec = reconcile([obs(1, 200, 100, "agent-1"), obs(2, 200, 300, "agent-2")]);
    expect(rec[0].agent).toBe("agent-2");
    expect(rec[0].latencyMs).toBe(300);
  });

  it("full ties resolve by lexicographically smallest agent", () => {
    const rec = reconcile([obs(1, 200, 100, "agent-2"), obs(2, 200, 100, "agent-1")]);
    expect(rec[0].agent).toBe("agent-1");
    // sourceRowNumber differs by input order but canonical fields are identical.
    expect(rec[0].sourceRowNumber).toBe(2);
  });

  it("null latency ranks below any non-null latency in selection", () => {
    const rec = reconcile([obs(1, 200, null, "agent-1"), obs(2, 200, 5, "agent-2")]);
    expect(rec[0].agent).toBe("agent-2");
    expect(rec[0].latencyMs).toBe(5);
  });

  it("all-null latencies keep null and fall through to the agent tie-break", () => {
    const rec = reconcile([obs(1, 503, null, "agent-2"), obs(2, 503, null, "agent-1")]);
    expect(rec[0].latencyMs).toBeNull();
    expect(rec[0].agent).toBe("agent-1");
  });

  it("interval latency is the max across observations even when the representative is another observation", () => {
    const rec = reconcile([obs(1, 500, 900, "agent-1"), obs(2, 200, 50, "agent-2")]);
    expect(rec[0].statusCode).toBe(500); // representative from worst status
    expect(rec[0].latencyMs).toBe(900); // max latency
  });

  it("emits records sorted by (serviceId, timestamp)", () => {
    const r = processMonitoringCsv(
      csv(
        row({ timestamp: "2025-04-10T00:15:00Z" }),
        row({ service_id: "svc-b", service_name: "b-api", timestamp: "2025-04-10T00:00:00Z" }),
        row({ timestamp: "2025-04-10T00:00:00Z" }),
      ),
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.records.map((x) => `${x.serviceId}@${x.timestamp}`)).toEqual([
      "svc-a@2025-04-10T00:00:00Z",
      "svc-a@2025-04-10T00:15:00Z",
      "svc-b@2025-04-10T00:00:00Z",
    ]);
  });
});

describe("no-valid-intervals outcome", () => {
  it("returns a typed outcome with null metrics and a full report", () => {
    const r = processMonitoringCsv(csv(row({ status_code: "999" })));
    if (!r.ok) throw new Error("expected ok");
    expect(r.outcome).toBe("no_valid_intervals");
    expect(r.records).toHaveLength(0);
    expect(r.overall.availabilityRatio).toBeNull();
    expect(r.overall.availabilityPercent).toBeNull();
    expect(r.overall.breached).toBeNull();
    expect(r.overall.avgLatencyMs).toBeNull();
    expect(r.overall.p95LatencyMs).toBeNull();
    expect(r.report.invalidObservations).toBe(1);
    expect(r.report.dateRange.start).toBeNull();
  });
});
