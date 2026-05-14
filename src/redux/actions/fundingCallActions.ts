import { createAsyncThunk } from '@reduxjs/toolkit';
import { axiosGet, axiosPost } from '../axios';

export interface CreateFundingCallPayload {
  application: string;
  callStatus: string;
  applicationStatus?: string | null;
  remarks?: string | null;
  followUpDate?: string | null; // MM/DD/YYYY
}

export interface GetFundingCallsParams {
  application?: string;
}

export const createFundingCall = createAsyncThunk(
  'fundingCall/create',
  async (data: CreateFundingCallPayload, { rejectWithValue }) => {
    try {
      const response = await axiosPost('/funding-calls', data);
      return response.data;
    } catch (error: any) {
      console.error('Create funding call error:', error);
      return rejectWithValue(
        error?.response?.data?.message || 'Failed to create funding call',
      );
    }
  },
);

export const getFundingCalls = createAsyncThunk(
  'fundingCall/getAll',
  async (params: GetFundingCallsParams = {}, { rejectWithValue }) => {
    try {
      const query = new URLSearchParams();
      if (params.application) query.append('application', params.application);
      const url = `/funding-calls${query.toString() ? `?${query.toString()}` : ''}`;
      const response = await axiosGet(url);
      return response.data;
    } catch (error: any) {
      console.error('Get funding calls error:', error);
      return rejectWithValue(
        error?.response?.data?.message || 'Failed to fetch funding calls',
      );
    }
  },
);


