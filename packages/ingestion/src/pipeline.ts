/** Validation -> invalid-observation removal -> duplicate collapse -> reconciliation, strictly in that order. */

import {
  classifyStatus,
  formatCanonical,
  INTEGER_STATUS_RE,
  isOnGrid,
  parseLatency,
  parseTimestamp,
  statusSeverity,
  type ParsedTimestamp,
  type TimestampForm,
} from "./normalize";
import type {
  CheckRecord,
  CheckStatus,
  InvalidObservation,
  RejectedRecord,
  RejectionReason,
} from "@sla-monitoring/shared";

export interface NormalizedObservation {
  rowNumber: number;
  serviceId: string;
  serviceName: string;
  timestamp: Date;
  timestampForm: TimestampForm;
  statusCode: number;
  latencyMs: number | null;
  latencyUnit: "ms" | "s";
  agent: string;
  region: string;
  values: Record<string, string>;
}

export interface InvalidObservationRow {
  rowNumber: number;
  values: Record<string, string>;
}

export type RowOutcome =
  | { kind: "valid"; observation: NormalizedObservation }
  | { kind: "invalid999"; row: InvalidObservationRow }
  | { kind: "rejected"; reason: RejectionReason };

export interface ServiceMappingResolution {
  authoritative: Map<string, string>;
  ambiguous: Set<string>;
}

/** Majority (service_id, service_name) mapping per service_id, computed from
 *  well-formed rows. Order-independent; an exact tie rejects all rows of that id. */
export function resolveServiceMappings(
  rows: { values: Record<string, string> }[],
): ServiceMappingResolution {
  const counts = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const sid = (row.values["service_id"] ?? "").trim();
    const sn = (row.values["service_name"] ?? "").trim();
    if (sid === "" || sn === "") continue;
    let perService = counts.get(sid);
    if (!perService) {
      perService = new Map();
      counts.set(sid, perService);
    }
    perService.set(sn, (perService.get(sn) ?? 0) + 1);
  }

  const authoritative = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const [sid, perService] of counts) {
    let bestName = "";
    let bestCount = -1;
    let tie = false;
    // Sort names so tie detection is independent of Map insertion order.
    const names = [...perService.keys()].sort();
    for (const name of names) {
      const c = perService.get(name)!;
      if (c > bestCount) {
        bestCount = c;
        bestName = name;
        tie = false;
      } else if (c === bestCount) {
        tie = true;
      }
    }
    if (tie) ambiguous.add(sid);
    else authoritative.set(sid, bestName);
  }
  return { authoritative, ambiguous };
}

function rowValues(fields: string[], header: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  header.forEach((name, i) => {
    if (!(name in values)) values[name] = fields[i] ?? "";
  });
  return values;
}

export interface ValidateRowInput {
  fields: string[];
  header: string[];
  rowNumber: number;
  mapping: ServiceMappingResolution;
  counters: {
    timestampConversions: Record<TimestampForm, number>;
    latencyConversions: { fromMs: number; fromSeconds: number };
  };
}

/** Validate and normalize one well-formed row. Field counters (status, unit,
 *  latency, timestamp) advance only when their own field converts. */
export function validateRow(input: ValidateRowInput): RowOutcome {
  const { fields, header, rowNumber, mapping, counters } = input;
  const values = rowValues(fields, header);

  const required: Array<[string, string]> = [
    ["service_id", values["service_id"] ?? ""],
    ["service_name", values["service_name"] ?? ""],
    ["timestamp", values["timestamp"] ?? ""],
    ["status_code", values["status_code"] ?? ""],
    ["latency_unit", values["latency_unit"] ?? ""],
    ["agent", values["agent"] ?? ""],
    ["region", values["region"] ?? ""],
  ];
  if (required.some(([, v]) => v.trim() === "")) {
    return { kind: "rejected", reason: "empty_required_field" };
  }

  const serviceId = values["service_id"];
  if (mapping.ambiguous.has(serviceId)) {
    return { kind: "rejected", reason: "ambiguous_service_mapping" };
  }
  if (mapping.authoritative.get(serviceId) !== values["service_name"]) {
    return { kind: "rejected", reason: "inconsistent_service_name" };
  }

  const statusRaw = (values["status_code"] ?? "").trim();
  if (!INTEGER_STATUS_RE.test(statusRaw)) {
    return { kind: "rejected", reason: "invalid_status_code" };
  }
  const statusCode = Number(statusRaw);
  const statusClass = classifyStatus(statusCode);
  if (statusClass === "unsupported") {
    return { kind: "rejected", reason: "invalid_status_code" };
  }

  const unitRaw = (values["latency_unit"] ?? "").trim();
  if (unitRaw !== "ms" && unitRaw !== "s") {
    return { kind: "rejected", reason: "invalid_latency_unit" };
  }
  const unit = unitRaw as "ms" | "s";

  const latency = parseLatency(values["latency"] ?? "", unit);
  if (!latency.ok) {
    return { kind: "rejected", reason: "invalid_latency" };
  }
  if (latency.latencyMs !== null) {
    if (unit === "ms") counters.latencyConversions.fromMs += 1;
    else counters.latencyConversions.fromSeconds += 1;
  }

  const parsedTs: ParsedTimestamp | null = parseTimestamp(values["timestamp"] ?? "");
  if (parsedTs) counters.timestampConversions[parsedTs.form] += 1;
  if (parsedTs === null || !isOnGrid(parsedTs.date)) {
    return { kind: "rejected", reason: "invalid_timestamp" };
  }

  if (statusClass === "invalid") {
    return { kind: "invalid999", row: { rowNumber, values } };
  }

  return {
    kind: "valid",
    observation: {
      rowNumber,
      serviceId,
      serviceName: values["service_name"],
      timestamp: parsedTs.date,
      timestampForm: parsedTs.form,
      statusCode,
      latencyMs: latency.latencyMs,
      latencyUnit: unit,
      agent: values["agent"],
      region: values["region"],
      values,
    },
  };
}

