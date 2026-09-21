/** Explicit sentinel for metrics the server cannot compute — never rendered as a fabricated zero. */
export const NOT_AVAILABLE = "Not available";

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NOT_AVAILABLE;
  return `${value.toFixed(3)}%`;
}

export function formatLatencyMs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NOT_AVAILABLE;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ms`;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NOT_AVAILABLE;
  return value.toLocaleString("en-US");
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return NOT_AVAILABLE;
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes.toLocaleString("en-US", { maximumFractionDigits: 1 })} KB`;
  }
  return `${(kilobytes / 1024).toLocaleString("en-US", { maximumFractionDigits: 1 })} MB`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

/** Formats an ISO instant as an explicitly-UTC timestamp, e.g. `2025-05-08 14:30:00 UTC`. */
export function formatUtcTimestamp(iso: string | null | undefined): string {
  if (!iso) return NOT_AVAILABLE;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = [
    date.getUTCFullYear().toString(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
    pad2(date.getUTCHours()),
    pad2(date.getUTCMinutes()),
    pad2(date.getUTCSeconds()),
  ];
  return `${parts.slice(0, 3).join("-")} ${parts.slice(3).join(":")} UTC`;
}

/** Formats a persisted UTC instant or plain date for the normalized range footer. */
export function formatUtcDateOrTimestamp(value: string | null | undefined): string {
  if (!value) return NOT_AVAILABLE;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value} UTC`;
  return formatUtcTimestamp(value);
}
