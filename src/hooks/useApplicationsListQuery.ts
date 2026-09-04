import { useQuery } from "@tanstack/react-query";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "@/redux/store";
import { getApplications } from "@/redux/actions/applicationActions";
import type { GetApplicationsParams } from "@/types/applicationTypes";
import { listFetchKeyFromGetApplicationsParams } from "@/lib/applicationsListCache";
import { QUERY_STALE_TIME_MS } from "@/lib/queryDefaults";

type UseApplicationsListQueryOptions = {
  enabled?: boolean;
};

/**
 * React Query orchestrates list fetching while Redux remains the single source
 * of table data and loading/error state used by existing screens.
 */
export function useApplicationsListQuery(
  params: GetApplicationsParams,
  options: UseApplicationsListQueryOptions = {},
) {
  const dispatch = useDispatch<AppDispatch>();

  const fetchKey = listFetchKeyFromGetApplicationsParams(params);

  return useQuery({
    queryKey: ["applications-list", fetchKey],
    enabled: options.enabled ?? true,
    queryFn: async () => {
      // Redux updates via `getApplications.fulfilled` (requestId guard). Cached
      // list + HTTP GET cache serve instant revisits; mutations invalidate both.
      return dispatch(getApplications(params)).unwrap();
    },
    staleTime: QUERY_STALE_TIME_MS,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}
