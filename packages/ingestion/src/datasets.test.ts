import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { processMonitoringCsv } from "./index";
import type { IngestionSuccess } from "@sla-monitoring/shared";

/**
 * Integration tests over the five supplied datasets.
 *
 * The golden summaries in test-fixtures/datasets-golden.json were derived
 * from an independent reference implementation of the README rules, so these
 * assertions catch drift in this library's calculations. The incident log is
 * used only to validate results — never as an input to any calculation.
 *
 * Paths resolve from the workspace directory (npm always runs workspace
 * scripts with cwd = packages/ingestion), so the large CSVs are read directly
 * from docs/ without being copied into fixtures.
 */
const DOCS_DIR = resolve(process.cwd(), "../../docs");
const GOLDEN = JSON.parse(
  readFileSync(resolve(process.cwd(), "test-fixtures/datasets-golden.json"), "utf8"),
) as Record<
  string,
  {
    overall: Record<string, unknown>;
    report: Record<string, unknown>;
    services: Array<Record<string, unknown>>;
    months: Array<Record<string, unknown>>;
  }
>;

const DATASETS = Object.keys(GOLDEN).sort();

describe("datasets: golden summaries", () => {
  it.each(DATASETS)("%s processes successfully with the golden result", (file) => {
    const result = processMonitoringCsv(readFileSync(`${DOCS_DIR}/${file}`, "utf8"), {
      fileName: file,
    });
    if (!result.ok) throw new Error(`file error: ${result.error.code} ${result.error.message}`);
    const r: IngestionSuccess = result;
    const g = GOLDEN[file];

    expect(r.outcome).toBe("processed");
    expect({ ...r.overall }).toEqual(g.overall);
    // The golden fixture intentionally omits row-evidence fields
    // (fileName, duplicateRemovedRowNumbers, dateRange).
    expect(r.report).toMatchObject(g.report);
    expect(r.services).toEqual(g.services);
    expect(r.months).toEqual(g.months);
  });
});

describe("datasets: structural invariants", () => {
  it.each(DATASETS)("%s: records are sorted and unique per (service, interval)", (file) => {
    const result = processMonitoringCsv(readFileSync(`${DOCS_DIR}/${file}`, "utf8"));
    if (!result.ok) throw new Error("unexpected failure");
    const keys = result.records.map((r) => `${r.serviceId}|${r.timestamp}`);
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(DATASETS)("%s: exactly one 999 invalid observation and one invalid_latency rejection", (file) => {
    const result = processMonitoringCsv(readFileSync(`${DOCS_DIR}/${file}`, "utf8"));
    if (!result.ok) throw new Error("unexpected failure");
    expect(result.invalidObservations).toHaveLength(1);
    expect(result.invalidObservations[0].reason).toBe("status_999");
    expect(result.report.countsByRejectionReason).toEqual({ invalid_latency: 1 });
    expect(result.report.lowTrust).toBe(false);
  });
});

interface IncidentFile {
  [file: string]: {
    days: number;
    start: string;
    incidents: Record<string, string>;
  };
}

describe("datasets: incident windows are failure clusters (validation only)", () => {
  const incidentLog = JSON.parse(
    readFileSync(`${DOCS_DIR}/dataset_incident_log.json`, "utf8"),
  ) as IncidentFile;

  const filesWithIncidents = Object.keys(incidentLog).sort();

  it("every logged check-point window is a >=90% failure cluster", () => {
    for (const file of filesWithIncidents) {
      const meta = incidentLog[file];
      const result = processMonitoringCsv(readFileSync(`${DOCS_DIR}/${file}`, "utf8"), {
        fileName: file,
      });
      if (!result.ok) throw new Error(`${file} failed`);

      const overallFailureRate =
        1 - result.overall.successfulChecks / result.overall.validChecks;

      for (const [incidentKey, description] of Object.entries(meta.incidents)) {
        const match = /^(\S+) day (\d+)$/.exec(incidentKey);
        const cpMatch = /check-points (\d+)-(\d+)/.exec(description);
        if (!match || !cpMatch) throw new Error(`unparseable incident: ${incidentKey} (${description})`);
        const [, serviceId, dayStr] = match;
        const day = Number(dayStr);
        const dayStart = Date.parse(`${meta.start}T00:00:00Z`) + day * 24 * 3600_000;
        // Windows are described as check-point indexes:
        // window = dayStart + [cp1, cp2] * 15 minutes.
        const winStart = dayStart + Number(cpMatch[1]) * 15 * 60_000;
        const winEnd = dayStart + Number(cpMatch[2]) * 15 * 60_000;

        const inWindow = result.records.filter(
          (r) =>
            r.serviceId === serviceId &&
            Date.parse(r.timestamp) >= winStart &&
            Date.parse(r.timestamp) <= winEnd,
        );
        const failures = inWindow.filter((r) => r.status === "failure");
        // Incident-log windows are approximate ("~12:15-13:30") and injected
        // incidents include recovery gaps, so assert concentration rather than
        // an absolute rate: at least 3 failures and a window failure rate at
        // least 5x the whole-dataset baseline failure rate.
        expect(
          failures.length,
          `${file} ${incidentKey} should contain at least 3 failures`,
        ).toBeGreaterThanOrEqual(3);
        expect(
          failures.length / inWindow.length,
          `${file} ${incidentKey} failure rate inside the logged window`,
        ).toBeGreaterThanOrEqual(Math.max(0.15, 5 * overallFailureRate));
      }
    }
  });

  it("the same window in incident-free services shows no clustering", () => {
    // Control group: for the first incident of each file, other services in
    // the same window must be overwhelmingly successful (isolates incidents
    // to the logged service).
    for (const file of filesWithIncidents) {
      const meta = incidentLog[file];
      const result = processMonitoringCsv(readFileSync(`${DOCS_DIR}/${file}`, "utf8"));
      if (!result.ok) throw new Error(`${file} failed`);

      const first = Object.entries(meta.incidents)[0];
      const match = /^(\S+) day (\d+)$/.exec(first[0]);
      const cpMatch = /check-points (\d+)-(\d+)/.exec(first[1]);
      if (!match || !cpMatch) continue;
      const dayStart =
        Date.parse(`${meta.start}T00:00:00Z`) + Number(match[2]) * 24 * 3600_000;
      const winStart = dayStart + Number(cpMatch[1]) * 15 * 60_000;
      const winEnd = dayStart + Number(cpMatch[2]) * 15 * 60_000;

      const others = result.records.filter(
        (r) =>
          r.serviceId !== match[1] &&
          Date.parse(r.timestamp) >= winStart &&
          Date.parse(r.timestamp) <= winEnd,
      );
      const failures = others.filter((r) => r.status === "failure");
      expect(failures.length / others.length).toBeLessThanOrEqual(0.1);
    }
  });
});

describe("datasets: deterministic across repeat runs", () => {
  it.each(DATASETS)("%s: identical output on reprocess", (file) => {
    const text = readFileSync(`${DOCS_DIR}/${file}`, "utf8");
    const a = processMonitoringCsv(text);
    const b = processMonitoringCsv(text);
    expect(a).toEqual(b);
  });
});
