/** Field normalization. Timestamps are parsed via regex + Date.UTC arithmetic —
 *  never Date.parse or locale constructors — so results are timezone-independent. */

export type TimestampForm = "isoUtc" | "isoOffset" | "epochSeconds" | "epochMilliseconds";

export interface ParsedTimestamp {
  date: Date;
  form: TimestampForm;
}

const ISO_UTC_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
const ISO_OFFSET_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-])(\d{2}):?(\d{2})$/;
const EPOCH_SECONDS_RE = /^\d{10}$/;
const EPOCH_MILLIS_RE = /^\d{13}$/;

function buildDate(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  // Date.UTC rolls invalid components over (Feb 30 -> Mar 2); reject instead.
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d ||
    date.getUTCHours() !== h ||
    date.getUTCMinutes() !== mi ||
    date.getUTCSeconds() !== s
  ) {
    return null;
  }
  return date;
}

function epochToDate(ms: number): Date | null {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getUTCFullYear();
  if (y < 1 || y > 9999) return null;
  return date;
}

/** Parse a timestamp in any supported form; null when invalid. */
export function parseTimestamp(raw: string): ParsedTimestamp | null {
  const t = raw.trim();

  let m = ISO_UTC_RE.exec(t);
  if (m) {
    const date = buildDate(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
    return date ? { date, form: "isoUtc" } : null;
  }

  m = ISO_OFFSET_RE.exec(t);
  if (m) {
    const base = buildDate(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
    if (!base) return null;
    const sign = m[7] === "+" ? 1 : -1;
    const oh = +m[8];
    const om = +m[9];
    if (oh > 23 || om > 59) return null;
    const offsetMs = sign * (oh * 60 + om) * 60_000;
    return { date: new Date(base.getTime() - offsetMs), form: "isoOffset" };
  }

  if (EPOCH_SECONDS_RE.test(t)) {
    const date = epochToDate(+t * 1000);
    return date ? { date, form: "epochSeconds" } : null;
  }

  if (EPOCH_MILLIS_RE.test(t)) {
    const date = epochToDate(+t);
    return date ? { date, form: "epochMilliseconds" } : null;
  }

  return null;
}

export function isOnGrid(date: Date): boolean {
  return date.getUTCMilliseconds() === 0 && date.getUTCSeconds() === 0 && date.getUTCMinutes() % 15 === 0;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

export function formatCanonical(date: Date): string {
  return (
    `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:00Z`
  );
}

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

export type LatencyResult =
  | { ok: true; latencyMs: number | null }
  | { ok: false };

/** Latency to milliseconds, 2-decimal precision. Empty -> null; invalid -> ok: false. */
export function parseLatency(value: string, unit: "ms" | "s"): LatencyResult {
  const v = value.trim();
  if (v === "") return { ok: true, latencyMs: null };
  if (!NUMERIC_RE.test(v)) return { ok: false };
  const x = Number(v);
  if (!Number.isFinite(x) || x < 0) return { ok: false };
  const ms = unit === "s" ? x * 1000 : x;
  return { ok: true, latencyMs: Math.round(ms * 100) / 100 };
}

export type StatusClass = "success" | "failure" | "invalid" | "unsupported";

/** 2xx/3xx -> success, 4xx/5xx -> failure, 999 -> invalid observation,
 *  anything else -> unsupported (rejected). */
export function classifyStatus(code: number): StatusClass {
  if (code === 999) return "invalid";
  const cls = Math.floor(code / 100);
  if (cls === 2 || cls === 3) return "success";
  if (cls === 4 || cls === 5) return "failure";
  return "unsupported";
}

const CLASS_RANK: Record<number, number> = { 2: 0, 3: 1, 4: 2, 5: 3 };

/** Worst-status key: class rank (2xx < 3xx < 4xx < 5xx), then higher code. Higher = worse. */
export function statusSeverity(code: number): [number, number] {
  return [CLASS_RANK[Math.floor(code / 100)], code];
}

export const INTEGER_STATUS_RE = /^\d+$/;
