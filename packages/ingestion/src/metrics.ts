/** Availability, coverage, latency percentiles, and UTC month grouping. */

import {
  formatCanonical,
} from "./normalize";
import type {
  AvailabilityMetrics,
  CheckRecord,
  MonthlyMetrics,
  OverallMetrics,
  ServiceMetrics,
} from "@sla-monitoring/shared";

export const SLA_RATIO = 0.999;

const round2 = (x: number) => Math.round(x * 100) / 100;
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Nearest-rank percentile: ascending sort, 1-based rank ceil(p * n). Empty -> null. */
export function percentileNearestRank(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  return round2(sorted[Math.min(Math.max(rank, 1), sorted.length) - 1]);
}

export function availabilityMetrics(records: CheckRecord[]): AvailabilityMetrics {
  const validChecks = records.length;
  const successfulChecks = records.filter((r) => r.status === "success").length;
  const availabilityRatio = validChecks > 0 ? successfulChecks / validChecks : null;
  const latencySamples = records.filter((r) => r.latencyMs !== null) as Array<{
    latencyMs: number;
  }>;
  const lats = latencySamples.map((r) => r.latencyMs as number);
  return {
    validChecks,
    successfulChecks,
    availabilityRatio,
    availabilityPercent: availabilityRatio === null ? null : round3(availabilityRatio * 100),
    breached: availabilityRatio === null ? null : availabilityRatio < SLA_RATIO,
    avgLatencyMs: lats.length > 0 ? round2(lats.reduce((a, b) => a + b, 0) / lats.length) : null,
    p95LatencyMs: percentileNearestRank(lats, 0.95),
    latencySamples: lats.length,
  };
}

const INTERVAL_MS = 15 * 60 * 1000;

export function serviceMetrics(
  serviceId: string,
  serviceName: string,
  records: CheckRecord[],
): ServiceMetrics {
  const base = availabilityMetrics(records);
  if (records.length === 0) {
    return {
      serviceId,
      serviceName,
      ...base,
      coveragePercent: null,
      missingIntervals: null,
      rangeStart: null,
      rangeEnd: null,
    };
  }
  const times = records.map((r) => Date.parse(`${r.timestamp}`));
  const lo = Math.min(...times);
  const hi = Math.max(...times);
  const expected = Math.floor((hi - lo) / INTERVAL_MS) + 1;
  return {
    serviceId,
    serviceName,
    ...base,
    coveragePercent: round3((records.length / expected) * 100),
    missingIntervals: expected - records.length,
    rangeStart: formatCanonical(new Date(lo)),
    rangeEnd: formatCanonical(new Date(hi)),
  };
}

function monthOf(timeMs: number): { year: number; month: number; key: string } {
  const d = new Date(timeMs);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  return { year, month, key: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}` };
}

function monthStartMs(year: number, month: number): number {
  return Date.UTC(year, month - 1, 1);
}

function monthEndMs(year: number, month: number): number {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return Date.UTC(nextYear, nextMonth - 1, 1) - INTERVAL_MS;
}

export function monthlyMetrics(
  serviceId: string,
  records: CheckRecord[],
  serviceRange: { startMs: number; endMs: number } | null,
): MonthlyMetrics[] {
  const byMonth = new Map<string, CheckRecord[]>();
  for (const r of records) {
    const { key } = monthOf(Date.parse(r.timestamp));
    let list = byMonth.get(key);
    if (!list) {
      list = [];
      byMonth.set(key, list);
    }
    list.push(r);
  }
  const out: MonthlyMetrics[] = [];
  for (const key of [...byMonth.keys()].sort()) {
    const list = byMonth.get(key)!;
    const [y, m] = key.split("-").map(Number);
    const partial =
      serviceRange === null ||
      !(serviceRange.startMs <= monthStartMs(y, m) && serviceRange.endMs >= monthEndMs(y, m));
    out.push({ serviceId, month: key, partial, ...availabilityMetrics(list) });
  }
  return out;
}

export function overallMetrics(records: CheckRecord[], services: ServiceMetrics[]): OverallMetrics {
  return {
    ...availabilityMetrics(records),
    services: services.length,
    intervals: records.length,
  };
}
