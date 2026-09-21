"use client";

import { useState, type FormEvent } from "react";
import {
  EMPTY_FILTERS,
  isIncompleteRange,
  isReversedRange,
  type DashboardFilters,
  type DateMode,
} from "@/lib/filters";

const MODE_OPTIONS: Array<{ value: DateMode; label: string }> = [
  { value: "all", label: "All dates" },
  { value: "single", label: "Single date" },
  { value: "range", label: "Date range" },
];

const inputClassName =
  "h-9 w-full rounded-md border border-border bg-card px-3 text-sm text-card-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary";

/**
 * Draft-then-apply filters for the health-check logs: edits stay local until
 * "Apply filters" is pressed. The statistics above always cover the entire
 * dataset and are not affected by these filters. The parent remounts this
 * component (keyed by the applied filter state) whenever filters are applied
 * or cleared, so the draft always initializes from `applied`.
 */
export function LogsFilters({
  applied,
  serviceOptions,
  onApply,
}: {
  applied: DashboardFilters;
  serviceOptions: Array<{ id: string; name: string | null }>;
  onApply: (next: DashboardFilters) => void;
}) {
  const [draft, setDraft] = useState<DashboardFilters>(applied);
  const [fieldError, setFieldError] = useState<string | null>(null);

  function updateMode(mode: DateMode): void {
    setFieldError(null);
    setDraft((previous) => ({
      ...previous,
      dateMode: mode,
      // Single and range modes can never be active at the same time.
      date: mode === "single" ? previous.date : null,
      from: mode === "range" ? previous.from : null,
      to: mode === "range" ? previous.to : null,
    }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (isIncompleteRange(draft)) {
      setFieldError("Choose both the from and to dates, or switch the date filter back to all dates.");
      return;
    }
    if (isReversedRange(draft)) {
      setFieldError("The end date must be on or after the start date.");
      return;
    }
    setFieldError(null);
    onApply(draft);
  }

  function clearAll(): void {
    setFieldError(null);
    setDraft(EMPTY_FILTERS);
    onApply(EMPTY_FILTERS);
  }

  return (
    <section
      aria-labelledby="filters-heading"
      className="rounded-lg border border-border bg-card p-5 shadow-sm"
    >
      <h2 id="filters-heading" className="text-sm font-semibold text-card-foreground">
        Log filters
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Filters narrow the health-check logs below only — statistics always cover the entire
        dataset. Dates follow the Worker&apos;s UTC inclusive-day semantics.
      </p>

      <form onSubmit={onSubmit} noValidate>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label htmlFor="filter-date-mode" className="mb-1 block text-xs font-medium text-muted-foreground">
              Date filter
            </label>
            <select
              id="filter-date-mode"
              value={draft.dateMode}
              onChange={(event) => updateMode(event.target.value as DateMode)}
              className={inputClassName}
            >
              {MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {draft.dateMode === "single" ? (
            <div>
              <label htmlFor="filter-date" className="mb-1 block text-xs font-medium text-muted-foreground">
                Date (UTC)
              </label>
              <input
                id="filter-date"
                type="date"
                value={draft.date ?? ""}
                onChange={(event) => {
                  setFieldError(null);
                  setDraft((previous) => ({ ...previous, date: event.target.value || null }));
                }}
                className={inputClassName}
              />
            </div>
          ) : null}

          {draft.dateMode === "range" ? (
            <>
              <div>
                <label htmlFor="filter-from" className="mb-1 block text-xs font-medium text-muted-foreground">
                  From (UTC, inclusive)
                </label>
                <input
                  id="filter-from"
                  type="date"
                  value={draft.from ?? ""}
                  onChange={(event) => {
                    setFieldError(null);
                    setDraft((previous) => ({ ...previous, from: event.target.value || null }));
                  }}
                  className={inputClassName}
                />
              </div>
              <div>
                <label htmlFor="filter-to" className="mb-1 block text-xs font-medium text-muted-foreground">
                  To (UTC, inclusive)
                </label>
                <input
                  id="filter-to"
                  type="date"
                  value={draft.to ?? ""}
                  onChange={(event) => {
                    setFieldError(null);
                    setDraft((previous) => ({ ...previous, to: event.target.value || null }));
                  }}
                  className={inputClassName}
                />
              </div>
            </>
          ) : null}

          <div>
            <label htmlFor="filter-service" className="mb-1 block text-xs font-medium text-muted-foreground">
              Service
            </label>
            <select
              id="filter-service"
              value={draft.serviceId ?? ""}
              onChange={(event) => {
                setFieldError(null);
                setDraft((previous) => ({ ...previous, serviceId: event.target.value || null }));
              }}
              className={inputClassName}
            >
              <option value="">All services</option>
              {serviceOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name ?? option.id}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-status" className="mb-1 block text-xs font-medium text-muted-foreground">
              Status
            </label>
            <select
              id="filter-status"
              value={draft.status}
              onChange={(event) => {
                setFieldError(null);
                setDraft((previous) => ({
                  ...previous,
                  status: event.target.value as DashboardFilters["status"],
                }));
              }}
              className={inputClassName}
            >
              <option value="all">All</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
            </select>
          </div>
        </div>

        {fieldError ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {fieldError}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Apply filters
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-card-foreground hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Clear filters
          </button>
        </div>
      </form>
    </section>
  );
}
