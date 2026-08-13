import { createAsyncThunk } from "@reduxjs/toolkit"
import { axiosGet } from "../axios"

export const getOfferDecisionByApplication = createAsyncThunk(
  "offerDecision/getByApplication",
  async (applicationId: string, { rejectWithValue }) => {
    try {
      const response = await axiosGet("/offer-decisions", {
        params: { application: applicationId },
      })

      return response.data
    } catch (error: any) {
      console.error("Get offer decision error:", error)
      return rejectWithValue(
        error?.response?.data?.message || "Failed to fetch offer decision",
      )
    }
  },
)

