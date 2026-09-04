import { createAsyncThunk } from "@reduxjs/toolkit";
import { axiosPost } from "../axios";
import type { TemplateCategory } from "@/pages/templates/types";
import type { PaymentMailLogEntry } from "@/pages/letterGenerator/paymentMailLogStorage";

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
  /** Letter templates: attach a generated PDF of the body. */
  attachLetterPdf?: boolean;
  letterPdfFilename?: string;
}

export interface SendPaymentMailResponse {
  paymentMailLog?: PaymentMailLogEntry;
  sgMessageId?: string | null;
}

export interface DownloadLetterPdfOptions {
  /** Rendered template HTML to convert into a PDF. */
  body: string;
  /** Suggested download filename (without extension is fine; server adds .pdf). */
  filename?: string;
}

/**
 * Requests a server-rendered PDF of the supplied template HTML and returns it as
 * a Blob. The server reuses the same Puppeteer renderer used for email letter
 * attachments, so the download matches what merchants receive.
 */
export async function downloadPaymentLetterPdf(
  options: DownloadLetterPdfOptions
): Promise<Blob> {
  const response = await axiosPost(
    "/mail/letter-pdf",
    { body: options.body, filename: options.filename },
    { responseType: "blob" }
  );
  return response.data as Blob;
}

/** Send letter/template email via server SendGrid. */
export const sendPaymentMail = createAsyncThunk(
  "paymentMail/send",
  async (payload: SendPaymentMailOptions, { rejectWithValue }) => {
    try {
      const response = await axiosPost("/mail/send", payload);
      return response.data as { data?: SendPaymentMailResponse };
    } catch (error: unknown) {
      const message =
        error &&
        typeof error === "object" &&
        "response" in error &&
        (error as { response?: { data?: { message?: string } } }).response?.data
          ?.message
          ? String(
              (error as { response?: { data?: { message?: string } } }).response
                ?.data?.message,
            )
          : "Failed to send email";
      return rejectWithValue(message);
    }
  }
);
