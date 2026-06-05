import { QUERY_STALE_TIME_MS } from "@/lib/querySyncConstants";

/** Default React Query options — fewer background refetches app-wide. */
export const defaultQueryOptions = {
  queries: {
    staleTime: QUERY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    retry: 1,
  },
} as const;