/** Post-normalization exact-duplicate collapse; the first row of each group is kept. */
export function collapseDuplicates(
  observations: NormalizedObservation[],
): { deduped: NormalizedObservation[]; removedRowNumbers: number[] } {
  const seen = new Set<string>();
  const deduped: NormalizedObservation[] = [];
  const removedRowNumbers: number[] = [];
  for (const o of observations) {
    const key = [
      o.serviceId,
      o.serviceName,
      o.timestamp.getTime(),
      o.statusCode,
      o.latencyMs === null ? "null" : o.latencyMs.toFixed(2),
      o.agent,
      o.region,
    ].join("|");
    if (seen.has(key)) {
      removedRowNumbers.push(o.rowNumber);
      continue;
    }
    seen.add(key);
    deduped.push(o);
  }
  return { deduped, removedRowNumbers };
}

/** One record per (serviceId, timestamp). Representative: worst status, then
 *  highest non-null latency (null ranks lowest), then lexicographically smallest
 *  agent — so selection never depends on input order. */
export function reconcile(observations: NormalizedObservation[]): CheckRecord[] {
  // Nested map so records emit sorted by (serviceId, timestamp).
  const byService = new Map<string, Map<number, NormalizedObservation[]>>();
  for (const o of observations) {
    let byTime = byService.get(o.serviceId);
    if (!byTime) {
      byTime = new Map();
      byService.set(o.serviceId, byTime);
    }
    const key = o.timestamp.getTime();
    let group = byTime.get(key);
    if (!group) {
      group = [];
      byTime.set(key, group);
    }
    group.push(o);
  }

  const records: CheckRecord[] = [];
  for (const serviceId of [...byService.keys()].sort()) {
    const byTime = byService.get(serviceId)!;
    const times = [...byTime.keys()].sort((a, b) => a - b);
    for (const time of times) {
      const group = byTime.get(time)!;
      const representative = group
        .slice()
        .sort((a, b) => {
          const aRank = statusSeverity(a.statusCode);
          const bRank = statusSeverity(b.statusCode);
          if (aRank !== bRank) return bRank - aRank; // worse class first
          const aLat = a.latencyMs ?? Number.NEGATIVE_INFINITY;
          const bLat = b.latencyMs ?? Number.NEGATIVE_INFINITY;
          if (aLat !== bLat) return bLat - aLat; // higher latency first
          return a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0; // lex agent
        })[0];

      const lats = group
        .map((o) => o.latencyMs)
        .filter((l): l is number => l !== null);
      const maxLatency = lats.length > 0 ? Math.max(...lats) : null;

      const status: CheckStatus =
        classifyStatus(representative.statusCode) === "success" ? "success" : "failure";

      records.push({
        serviceId,
        serviceName: representative.serviceName,
        timestamp: formatCanonical(new Date(time)),
        statusCode: representative.statusCode,
        status,
        latencyMs: maxLatency,
        agent: representative.agent,
        region: representative.region,
        observationCount: group.length,
        sourceRowNumber: representative.rowNumber,
        observations: group
          .slice()
          .sort((a, b) => a.rowNumber - b.rowNumber)
          .map((o) => ({
            rowNumber: o.rowNumber,
            agent: o.agent,
            statusCode: o.statusCode,
            latencyMs: o.latencyMs,
          })),
      });
    }
  }
  return records;
}

export function toRejected(rowNumber: number, reason: RejectionReason, values: Record<string, string>): RejectedRecord {
  return { rowNumber, reason, values };
}

export function toInvalid(row: InvalidObservationRow): InvalidObservation {
  return { rowNumber: row.rowNumber, reason: "status_999", values: row.values };
}
