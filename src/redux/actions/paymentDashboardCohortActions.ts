import { createAsyncThunk } from '@reduxjs/toolkit';
import { executeApplicationsListFetch } from '@/redux/actions/applicationActions';
import { buildPaymentFundedCohortParams } from '@/lib/paymentDashboardFunded';
import type { GetApplicationsParams } from '@/types/applicationTypes';

export const fetchPaymentDashboardFundedDeals = createAsyncThunk(
    'paymentDashboardCohort/fetch',
    async (params: GetApplicationsParams | undefined, { rejectWithValue }) => {
        try {
            return await executeApplicationsListFetch(
                params ?? buildPaymentFundedCohortParams(),
            );
        } catch (error: unknown) {
            const err = error as { response?: { data?: { message?: string } }; message?: string };
            return rejectWithValue(
                err.response?.data?.message ||
                    err?.message ||
                    'Failed to load funded deals for payment dashboard',
            );
        }
    },
);
