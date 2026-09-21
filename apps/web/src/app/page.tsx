"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient, type PlaceholderDataFunction } from "@tanstack/react-query";
import { DEFAULT_CHECKS_PAGE_SIZE, type UploadSummary } from "@sla-monitoring/shared";
import { DashboardHeader, type BackendHealthState } from "@/components/dashboard/DashboardHeader";
import { LogsFilters } from "@/components/dashboard/LogsFilters";
import { LogsTable } from "@/components/dashboard/LogsTable";
import { ProcessingSummary } from "@/components/dashboard/ProcessingSummary";
import { StatisticsSection } from "@/components/dashboard/StatisticsSection";
import { UploadPanel } from "@/components/dashboard/UploadPanel";
import { fetchChecks, fetchHealth, fetchStats } from "@/lib/api/client";
import { EMPTY_FILTERS, serializeFilters, type DashboardFilters } from "@/lib/filters";

/**
 * Keep-previous-data placeholder that only carries content forward while the
 * selected dataset stays the same — filter/page refreshes keep the last good
 * content visible, but switching datasets starts from a clean pending state.
 */
function keepDataForSameUpload<T>(uploadId: string | null): PlaceholderDataFunction<T> {
  return (previousData, previousQuery) =>
    previousQuery?.queryKey[1] === uploadId ? previousData : undefined;
}

/**
 * Single-screen dashboard. There is no account system, so nothing persists
 * across navigations: the dashboard lives for the current page session and a
 * refresh returns to the empty upload state.
 */
export default function DashboardPage() {
  const queryClient = useQueryClient();

  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const [filters, setFilters] = useState<DashboardFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_CHECKS_PAGE_SIZE);

  const uploadId = summary?.id ?? null;
  const filterKey = useMemo(() => serializeFilters(filters), [filters]);

  // Statistics are a fixed whole-dataset view: filters below narrow only the logs.
  const statsQuery = useQuery({
    queryKey: ["stats", uploadId],
    queryFn: ({ signal }) => fetchStats(uploadId as string, signal),
    enabled: uploadId !== null,
    placeholderData: keepDataForSameUpload<UploadStatsResponseShape>(uploadId),
  });

  const checksQuery = useQuery({
    queryKey: ["checks", uploadId, filterKey, page, pageSize],
    queryFn: ({ signal }) => fetchChecks(uploadId as string, filters, page, pageSize, signal),
    enabled: uploadId !== null,
    placeholderData: keepDataForSameUpload<UploadChecksResponseShape>(uploadId),
  });

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: 60_000,
  });

  const health: BackendHealthState = healthQuery.isPending
    ? "checking"
    : healthQuery.isError
      ? "unreachable"
      : healthQuery.data?.status === "degraded"
        ? "degraded"
        : "healthy";

  const serviceOptions = useMemo(() => {
    const services = summary?.services ?? [];
    return services.map((service) => ({ id: service.serviceId, name: service.serviceName }));
  }, [summary]);

  const handleUploaded = useCallback(
    (upload: UploadSummary) => {
      setSummary(upload);
      setFilters(EMPTY_FILTERS);
      setPage(1);
      // A replay of a dataset already viewed this session may have cached reads.
      void queryClient.invalidateQueries({ queryKey: ["stats", upload.id] });
      void queryClient.invalidateQueries({ queryKey: ["checks", upload.id] });
    },
    [queryClient],
  );

  const applyFilters = useCallback((next: DashboardFilters) => {
    setFilters(next);
    setPage(1);
  }, []);

  const changePageSize = useCallback((size: number) => {
    setPageSize(size);
    setPage(1);
  }, []);

  let bodyContent: React.ReactNode;

  if (summary === null) {
    bodyContent = (
      <p className="rounded-lg border border-dashed border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
        Upload a monitoring CSV to see SLA statistics and health-check logs.
      </p>
    );
  } else {
    bodyContent = (
      <>
        <ProcessingSummary summary={summary} />
        {/* Keyed by upload id so a fresh dataset starts with statistics expanded. */}
        <StatisticsSection
          key={summary.id}
          stats={statsQuery.data}
          isPending={statsQuery.isPending}
          isRefreshing={statsQuery.isFetching && !statsQuery.isPending}
          error={statsQuery.error}
          onRetry={() => void statsQuery.refetch()}
        />
        {/* Keyed by the applied filters so a fresh draft starts from the applied values
            without a state-syncing effect. */}
        <LogsFilters key={filterKey} applied={filters} serviceOptions={serviceOptions} onApply={applyFilters} />
        <LogsTable
          data={checksQuery.data}
          isPending={checksQuery.isPending}
          isRefreshing={checksQuery.isFetching && !checksQuery.isPending}
          error={checksQuery.error}
          onRetry={() => void checksQuery.refetch()}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={changePageSize}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader datasetFileName={summary?.source.fileName ?? null} health={health} />
      <main className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <UploadPanel
          activeFileName={summary?.source.fileName ?? null}
          onUploaded={handleUploaded}
        />
        {bodyContent}
      </main>
    </div>
  );
}

// Aliases keep the placeholder helpers above readable.
type UploadStatsResponseShape = Awaited<ReturnType<typeof fetchStats>>;
type UploadChecksResponseShape = Awaited<ReturnType<typeof fetchChecks>>;
