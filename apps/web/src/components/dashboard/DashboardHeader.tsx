import { StatusBadge } from "./StatusBadge";

export type BackendHealthState = "checking" | "healthy" | "degraded" | "unreachable";

const HEALTH_PRESENTATION: Record<BackendHealthState, { tone: "success" | "warning" | "danger" | "neutral"; label: string }> = {
  checking: { tone: "neutral", label: "Checking service" },
  healthy: { tone: "success", label: "Service healthy" },
  degraded: { tone: "warning", label: "Service degraded" },
  unreachable: { tone: "danger", label: "Service unreachable" },
};

export function DashboardHeader({
  datasetFileName,
  health,
}: {
  datasetFileName: string | null;
  health: BackendHealthState;
}) {
  const healthPresentation = HEALTH_PRESENTATION[health];

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">SLA Monitoring Dashboard</h1>
            <p className="text-xs text-muted-foreground">Availability, SLA compliance, and health-check logs</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {datasetFileName ? (
            <span
              className="max-w-[16rem] truncate rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-xs text-muted-foreground"
              title={datasetFileName}
            >
              {datasetFileName}
            </span>
          ) : null}
          <StatusBadge tone={healthPresentation.tone}>{healthPresentation.label}</StatusBadge>
        </div>
      </div>
    </header>
  );
}
