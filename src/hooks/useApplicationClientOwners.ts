import { useEffect, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "@/redux/store";
import { getClientByClientId, getClientById } from "@/redux/actions/clientActions";
import type { OwnerDetail } from "@/types/clientTypes";
import {
    getClientFetchArg,
    getClientFetchKeyFromApplicationClient,
    resolveOwnersFromClientData,
} from "@/lib/clientOwners";

/**
 * Application list/cache payloads often include only the primary owner on `client.owner`.
 * Load full client detail so `owners[]` is available for overview / approval UIs.
 */
export function useApplicationClientOwners(applicationClient: unknown) {
    const dispatch = useDispatch<AppDispatch>();
    const { data: clientDetail, currentClientId } = useSelector(
        (state: RootState) => state.clientDetail,
    );

    const fetchKey = useMemo(
        () => getClientFetchKeyFromApplicationClient(applicationClient),
        [applicationClient],
    );
    const fetchArg = useMemo(() => getClientFetchArg(fetchKey), [fetchKey]);

    useEffect(() => {
        if (!fetchArg || !fetchKey) return;
        if (fetchKey.startsWith("clientId:")) {
            void dispatch(getClientByClientId(fetchArg));
            return;
        }
        void dispatch(getClientById(fetchArg));
    }, [dispatch, fetchArg, fetchKey]);

    const hasFullClientDetail = Boolean(
        clientDetail && fetchArg && currentClientId === fetchArg,
    );

    const ownerSourceClient = useMemo(() => {
        if (hasFullClientDetail && clientDetail) {
            return clientDetail;
        }
        return applicationClient;
    }, [hasFullClientDetail, clientDetail, applicationClient]);

    const owners: OwnerDetail[] = useMemo(
        () => resolveOwnersFromClientData(ownerSourceClient),
        [ownerSourceClient],
    );

    return { owners, ownerSourceClient, hasFullClientDetail };
}
