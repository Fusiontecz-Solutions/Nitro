import { createAsyncThunk } from '@reduxjs/toolkit';
import { axiosGet } from '../axios';

export interface DuplicateApplication {
  id: string;
  applicationId: number | null;
  businessName: string | null;
  agentName: string | null;
  submittedAt: string;
  status: string;
  fundedAmount: number | null;
  businessEinNumber?: string | null;
  ownerSsn?: string | null;
  matchWith?: string[];
}

export const getApplicationDuplicates = createAsyncThunk(
  'applications/getDuplicates',
  async (applicationId: string | number, { rejectWithValue }) => {
    try {
      const response = await axiosGet(`/applications/${applicationId}/duplicates`);
      return response.data;
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Failed to fetch duplicate applications';
      console.error('Get duplicate applications error:', message, error.response?.data);
      return rejectWithValue(message);
    }
  }
);

