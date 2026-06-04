import { createAsyncThunk } from '@reduxjs/toolkit';
import { axiosGet, axiosPost, axiosPut, axiosDelete } from '../axios';
import type {
    CreatePositionPayload,
    UpdatePositionPayload,
    GetPositionsParams,
} from '@/types/positionTypes';

// Create a new position
export const createPosition = createAsyncThunk(
    'position/create',
    async (data: CreatePositionPayload, { rejectWithValue }) => {
        try {
            const response = await axiosPost('/positions', data);
            return response.data;
        } catch (error: any) {
            console.error('Create position error:', error);
            return rejectWithValue(
                error.response?.data?.message || 'Failed to create position'
            );
        }
    }
);

// Get all positions with optional filters
export const getPositions = createAsyncThunk(
    'position/getAll',
    async (params: GetPositionsParams = {}, { rejectWithValue }) => {
        try {
            const queryParams = new URLSearchParams();
            if (params.application) queryParams.append('application', params.application);
            if (params.activeStatus !== undefined) queryParams.append('activeStatus', String(params.activeStatus));
            if (params.page) queryParams.append('page', params.page.toString());
            if (params.limit) queryParams.append('limit', params.limit.toString());

            const url = `/positions${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
            const response = await axiosGet(url);
            return response.data;
        } catch (error: any) {
            console.error('Get positions error:', error);
            return rejectWithValue(
                error.response?.data?.message || 'Failed to fetch positions'
            );
        }
    }
);

// Get position by MongoDB ObjectId
export const getPositionById = createAsyncThunk(
    'position/getById',
    async (id: string, { rejectWithValue }) => {
        try {
            const response = await axiosGet(`/positions/${id}`);
            return response.data;
        } catch (error: any) {
            console.error('Get position by ID error:', error);
            return rejectWithValue(
                error.response?.data?.message || 'Failed to fetch position'
            );
        }
    }
);

// Get position by numeric positionId
export const getPositionByPositionId = createAsyncThunk(
    'position/getByPositionId',
    async (positionId: string | number, { rejectWithValue }) => {
        try {
            const response = await axiosGet(`/positions/positionId/${positionId}`);
            return response.data;
        } catch (error: any) {
            console.error('Get position by positionId error:', error);
            return rejectWithValue(
                error.response?.data?.message || 'Failed to fetch position'
            );
        }
    }
);

// Update position
export const updatePosition = createAsyncThunk(
    'position/update',
    async ({ id, data }: { id: string; data: UpdatePositionPayload }, { rejectWithValue }) => {
        try {
            const response = await axiosPut(`/positions/${id}`, data);
            return response.data;
        } catch (error: any) {
            console.error('Update position error:', error);
            return rejectWithValue(
                error.response?.data?.message || 'Failed to update position'
            );
        }
    }
);

// Delete position
export const deletePosition = createAsyncThunk(
    'position/delete',
    async (id: string, { rejectWithValue }) => {
        try {
            const response = await axiosDelete(`/positions/${id}`);
            return { ...response.data, deletedId: id };
        } catch (error: any) {
            console.error('Delete position error:', error);
            return rejectWithValue(
                error.response?.data?.message || 'Failed to delete position'
            );
        }
    }
);

