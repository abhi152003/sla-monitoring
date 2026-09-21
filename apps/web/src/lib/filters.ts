import type { CheckStatus } from "@sla-monitoring/shared";

/** Date filtering modes. `all` applies no date restriction; single and range are mutually exclusive. */
export type DateMode = "all" | "single" | "range";

export type StatusFilter = "all" | CheckStatus;

/** Dashboard filter state for the health-check logs request; statistics always cover the whole dataset. */
export interface DashboardFilters {
  dateMode: DateMode;
  /** Single-date mode selection (`YYYY-MM-DD`); sent as `date`. */
  date: string | null;
  /** Range mode start (`YYYY-MM-DD`, inclusive); sent as `from`. */
  from: string | null;
  /** Range mode end (`YYYY-MM-DD`, inclusive); sent as `to`. */
  to: string | null;
  /** Service id, or null for all services; sent as `serviceId`. */
  serviceId: string | null;
  status: StatusFilter;
}

export const EMPTY_FILTERS: DashboardFilters = {
  dateMode: "all",
  date: null,
  from: null,
  to: null,
  serviceId: null,
  status: "all",
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value: string | null | undefined): value is string {
  return typeof value === "string" && ISO_DATE_PATTERN.test(value);
}

/**
 * Serializes filters into the Worker's documented query contract:
 * - `date` is never combined with `from`/`to` (single vs range modes are mutually exclusive).
 * - A range is sent only when both bounds are present; an incomplete range applies no date filter.
 * - `serviceId`/`status` are sent only when they narrow the result set.
 * - Pagination params are intentionally absent; only the checks caller appends them.
 */
export function buildFilterSearchParams(filters: DashboardFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.dateMode === "single" && isValidIsoDate(filters.date)) {
    params.set("date", filters.date);
  }
  if (filters.dateMode === "range" && isValidIsoDate(filters.from) && isValidIsoDate(filters.to)) {
    params.set("from", filters.from);
    params.set("to", filters.to);
  }
  if (filters.serviceId !== null && filters.serviceId.trim().length > 0) {
    params.set("serviceId", filters.serviceId);
  }
  if (filters.status !== "all") {
    params.set("status", filters.status);
  }

  return params;
}

/** Stable string form of the filter state for use in query keys. */
export function serializeFilters(filters: DashboardFilters): string {
  return JSON.stringify([
    filters.dateMode,
    filters.dateMode === "single" ? filters.date ?? null : null,
    filters.dateMode === "range" ? [filters.from ?? null, filters.to ?? null] : null,
    filters.serviceId,
    filters.status,
  ]);
}

/** True when range mode has one bound set but not both (blocked before apply with an inline hint). */
export function isIncompleteRange(filters: DashboardFilters): boolean {
  return filters.dateMode === "range" && isValidIsoDate(filters.from) !== isValidIsoDate(filters.to);
}

/** True when range mode bounds are both set but reversed. */
export function isReversedRange(filters: DashboardFilters): boolean {
  return (
    filters.dateMode === "range" &&
    isValidIsoDate(filters.from) &&
    isValidIsoDate(filters.to) &&
    filters.from > filters.to
  );
}
