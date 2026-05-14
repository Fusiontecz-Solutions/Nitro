import { createAsyncThunk } from '@reduxjs/toolkit';
import { axiosGet } from '../axios';

export interface ActivityLog {
  _id: string;
  user: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
  } | string;
  action: string;
  entity: string;
  entityId?: string;
  description?: string;
  ipAddress?: string;
  createdAt: string;
}

export interface GetActivityLogsParams {
  page?: number;
  limit?: number;
  search?: string;
  action?: string;
  entity?: string;
  userId?: string;
  startDate?: string;
  endDate?: string;
}

export const getActivityLogs = createAsyncThunk(
  'activityLogs/getAll',
  async (params: GetActivityLogsParams = {}, { rejectWithValue }) => {
    try {
      const queryParams = new URLSearchParams();
      if (params.page) queryParams.append('page', params.page.toString());
      if (params.limit) queryParams.append('limit', params.limit.toString());
      if (params.search) queryParams.append('search', params.search);
      if (params.action) queryParams.append('action', params.action);
      if (params.entity) queryParams.append('entity', params.entity);
      if (params.userId) queryParams.append('userId', params.userId);
      if (params.startDate) queryParams.append('startDate', params.startDate);
      if (params.endDate) queryParams.append('endDate', params.endDate);

      const url = `/activity-logs${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      const response = await axiosGet(url);
      return response.data;
    } catch (error: any) {
      console.error('Get activity logs error:', error);
      return rejectWithValue(
        error.response?.data?.message || 'Failed to fetch activity logs'
      );
    }
  }
);
