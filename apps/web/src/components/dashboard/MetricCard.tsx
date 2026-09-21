import { cn } from "@/lib/utils";

export type MetricTone = "default" | "success" | "warning" | "danger";

const toneClasses: Record<MetricTone, string> = {
  default: "text-card-foreground",
  success: "text-success",
  warning: "text-warning-foreground",
  danger: "text-danger",
};

export function MetricCard({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string;
  value: string;
  tone?: MetricTone;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1.5 font-mono text-xl font-semibold tabular-nums", toneClasses[tone])}>{value}</dd>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
