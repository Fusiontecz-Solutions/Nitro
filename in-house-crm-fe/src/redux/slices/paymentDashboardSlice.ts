import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { PaymentDashboardData } from '@/types/paymentDashboardTypes';
import { getPaymentDashboard } from '../actions/paymentDashboardActions';

interface PaymentDashboardState {
  /** True only before the first successful load. */
  loading: boolean;
  /** Background refresh while keeping previous `data`. */
  isRefreshing: boolean;
  data: PaymentDashboardData | null;
  error: string | null;
  fetched: boolean;
}

const initialState: PaymentDashboardState = {
  loading: false,
  isRefreshing: false,
  data: null,
  error: null,
  fetched: false,
};

export const paymentDashboardSlice = createSlice({
  name: 'paymentDashboard',
  initialState,
  reducers: {
    clearPaymentDashboard: (state) => {
      state.data = null;
      state.error = null;
      state.fetched = false;
      state.loading = false;
      state.isRefreshing = false;
    },
    /** Session snapshot (sessionStorage) — restores cards before slow `/collection-payments/dashboard` returns. */
    hydratePaymentDashboardFromCache: (state, action: PayloadAction<PaymentDashboardData>) => {
      state.data = action.payload;
      state.fetched = true;
      state.loading = false;
      state.isRefreshing = false;
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(getPaymentDashboard.pending, (state) => {
        state.error = null;
        if (state.data) {
          state.isRefreshing = true;
        } else {
          state.loading = true;
        }
      })
      .addCase(getPaymentDashboard.fulfilled, (state, action) => {
        state.loading = false;
        state.isRefreshing = false;
        state.data = action.payload;
        state.fetched = true;
      })
      .addCase(getPaymentDashboard.rejected, (state, action) => {
        state.loading = false;
        state.isRefreshing = false;
        state.error = action.payload as string;
      });
  },
});

export const { clearPaymentDashboard, hydratePaymentDashboardFromCache } = paymentDashboardSlice.actions;
