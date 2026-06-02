import { createAsyncThunk } from "@reduxjs/toolkit";
import { axiosPost } from "../axios";

export interface SendPaymentMailOptions {
  to: string | string[];
  subject?: string;
  body: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
}

export const sendPaymentMail = createAsyncThunk(
  "paymentMail/send",
  async (payload: SendPaymentMailOptions, { rejectWithValue }) => {
    try {
      const response = await axiosPost("/mail/send", payload);
      return response.data;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to send email"
      );
    }
  }
);
