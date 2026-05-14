import { createAsyncThunk } from '@reduxjs/toolkit';
import { axiosGet } from '../axios';

export interface ApplicationActivityLog {
  id: string;
  applicationId: string;
  userId: string | null;
  userName: string | null;
  userRole: string | null;
  actionType: string;
  actionDescription: string;
  previousStatus?: string | null;
  currentStatus: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export const getApplicationActivityLogs = createAsyncThunk(
  'applicationActivityLogs/getByApplication',
  async (applicationId: string | number, { rejectWithValue }) => {
    try {
      const response = await axiosGet(`/applications/${applicationId}/activity-logs`);
      return response.data;
    } catch (error: any) {
      console.error('Get application activity logs error:', error);
      return rejectWithValue(
        error.response?.data?.message || 'Failed to fetch application activity logs'
      );
    }
  }
);

