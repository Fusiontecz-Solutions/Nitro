import { createSlice } from "@reduxjs/toolkit"
import { getOfferDecisionByApplication } from "../actions/offerDecisionActions"

interface OfferDecisionState {
  loading: boolean
  data: any | null
  loadedForApplicationId: string | null
  error: string | null
}

const initialState: OfferDecisionState = {
  loading: false,
  data: null,
  loadedForApplicationId: null,
  error: null,
}

export const offerDecisionSlice = createSlice({
  name: "offerDecision",
  initialState,
  reducers: {
    clearOfferDecision: (state) => {
      state.loading = false
      state.data = null
      state.loadedForApplicationId = null
      state.error = null
    },
    setOfferDecisionFromSave: (
      state,
      action: { payload: { applicationId: string; data: unknown } },
    ) => {
      state.loading = false
      state.error = null
      state.data = action.payload.data ?? null
      state.loadedForApplicationId = String(action.payload.applicationId ?? "")
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(getOfferDecisionByApplication.pending, (state, action) => {
        const requested = String(action.meta.arg ?? "")
        state.error = null
        if (state.data && state.loadedForApplicationId === requested) {
          return
        }
        state.loading = true
      })
      .addCase(getOfferDecisionByApplication.fulfilled, (state, action) => {
        state.loading = false
        state.data = action.payload?.data ?? action.payload ?? null
        state.loadedForApplicationId = String(action.meta.arg ?? "")
      })
      .addCase(getOfferDecisionByApplication.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload as string
      })
  },
})

export const { clearOfferDecision, setOfferDecisionFromSave } = offerDecisionSlice.actions

