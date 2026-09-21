import {
  DEFAULT_CHECKS_PAGE,
  DEFAULT_CHECKS_PAGE_SIZE,
  MAX_CHECKS_PAGE_SIZE,
  MAX_SERVICE_ID_LENGTH,
  type CheckStatus,
  type SelectedCheckRange,
} from "@sla-monitoring/shared";

export interface CheckQuery {
  range: SelectedCheckRange;
  fromInclusive: Date | null;
  toExclusive: Date | null;
  page: number;
  pageSize: number;
}

export class InvalidQueryError extends Error {}

export function parseCheckQuery(params: URLSearchParams, paginated: boolean): CheckQuery {
  const date = scalar(params, "date");
  const from = scalar(params, "from");
  const to = scalar(params, "to");
  const serviceId = scalar(params, "serviceId");
  const statusValue = scalar(params, "status");
  const pageValue = scalar(params, "page");
  const pageSizeValue = scalar(params, "pageSize");

  const allowed = new Set(["date", "from", "to", "serviceId", "status", "page", "pageSize"]);
  for (const key of params.keys()) {
    if (!allowed.has(key)) throw new InvalidQueryError(`Unknown query parameter: ${key}.`);
  }
  if (!paginated && (pageValue !== null || pageSizeValue !== null)) {
    throw new InvalidQueryError("Pagination parameters are only valid for the checks endpoint.");
  }
  if (date !== null && (from !== null || to !== null)) {
    throw new InvalidQueryError("date cannot be combined with from or to.");
  }

  const parsedDate = date === null ? null : utcDay(date, "date");
  const parsedFrom = from === null ? null : utcDay(from, "from");
  const parsedTo = to === null ? null : utcDay(to, "to");
  if (parsedFrom !== null && parsedTo !== null && parsedFrom.getTime() > parsedTo.getTime()) {
    throw new InvalidQueryError("from must not be later than to.");
  }
  if (
    serviceId !== null &&
    (serviceId.trim().length === 0 || serviceId.length > MAX_SERVICE_ID_LENGTH)
  ) {
    throw new InvalidQueryError(`serviceId must contain 1-${MAX_SERVICE_ID_LENGTH} characters.`);
  }
  const status = parseStatus(statusValue);
  const page = paginated ? positiveInteger(pageValue, "page", DEFAULT_CHECKS_PAGE) : 1;
  const pageSize = paginated
    ? positiveInteger(pageSizeValue, "pageSize", DEFAULT_CHECKS_PAGE_SIZE)
    : DEFAULT_CHECKS_PAGE_SIZE;
  if (pageSize > MAX_CHECKS_PAGE_SIZE) {
    throw new InvalidQueryError(`pageSize must not exceed ${MAX_CHECKS_PAGE_SIZE}.`);
  }
  if (!Number.isSafeInteger((page - 1) * pageSize)) {
    throw new InvalidQueryError("page is too large for the selected pageSize.");
  }

  const fromInclusive = parsedDate ?? parsedFrom;
  const toExclusive = parsedDate !== null ? nextUtcDay(parsedDate) : parsedTo === null ? null : nextUtcDay(parsedTo);
  return {
    range: {
      date,
      from,
      to,
      fromInclusive: fromInclusive?.toISOString() ?? null,
      toExclusive: toExclusive?.toISOString() ?? null,
      serviceId,
      status,
    },
    fromInclusive,
    toExclusive,
    page,
    pageSize,
  };
}

function scalar(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  if (values.length > 1) throw new InvalidQueryError(`${key} may be provided only once.`);
  return values[0] ?? null;
}

function utcDay(value: string, field: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) throw new InvalidQueryError(`${field} must use YYYY-MM-DD.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const result = new Date(Date.UTC(year, month - 1, day));
  if (
    result.getUTCFullYear() !== year ||
    result.getUTCMonth() !== month - 1 ||
    result.getUTCDate() !== day
  ) {
    throw new InvalidQueryError(`${field} must be a valid calendar date.`);
  }
  return result;
}

function nextUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() + 1));
}

function parseStatus(value: string | null): CheckStatus | null {
  if (value === null) return null;
  if (value === "success" || value === "failure") return value;
  throw new InvalidQueryError("status must be success or failure.");
}

function positiveInteger(value: string | null, field: string, fallback: number): number {
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw new InvalidQueryError(`${field} must be a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new InvalidQueryError(`${field} is too large.`);
  return parsed;
}
