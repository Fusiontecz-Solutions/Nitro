import { createAsyncThunk } from "@reduxjs/toolkit";
import { axiosGet, axiosPost } from "../axios";

export type GmailLabel = "INBOX" | "SENT" | "DRAFT" | "IMPORTANT" | "STARRED";
export interface SendGmailOptions {
  to: string | string[];
  subject?: string;
  body: string;
  cc?: string | string[];
  bcc?: string | string[];
  from?: string;
  replyTo?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}

export const getGoogleAccessToken = createAsyncThunk<string, void>(
  "gmail/getGoogleAccessToken",
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosGet("/google/test");
      const { success, accessToken, message } = response.data || {};

      if (!success || !accessToken) {
        return rejectWithValue(message || "Failed to generate access token");
      }

      return accessToken as string;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to get access token"
      );
    }
  }
);

export interface GmailConnectionInfo {
  connected: boolean;
  gmailEmail: string | null;
  crmEmail: string | null;
  needsReconnect?: boolean;
  message?: string | null;
}

export const fetchGmailConnection = createAsyncThunk<GmailConnectionInfo, void>(
  "gmail/fetchConnection",
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosGet("/gmail/me");
      const data = response.data || {};
      if (!data.success) {
        return rejectWithValue(data.message || "Failed to check Gmail connection");
      }
      return {
        connected: Boolean(data.connected),
        gmailEmail: data.gmailEmail ?? null,
        crmEmail: data.crmEmail ?? null,
        needsReconnect: Boolean(data.needsReconnect),
        message: data.message ?? null,
      };
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to check Gmail connection"
      );
    }
  }
);

// ==============================
// 🔵 Sync Gmail (fetch by label)
// ==============================
export const syncGmail = createAsyncThunk(
  "gmail/sync",
  async (
    {
      label,
      pageToken,
      limit,
      query,
    }: {
      label?: GmailLabel;
      pageToken?: string;
      limit?: number;
      query?: string;
    } = {},
    { dispatch, rejectWithValue }
  ) => {
    try {
      const accessToken = await dispatch(getGoogleAccessToken()).unwrap();

      // Backend expects `type` (lowercase) — e.g. "sent", "draft", "starred"
      const response = await axiosPost("/gmail/sync", {
        accessToken,
        type: label ? label.toLowerCase() : undefined,
        pageToken,
        limit,
        query,
      });

      return response.data;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to sync Gmail"
      );
    }
  },
  {
    condition: (_, { getState }) => {
      const state = (getState() as { gmail?: { syncing?: boolean } }).gmail;
      return !state?.syncing;
    },
  }
);


// ==============================
// 🔵 Get All Messages
// ==============================


export const getGmailMessageDetails = createAsyncThunk(
  "gmail/getDetails",
  async (messageId: string, { dispatch, rejectWithValue }) => {
    console.log("messageId", messageId);
    try {
      const tokenResponse = await dispatch(
        getGoogleAccessToken()
      ).unwrap();
      console.log("tokenResponse", tokenResponse);

      const accessToken = tokenResponse as string;

      console.log("accessToken", accessToken);

      const response = await axiosGet("/gmail/message/" + messageId, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      console.log("response getGmailMessageDetailsssss", response.data);

      return response.data;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch message details"
      );
    }
  }
);

// ==============================
// 🔵 Auto-Create Applications from Emails
// ==============================
export const autoCreateApplications = createAsyncThunk(
  "gmail/autoCreateApplications",
  async (params: { messageId?: string } | void, { dispatch, rejectWithValue }) => {
    try {
      const accessToken = await dispatch(getGoogleAccessToken()).unwrap();

      // Get current userId from localStorage.user (backend expects userId)
      let userId: string | undefined;
      try {
        const stored = localStorage.getItem("user");
        if (stored) {
          const parsed = JSON.parse(stored) as { _id?: string } | null;
          userId = parsed?._id || undefined;
        }
      } catch {
        // ignore JSON/localStorage errors
      }

      const response = await axiosPost("/gmail/auto-create-applications", {
        accessToken,
        userId,
        messageId: params && typeof params === "object" ? params.messageId : undefined,
      });

      return response.data;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to auto-create applications from emails"
      );
    }
  }
);

// ==============================
// 🏷️ Label Gmail message in-crm
// ==============================
export const markGmailMessageInCrmLabel = createAsyncThunk(
  "gmail/markMessageInCrmLabel",
  async (messageId: string, { dispatch, rejectWithValue }) => {
    try {
      const accessToken = await dispatch(getGoogleAccessToken()).unwrap();
      const response = await axiosPost(`/gmail/message/${messageId}/in-crm`, {
        accessToken,
      });
      return response.data;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to label Gmail message in-crm",
      );
    }
  },
);

// ==============================
// 🔵 Send Email (Compose)
// ==============================
export const sendGmailCompose = createAsyncThunk(
  "gmail/sendCompose",
  async (payload: SendGmailOptions, { dispatch, rejectWithValue }) => {
    try {
      const accessToken = await dispatch(getGoogleAccessToken()).unwrap();

      const response = await axiosPost("/gmail/send", {
        accessToken,
        ...payload,
      });

      return response.data;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to send email"
      );
    }
  }
);

/** Parse filename from Content-Disposition (quoted, unquoted, or RFC 5987 filename*). */
function parseFilenameFromContentDisposition(header: string | undefined): string | null {
  if (!header || typeof header !== "string") return null;
  const star = header.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;\s]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].replace(/^["']|["']$/g, ""));
    } catch {
      /* fall through */
    }
  }
  const quoted = header.match(/filename\s*=\s*"((?:\\.|[^"\\])*)"/i);
  if (quoted?.[1]) return quoted[1].replace(/\\(.)/g, "$1");
  const single = header.match(/filename\s*=\s*'([^']*)'/i);
  if (single?.[1]) return single[1];
  const plain = header.match(/filename\s*=\s*([^;\s]+)/i);
  if (plain?.[1]) return plain[1].replace(/^["']|["']$/g, "");
  return null;
}

// ==============================
// 🔵 Get Attachments
// ==============================

export const getGmailAttachments = createAsyncThunk(
  "gmail/getAttachments",
  async (messageId: string, { dispatch, rejectWithValue }) => {
    try {
      // 1️⃣ Get fresh access token
      const accessToken = await dispatch(
        getGoogleAccessToken()
      ).unwrap();

      // 2️⃣ Call API (token in header, NOT body)
      const response = await axiosPost(
        "/gmail/attachment",
        { messageId }, // ✅ only messageId
        {
          responseType: "blob", // 🔥 required for file
          headers: {
            Authorization: `Bearer ${accessToken}`, // ✅ correct way
          },
        }
      );

      // Filename from header (requires CORS exposedHeaders Content-Disposition on the API)
      const rawCd =
        response.headers["content-disposition"] ||
        (response.headers as any)["Content-Disposition"];
      const fromHeader = parseFilenameFromContentDisposition(rawCd);
      const filename = fromHeader?.trim() || "attachment";

      return {
        blob: response.data,
        filename,
      };

    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch attachments"
      );
    }
  }
);