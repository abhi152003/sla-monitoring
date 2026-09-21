"use client";

import {
  DEFAULT_CHECKS_PAGE_SIZE,
  MAX_CHECKS_PAGE_SIZE,
  type UploadChecksResponse,
} from "@sla-monitoring/shared";
import { describeError } from "@/lib/api/errors";
import { formatCount, formatLatencyMs, formatUtcTimestamp } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";

const PAGE_SIZE_OPTIONS = [25, 50, MAX_CHECKS_PAGE_SIZE].filter(
  (size, index, sizes) => size <= MAX_CHECKS_PAGE_SIZE && sizes.indexOf(size) === index,
);

const COLUMNS = [
  "Timestamp (UTC)",
  "Service",
  "HTTP status",
  "Result",
  "Latency",
  "Agent",
  "Region",
  "Observations",
  "Source row",
] as const;

export function LogsTable({
  data,
  isPending,
  isRefreshing,
  error,
  onRetry,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  data: UploadChecksResponse | undefined;
  isPending: boolean;
  isRefreshing: boolean;
  error: unknown;
  onRetry: () => void;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const pagination = data?.pagination;
  const rows = data?.checks ?? [];

  return (
    <section
      aria-labelledby="logs-heading"
      className="rounded-lg border border-border bg-card shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="logs-heading" className="text-sm font-semibold text-card-foreground">
            Health-check logs
          </h2>
          {isRefreshing ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
              <span
                aria-hidden="true"
                className="inline-block size-3.5 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-muted-foreground"
              />
              Refreshing…
            </span>
          ) : null}
        </div>
        <p role="status" aria-live="polite" className="font-mono text-xs tabular-nums text-muted-foreground">
          {data ? `${formatCount(pagination?.totalRecords ?? 0)} matching records` : "Loading records…"}
        </p>
      </div>

      <div className="px-5 py-4">
        {error && !data ? (
          <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger">
            <p>{describeError(error)}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 rounded-md border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Retry
            </button>
          </div>
        ) : isPending && !data ? (
          <div aria-busy="true" className="space-y-2">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="h-9 animate-pulse rounded-md bg-surface" />
            ))}
          </div>
        ) : data && rows.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-muted-foreground">
            No checks match the current filters.
          </p>
        ) : data ? (
          <div className="max-h-[32rem] overflow-auto rounded-md border border-border">
            <table className="min-w-[60rem] w-full border-collapse text-sm">
              <caption className="sr-only">
                Reconciled health-check records for the selected dataset and filters
              </caption>
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b border-border">
                  {COLUMNS.map((column) => (
                    <th
                      key={column}
                      scope="col"
                      className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((check) => (
                  <tr key={check.id} className="border-b border-border/60 last:border-0 even:bg-surface">
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs tabular-nums text-card-foreground">
                      {formatUtcTimestamp(check.timestamp)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span className="font-mono text-xs text-card-foreground" title={check.serviceId}>
                        {check.serviceName ?? check.serviceId}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-card-foreground">
                      {check.statusCode}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge tone={check.status === "success" ? "success" : "danger"}>
                        {check.status === "success" ? "Success" : "Failure"}
                      </StatusBadge>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs tabular-nums text-card-foreground">
                      {formatLatencyMs(check.latencyMs)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-card-foreground">{check.agent}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-card-foreground">{check.region}</td>
                    <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-card-foreground">
                      {formatCount(check.observationCount)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-card-foreground">
                      {check.sourceRowNumber}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {data && pagination ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <label htmlFor="page-size" className="text-xs text-muted-foreground">
              Rows per page
            </label>
            <select
              id="page-size"
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className="h-8 rounded-md border border-border bg-card px-2 text-xs text-card-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            >
              {[...new Set([pageSize, DEFAULT_CHECKS_PAGE_SIZE, ...PAGE_SIZE_OPTIONS])]
                .filter((size) => size <= MAX_CHECKS_PAGE_SIZE)
                .sort((a, b) => a - b)
                .map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <p className="font-mono text-xs tabular-nums text-muted-foreground">
              Page {formatCount(pagination.page)} of {formatCount(Math.max(pagination.totalPages, 1))}
            </p>
            <button
              type="button"
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={!pagination.hasPreviousPage}
              aria-label="Previous page"
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-card-foreground hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={!pagination.hasNextPage}
              aria-label="Next page"
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-card-foreground hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
