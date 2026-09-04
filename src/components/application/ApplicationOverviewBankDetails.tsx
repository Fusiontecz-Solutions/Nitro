import { useEffect } from "react";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "@/redux/store";
import { getBankDetails } from "@/redux/actions/bankDetailActions";
import ApplicationSheetBankDetail from "./ApplicationSheetBankDetail";

type ApplicationOverviewBankDetailsProps = {
    applicationId: string;
    className?: string;
};

export default function ApplicationOverviewBankDetails({
    applicationId,
    className,
}: ApplicationOverviewBankDetailsProps) {
    const dispatch = useDispatch<AppDispatch>();

    useEffect(() => {
        if (!applicationId) return;
        dispatch(getBankDetails({ application: applicationId }));
    }, [applicationId, dispatch]);

    return (
        <ApplicationSheetBankDetail
            applicationId={applicationId}
            variant="overview"
            className={className}
        />
    );
}
