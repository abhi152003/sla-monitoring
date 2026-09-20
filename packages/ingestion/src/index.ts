/** Process a monitoring CSV into reconciled records, metrics, and a report. */

import { parseCsv, stripBom, CsvSyntaxError } from "./csv";
import {
  monthlyMetrics,
  overallMetrics,
  serviceMetrics,
} from "./metrics";
import {
  collapseDuplicates,
  reconcile,
  resolveServiceMappings,
  toInvalid,
  toRejected,
  validateRow,
  type InvalidObservationRow,
  type NormalizedObservation,
} from "./pipeline";
import {
  REQUIRED_COLUMNS,
  type FileError,
  type IngestionResult,
  type InvalidObservation,
  type InvalidObservationReason,
  type ProcessingReport,
  type RejectedRecord,
  type RejectionReason,
  type SourceMetadata,
  type TimestampConversionCounts,
} from "@sla-monitoring/shared";

export type {
  IngestionResult,
  IngestionSuccess,
  SourceMetadata,
  FileError,
  CheckRecord,
  RejectedRecord,
  InvalidObservation,
  ServiceMetrics,
  MonthlyMetrics,
  OverallMetrics,
  ProcessingReport,
} from "@sla-monitoring/shared";

const fileError = (error: FileError): { ok: false; error: FileError } => ({ ok: false, error });

export type ProcessCsvOptions = SourceMetadata;

