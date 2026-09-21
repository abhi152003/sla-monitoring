"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ApiClientError } from "@/lib/api/errors";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // One retry for transient failures; definitive API errors (non-retryable
            // ApiClientError) surface immediately instead of retrying pointlessly.
            retry: (failureCount, error) =>
              failureCount < 1 && !(error instanceof ApiClientError && !error.retryable),
            refetchOnWindowFocus: false,
            staleTime: 30_000,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
