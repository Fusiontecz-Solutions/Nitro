import { createAsyncThunk } from '@reduxjs/toolkit';
import { executeApplicationsListFetch } from '@/redux/actions/applicationActions';
import { paymentFundedDealsListParams } from '@/lib/paymentDashboardFunded';

export const fetchPaymentDashboardFundedDeals = createAsyncThunk(
    'paymentDashboardCohort/fetch',
    async (_, { rejectWithValue }) => {
        try {
            return await executeApplicationsListFetch(paymentFundedDealsListParams());
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
