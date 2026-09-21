import type { UploadSummary } from "@sla-monitoring/shared";
import { formatCount, formatFileSize, formatUtcDateOrTimestamp } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";

interface SummaryStat {
  label: string;
  value: string;
}

export function ProcessingSummary({ summary }: { summary: UploadSummary }) {
  const report = summary.report;

  if (report === null) {
    return (
      <section
        aria-labelledby="processing-summary-heading"
        className="rounded-lg border border-border bg-card p-5 shadow-sm"
      >
        <h2 id="processing-summary-heading" className="text-sm font-semibold text-card-foreground">
          Processing summary
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The processing report is not available for this dataset.
        </p>
      </section>
    );
  }

  const stats: SummaryStat[] = [
    { label: "Raw rows", value: formatCount(report.rawRows) },
    { label: "Reconciled intervals", value: formatCount(report.reconciledIntervals) },
    { label: "Rejected rows", value: formatCount(report.rejectedRows) },
    { label: "Invalid observations", value: formatCount(report.invalidObservations) },
    { label: "Duplicates removed", value: formatCount(report.duplicateRemovals) },
    { label: "Missing latency values", value: formatCount(report.missingLatencyObservations) },
  ];

  return (
    <section
      aria-labelledby="processing-summary-heading"
      className="rounded-lg border border-border bg-card p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="processing-summary-heading" className="text-sm font-semibold text-card-foreground">
            Processing summary
          </h2>
          <p className="mt-1 min-w-0 truncate font-mono text-xs text-muted-foreground" title={report.fileName ?? undefined}>
            {report.fileName ?? "unknown file"}
            <span className="ml-2">({formatFileSize(summary.source.byteSize)})</span>
          </p>
        </div>
        {report.lowTrust ? (
          <StatusBadge tone="warning">Low trust — over 5% of rows rejected</StatusBadge>
        ) : (
          <StatusBadge tone="success">Trusted</StatusBadge>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-md border border-border bg-surface p-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{stat.label}</dt>
            <dd className="mt-1 font-mono text-sm font-semibold tabular-nums text-card-foreground">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 border-t border-border pt-3 font-mono text-xs text-muted-foreground">
        Normalized UTC range: {formatUtcDateOrTimestamp(report.dateRange.start)} to{" "}
        {formatUtcDateOrTimestamp(report.dateRange.end)}
      </p>
    </section>
  );
}
