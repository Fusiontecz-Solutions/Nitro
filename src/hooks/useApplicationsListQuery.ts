import { useQuery } from "@tanstack/react-query";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "@/redux/store";
import { getApplications } from "@/redux/actions/applicationActions";
import type { GetApplicationsParams } from "@/types/applicationTypes";

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

  return useQuery({
    queryKey: ["applications-list", params],
    enabled: options.enabled ?? true,
    queryFn: async () => dispatch(getApplications(params)).unwrap(),
    staleTime: 60_000,
    /** Redux is cleared on remount; always refetch so we do not sit on loading with an empty slice. */
    refetchOnMount: "always",
  });
}
