import { createSlice } from '@reduxjs/toolkit';
import type { Position } from '@/types/positionTypes';
import {
    createPosition,
    getPositions,
    getPositionById,
    getPositionByPositionId,
    updatePosition,
    deletePosition,
} from '../actions/positionActions';

// Positions List State
interface PositionsState {
    loading: boolean;
  data: Position[];
  /** The application id these positions belong to (for scoping in views). */
  currentApplicationId: string | null;
    pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    } | null;
    error: string | null;
}

const positionsInitialState: PositionsState = {
    loading: false,
    data: [],
  currentApplicationId: null,
    pagination: null,
    error: null,
};

export const positionsSlice = createSlice({
    name: 'positions',
    initialState: positionsInitialState,
    reducers: {
        clearPositions: (state) => {
            state.data = [];
      state.currentApplicationId = null;
            state.pagination = null;
            state.error = null;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(getPositions.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(getPositions.fulfilled, (state, action) => {
        state.loading = false;
        // Scope positions to the application used in the request
        const arg: any = action.meta?.arg ?? {};
        state.currentApplicationId =
          arg.application != null ? String(arg.application) : null;
        state.data = action.payload.data || action.payload;
        state.pagination = action.payload.pagination || null;
            })
            .addCase(getPositions.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload as string;
            });
    },
});

// Create Position State
interface CreatePositionState {
    loading: boolean;
    success: boolean;
    data: Position | null;
    error: string | null;
}

const createPositionInitialState: CreatePositionState = {
    loading: false,
    success: false,
    data: null,
    error: null,
};

export const createPositionSlice = createSlice({
    name: 'createPosition',
    initialState: createPositionInitialState,
    reducers: {
        resetCreatePosition: (state) => {
            state.loading = false;
            state.success = false;
            state.data = null;
            state.error = null;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(createPosition.pending, (state) => {
                state.loading = true;
                state.success = false;
                state.error = null;
            })
            .addCase(createPosition.fulfilled, (state, action) => {
                state.loading = false;
                state.success = true;
                state.data = action.payload.data || action.payload;
            })
            .addCase(createPosition.rejected, (state, action) => {
                state.loading = false;
                state.success = false;
                state.error = action.payload as string;
            });
    },
});

// Position Detail State
interface PositionDetailState {
    loading: boolean;
    data: Position | null;
    error: string | null;
}

const positionDetailInitialState: PositionDetailState = {
    loading: false,
    data: null,
    error: null,
};

export const positionDetailSlice = createSlice({
    name: 'positionDetail',
    initialState: positionDetailInitialState,
    reducers: {
        clearPositionDetail: (state) => {
            state.data = null;
            state.error = null;
        },
    },
    extraReducers: (builder) => {
        builder
            // Get by ID
            .addCase(getPositionById.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(getPositionById.fulfilled, (state, action) => {
                state.loading = false;
                state.data = action.payload.data || action.payload;
            })
            .addCase(getPositionById.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload as string;
            })
            // Get by positionId
            .addCase(getPositionByPositionId.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(getPositionByPositionId.fulfilled, (state, action) => {
                state.loading = false;
                state.data = action.payload.data || action.payload;
            })
            .addCase(getPositionByPositionId.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload as string;
            });
    },
});

// Update Position State
interface UpdatePositionState {
    loading: boolean;
    success: boolean;
    data: Position | null;
    error: string | null;
}

const updatePositionInitialState: UpdatePositionState = {
    loading: false,
    success: false,
    data: null,
    error: null,
};

export const updatePositionSlice = createSlice({
    name: 'updatePosition',
    initialState: updatePositionInitialState,
    reducers: {
        resetUpdatePosition: (state) => {
            state.loading = false;
            state.success = false;
            state.data = null;
            state.error = null;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(updatePosition.pending, (state) => {
                state.loading = true;
                state.success = false;
                state.error = null;
            })
            .addCase(updatePosition.fulfilled, (state, action) => {
                state.loading = false;
                state.success = true;
                state.data = action.payload.data || action.payload;
            })
            .addCase(updatePosition.rejected, (state, action) => {
                state.loading = false;
                state.success = false;
                state.error = action.payload as string;
            });
    },
});

// Delete Position State
interface DeletePositionState {
    loading: boolean;
    success: boolean;
    deletedId: string | null;
    error: string | null;
}

const deletePositionInitialState: DeletePositionState = {
    loading: false,
    success: false,
    deletedId: null,
    error: null,
};

export const deletePositionSlice = createSlice({
    name: 'deletePosition',
    initialState: deletePositionInitialState,
    reducers: {
        resetDeletePosition: (state) => {
            state.loading = false;
            state.success = false;
            state.deletedId = null;
            state.error = null;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(deletePosition.pending, (state) => {
                state.loading = true;
                state.success = false;
                state.error = null;
            })
            .addCase(deletePosition.fulfilled, (state, action) => {
                state.loading = false;
                state.success = true;
                state.deletedId = action.payload.deletedId;
            })
            .addCase(deletePosition.rejected, (state, action) => {
                state.loading = false;
                state.success = false;
                state.error = action.payload as string;
            });
    },
});

// Export actions
export const { clearPositions } = positionsSlice.actions;
export const { resetCreatePosition } = createPositionSlice.actions;
export const { clearPositionDetail } = positionDetailSlice.actions;
export const { resetUpdatePosition } = updatePositionSlice.actions;
export const { resetDeletePosition } = deletePositionSlice.actions;

