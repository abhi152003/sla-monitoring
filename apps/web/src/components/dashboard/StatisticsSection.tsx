"use client";

import { useState } from "react";
import type { FilteredServiceStats, UploadStatsResponse } from "@sla-monitoring/shared";
import { describeError } from "@/lib/api/errors";
import { formatCount, formatLatencyMs, formatPercent, NOT_AVAILABLE } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MetricCard, type MetricTone } from "./MetricCard";
import { StatusBadge } from "./StatusBadge";

function slaStatusLabel(breached: boolean | null): string {
  if (breached === null) return NOT_AVAILABLE;
  return breached ? "Breached" : "Compliant";
}

function slaStatusTone(breached: boolean | null): MetricTone {
  if (breached === null) return "default";
  return breached ? "danger" : "success";
}

function ServiceCard({ service }: { service: FilteredServiceStats }) {
  const empty = service.validChecks === 0;
  const badge =
    service.breached === true ? (
      <StatusBadge tone="danger">Breached</StatusBadge>
    ) : service.breached === false ? (
      <StatusBadge tone="success">Compliant</StatusBadge>
    ) : (
      <StatusBadge tone="neutral">{empty ? "No valid checks" : NOT_AVAILABLE}</StatusBadge>
    );

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 truncate font-mono text-sm font-semibold text-card-foreground" title={service.serviceId}>
          {service.serviceName ?? service.serviceId}
        </p>
        {badge}
      </div>
      <p
        className={cn(
          "mt-3 font-mono text-2xl font-semibold tabular-nums",
          service.breached === true
            ? "text-danger"
            : service.breached === false
              ? "text-success"
              : "text-muted-foreground",
        )}
      >
        {formatPercent(service.availabilityPercent)}
      </p>
      <p className="text-xs text-muted-foreground">Availability</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Valid checks</dt>
          <dd className="font-mono tabular-nums">{formatCount(service.validChecks)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Failed</dt>
          <dd className="font-mono tabular-nums">{formatCount(service.failedChecks)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Avg latency</dt>
          <dd className="font-mono tabular-nums">{formatLatencyMs(service.avgLatencyMs)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">P95 latency</dt>
          <dd className="font-mono tabular-nums">{formatLatencyMs(service.p95LatencyMs)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function StatisticsSection({
  stats,
  isPending,
  isRefreshing,
  error,
  onRetry,
}: {
  stats: UploadStatsResponse | undefined;
  isPending: boolean;
  isRefreshing: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <section
      aria-labelledby="statistics-heading"
      className="rounded-lg border border-border bg-card shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="statistics-heading" className="text-sm font-semibold text-card-foreground">
            Statistics
          </h2>
          <span className="text-xs text-muted-foreground">Entire dataset</span>
          {stats?.partial ? <StatusBadge tone="warning">Partial range</StatusBadge> : null}
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
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="statistics-panel"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-card-foreground hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            className={cn("size-4 transition-transform", !open && "-rotate-90")}
          >
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {open ? "Collapse statistics" : "Expand statistics"}
        </button>
      </div>

      <div id="statistics-panel" className="px-5 py-4" hidden={!open}>
        {error && !stats ? (
          <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger">
            <p>{describeError(error)}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 rounded-md border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Retry
            </button>
          </div>
        ) : isPending && !stats ? (
          <div aria-busy="true" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-lg border border-border bg-surface" />
            ))}
          </div>
        ) : stats ? (
          <div className="space-y-5">
            {stats.partial ? (
              <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2.5 text-sm text-warning-foreground">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0"
                >
                  <path
                    d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Partial period — these statistics cover part of a calendar month. They do not
                represent a definitive monthly billing-credit decision.
              </p>
            ) : null}

            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Overall
              </h3>
              <dl className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Valid checks" value={formatCount(stats.overall.validChecks)} />
                <MetricCard label="Successful checks" value={formatCount(stats.overall.successfulChecks)} />
                <MetricCard
                  label="Failed checks"
                  value={formatCount(stats.overall.failedChecks)}
                  tone={stats.overall.failedChecks > 0 ? "danger" : "default"}
                />
                <MetricCard
                  label="Availability"
                  value={formatPercent(stats.overall.availabilityPercent)}
                  tone={
                    stats.overall.breached === true
                      ? "danger"
                      : stats.overall.breached === false
                        ? "success"
                        : "default"
                  }
                  hint="SLA target 99.9%"
                />
                <MetricCard
                  label="SLA status"
                  value={slaStatusLabel(stats.overall.breached)}
                  tone={slaStatusTone(stats.overall.breached)}
                  hint="Monthly target 99.9%"
                />
                <MetricCard label="Average latency" value={formatLatencyMs(stats.overall.avgLatencyMs)} />
                <MetricCard label="P95 latency" value={formatLatencyMs(stats.overall.p95LatencyMs)} />
                <MetricCard label="Latency samples" value={formatCount(stats.overall.latencySamples)} />
              </dl>
            </div>

            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Per service
              </h3>
              {stats.services.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  No services found in this dataset.
                </p>
              ) : (
                <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {stats.services.map((service) => (
                    <ServiceCard key={service.serviceId} service={service} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