/** Never throws for data problems — every failure is a typed value in the result. */
export function processMonitoringCsv(
  input: string | Uint8Array,
  options: ProcessCsvOptions = {},
): IngestionResult {
  const text =
    typeof input === "string" ? input : new TextDecoder("utf-8").decode(input);

  if (stripBom(text).trim() === "") {
    return fileError({ code: "empty_file", message: "The file is empty." });
  }

  let records: string[][];
  try {
    records = parseCsv(stripBom(text));
  } catch (e) {
    if (e instanceof CsvSyntaxError) {
      return fileError({ code: "malformed_csv", message: e.message });
    }
    throw e;
  }

  if (records.length === 0) {
    return fileError({ code: "empty_file", message: "The file contains no records." });
  }

  const header = records[0].map((h) => h.trim());
  const dataRows = records.slice(1);

  if (dataRows.length === 0) {
    return fileError({
      code: "header_only",
      message: "The file has a header but no data rows.",
    });
  }

  // All required columns must be present; extra columns are allowed.
  const missingColumns = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missingColumns.length > 0) {
    return fileError({
      code: "missing_columns",
      message: `Missing required columns: ${missingColumns.join(", ")}.`,
      missingColumns: [...missingColumns],
    });
  }

  // Duplicate required header names make row semantics ambiguous.
  const duplicated = REQUIRED_COLUMNS.filter((c) => header.indexOf(c) !== header.lastIndexOf(c));
  if (duplicated.length > 0) {
    return fileError({
      code: "duplicate_required_headers",
      message: `Required columns appear more than once: ${duplicated.join(", ")}.`,
      duplicateColumns: duplicated,
    });
  }

  const timestampConversions: TimestampConversionCounts = {
    isoUtc: 0,
    isoOffset: 0,
    epochSeconds: 0,
    epochMilliseconds: 0,
  };
  const latencyConversions = { fromMs: 0, fromSeconds: 0 };

  // Resolve the service_id -> service_name mapping from well-formed rows.
  const wellFormed = dataRows
    .map((fields, i) => ({ fields, rowNumber: i + 2 }))
    .filter(({ fields }) => fields.length === header.length)
    .map(({ fields, rowNumber }) => {
      const values: Record<string, string> = {};
      header.forEach((name, i) => {
        if (!(name in values)) values[name] = fields[i] ?? "";
      });
      return { rowNumber, values };
    });
  const mapping = resolveServiceMappings(wellFormed);

  const rejected: RejectedRecord[] = [];
  const invalid999: InvalidObservationRow[] = [];
  const valid: NormalizedObservation[] = [];

  dataRows.forEach((fields, index) => {
    const rowNumber = index + 2; // header is record 1

    if (fields.length !== header.length) {
      const values: Record<string, string> = {};
      header.forEach((name, i) => {
        if (!(name in values)) values[name] = fields[i] ?? "";
      });
      rejected.push(toRejected(rowNumber, "malformed_row", values));
      return;
    }

    const outcome = validateRow({
      fields,
      header,
      rowNumber,
      mapping,
      counters: { timestampConversions, latencyConversions },
    });
    if (outcome.kind === "valid") valid.push(outcome.observation);
    else if (outcome.kind === "invalid999") invalid999.push(outcome.row);
    else rejected.push(toRejected(rowNumber, outcome.reason, rowValuesOf(fields, header)));
  });

  // Duplicate collapse, then reconciliation.
  const { deduped, removedRowNumbers } = collapseDuplicates(valid);
  const checkRecords = reconcile(deduped);

  const invalidObservations: InvalidObservation[] = invalid999
    .map(toInvalid)
    .sort((a, b) => a.rowNumber - b.rowNumber);
  rejected.sort((a, b) => a.rowNumber - b.rowNumber);
  removedRowNumbers.sort((a, b) => a - b);

  const countsByRejectionReason: Partial<Record<RejectionReason, number>> = {};
  for (const r of rejected) {
    countsByRejectionReason[r.reason] = (countsByRejectionReason[r.reason] ?? 0) + 1;
  }
  const countsByInvalidReason: Partial<Record<InvalidObservationReason, number>> = {};
  for (const o of invalidObservations) {
    countsByInvalidReason[o.reason] = (countsByInvalidReason[o.reason] ?? 0) + 1;
  }

  const services = [...new Set(checkRecords.map((r) => r.serviceId))]
    .sort()
    .map((serviceId) => {
      const recs = checkRecords.filter((r) => r.serviceId === serviceId);
      return serviceMetrics(serviceId, recs[0]?.serviceName ?? "", recs);
    });

  const months = services.flatMap((svc) => {
    const recs = checkRecords.filter((r) => r.serviceId === svc.serviceId);
    const range =
      svc.rangeStart && svc.rangeEnd
        ? { startMs: Date.parse(svc.rangeStart), endMs: Date.parse(svc.rangeEnd) }
        : null;
    return monthlyMetrics(svc.serviceId, recs, range);
  });

  const rawRows = dataRows.length;
  const report: ProcessingReport = {
    fileName: options.fileName ?? null,
    rawRows,
    validObservations: deduped.length + removedRowNumbers.length,
    invalidObservations: invalidObservations.length,
    rejectedRows: rejected.length,
    duplicateRemovals: removedRowNumbers.length,
    duplicateRemovedRowNumbers: removedRowNumbers,
    reconciledIntervals: checkRecords.length,
    missingLatencyObservations: deduped.filter((o) => o.latencyMs === null).length,
    timestampConversions,
    latencyConversions,
    lowTrust: rejected.length > 0.05 * rawRows,
    dateRange: {
      start: checkRecords.length
        ? checkRecords.reduce((min, r) => (r.timestamp < min ? r.timestamp : min), checkRecords[0].timestamp)
        : null,
      end: checkRecords.length
        ? checkRecords.reduce((max, r) => (r.timestamp > max ? r.timestamp : max), checkRecords[0].timestamp)
        : null,
    },
    countsByRejectionReason,
    countsByInvalidReason,
  };

  return {
    ok: true,
    outcome: checkRecords.length > 0 ? "processed" : "no_valid_intervals",
    records: checkRecords,
    rejected,
    invalidObservations,
    services,
    months,
    overall: overallMetrics(checkRecords, services),
    report,
  };
}

function rowValuesOf(fields: string[], header: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  header.forEach((name, i) => {
    if (!(name in values)) values[name] = fields[i] ?? "";
  });
  return values;
}
