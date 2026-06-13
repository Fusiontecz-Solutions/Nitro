import { createAsyncThunk } from "@reduxjs/toolkit";
import { axiosPost } from "../axios";
import type { TemplateCategory } from "@/pages/payment/paymentTemplateApi";
import type { PaymentMailLogEntry } from "@/pages/payment/paymentMailLogStorage";

export interface SendPaymentMailOptions {
  to: string | string[];
  subject?: string;
  body: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  /** When set, the server creates a tracked mail log and wires SendGrid webhook status updates. */
  applicationId?: string | null;
  dealKey?: string;
  templateName?: string;
  category?: TemplateCategory;
}

export interface SendPaymentMailResponse {
  paymentMailLog?: PaymentMailLogEntry;
  sgMessageId?: string | null;
}

/** Send payment letter/template email via server SendGrid (not connected Gmail). */
export const sendPaymentMail = createAsyncThunk(
  "paymentMail/send",
  async (payload: SendPaymentMailOptions, { rejectWithValue }) => {
    try {
      const response = await axiosPost("/mail/send", payload);
      return response.data as { data?: SendPaymentMailResponse };
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to send email"
      );
    }
  }
);
