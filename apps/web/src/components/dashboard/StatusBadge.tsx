import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "success" | "warning" | "danger" | "neutral";

const toneClasses: Record<BadgeTone, string> = {
  success: "border-success/30 bg-success-soft text-success",
  warning: "border-warning/40 bg-warning-soft text-warning-foreground",
  danger: "border-danger/30 bg-danger-soft text-danger",
  neutral: "border-border bg-surface text-muted-foreground",
};

const dotClasses: Record<BadgeTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-muted-foreground",
};

export function StatusBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
        toneClasses[tone],
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", dotClasses[tone])} />
      {children}
    </span>
  );
}
