import { createAsyncThunk } from "@reduxjs/toolkit";
import { axiosDelete, axiosGet, axiosPatch, axiosPost } from "../axios";

/** Mailbox reads must never come from the shared GET response cache. */
const fresh = { skipCache: true } as const;

export type GmailSystemLabel =
  | "INBOX"
  | "SENT"
  | "DRAFT"
  | "IMPORTANT"
  | "STARRED"
  | "SPAM"
  | "TRASH"
  | "ALL";
/** System label or a Gmail user label id (e.g. `Label_123`). */
export type GmailLabel = GmailSystemLabel | (string & {});
export interface GmailConnectionInfo {
  /** Google OAuth client configured on the server. */
  configured: boolean;
  connected: boolean;
  gmailEmail: string | null;
  needsReconnect: boolean;
  /** False when the grant predates the mailbox page (send-only scopes); null when unknown. */
  mailboxAccess: boolean | null;
}

export const fetchGmailConnection = createAsyncThunk<GmailConnectionInfo, void>(
  "gmail/fetchConnection",
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosGet("/gmail/me", { ...fresh, params: { probe: 1 } });
      const data = response.data?.data || {};
      return {
        configured: data.configured !== false,
        connected: Boolean(data.connected),
        gmailEmail: data.gmailEmail ?? null,
        needsReconnect: Boolean(data.needsReconnect),
        mailboxAccess: typeof data.mailboxAccess === "boolean" ? data.mailboxAccess : null,
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
      /** Background refresh — don't show the list spinner. */
      silent?: boolean;
    } = {},
    { rejectWithValue }
  ) => {
    try {
      // Mailbox list resolves the Gmail token server-side from the CRM session.
      const response = await axiosPost("/gmail/mailbox/list", {
        labelId: label,
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
    condition: (arg, { getState }) => {
      const state = (getState() as {
        gmail?: { syncing?: boolean; syncingLabel?: string | null };
      }).gmail;
      if (!state?.syncing) return true;
      // Allow a label switch to supersede an in-flight sync; skip exact duplicates.
      return (arg?.label ?? null) !== (state.syncingLabel ?? null);
    },
  }
);

// ==============================
// 📬 Mailbox (labels, star, archive, trash, threads, reply/forward, drafts)
// ==============================

export interface GmailMailboxLabel {
  id: string;
  name: string;
  type: "system" | "user";
  messagesTotal: number;
  messagesUnread: number;
  threadsTotal: number;
  threadsUnread: number;
  color: { textColor?: string; backgroundColor?: string } | null;
  protected: boolean;
}

export interface GmailOutgoingAttachment {
  filename: string;
  contentType: string;
  /** Base64 (no data: prefix). */
  data: string;
}

export interface GmailSourceAttachmentRef {
  messageId: string;
  partIds: string[];
}

export interface GmailMailboxSendPayload {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: GmailOutgoingAttachment[];
  sourceAttachments?: GmailSourceAttachmentRef[];
  draftId?: string;
}

const apiError = (error: any, fallback: string) =>
  error?.response?.data?.message || error?.message || fallback;

export const fetchGmailLabels = createAsyncThunk<GmailMailboxLabel[], void>(
  "gmail/fetchLabels",
  async (_, { rejectWithValue }) => {
    try {
      const response = await axiosGet("/gmail/mailbox/labels", fresh);
      return (response.data?.data ?? []) as GmailMailboxLabel[];
    } catch (error: any) {
      return rejectWithValue(apiError(error, "Failed to load labels"));
    }
  }
);

export const createGmailLabel = createAsyncThunk(
  "gmail/createLabel",
  async (name: string, { rejectWithValue }) => {
    try {
      const response = await axiosPost("/gmail/mailbox/labels", { name });
      return response.data?.data;
    } catch (error: any) {
      return rejectWithValue(apiError(error, "Failed to create label"));
    }
  }
);

export const renameGmailLabel = createAsyncThunk(
  "gmail/renameLabel",
  async ({ labelId, name }: { labelId: string; name: string }, { rejectWithValue }) => {
    try {
      const response = await axiosPatch(
        `/gmail/mailbox/labels/${encodeURIComponent(labelId)}`,
        { name }
      );
      return response.data?.data;
    } catch (error: any) {
      return rejectWithValue(apiError(error, "Failed to rename label"));
    }
  }
);

export const deleteGmailLabel = createAsyncThunk(
  "gmail/deleteLabel",
  async (labelId: string, { rejectWithValue }) => {
    try {
      await axiosDelete(`/gmail/mailbox/labels/${encodeURIComponent(labelId)}`);
      return labelId;
    } catch (error: any) {
      return rejectWithValue(apiError(error, "Failed to delete label"));
    }
  }
);

export const modifyGmailMessages = createAsyncThunk(
  "gmail/modifyMessages",
  async (
    payload: { ids: string[]; addLabelIds?: string[]; removeLabelIds?: string[] },
    { rejectWithValue }
  ) => {
    try {
      await axiosPost("/gmail/mailbox/modify", {
        ids: payload.ids,
        addLabelIds: payload.addLabelIds ?? [],
        removeLabelIds: payload.removeLabelIds ?? [],
      });
      return payload;
    } catch (error: any) {
      return rejectWithValue(apiError(error, "Failed to update messages"));
    }
  }
);

export const trashGmailMessages = createAsyncThunk(
  "gmail/trashMessages",
  async (ids: string[], { rejectWithValue }) => {
    try {
      await axiosPost("/gmail/mailbox/trash", { ids });
      return ids;
    } catch (error: any) {
      return rejectWithValue(apiError(error, "Failed to move to trash"));
    }
  }
);

export const untrashGmailMessages = createAsyncThunk(
  "gmail/untrashMessages",
  async (ids: string[], { rejectWithValue }) => {
    try {
      await axiosPost("/gmail/mailbox/untrash", { ids });
      return ids;
    } catch (error: any) {
      return rejectWithValue(apiError(error, "Failed to restore messages"));
    }
  }
);

export const fetchGmailThread = createAsyncThunk(
  "gmail/fetchThread",
  async (threadId: string, { rejectWithValue }) => {
    try {
      const response = await axiosGet(
        `/gmail/mailbox/threads/${encodeURIComponent(threadId)}`,
        fresh
      );
      return response.data?.data as { id: string; messages: any[] };
    } catch (error: any) {
      return rejectWithValue(apiError(error, "Failed to load conversation"));
    }
  }
);

export const sendGmailMailboxEmail = createAsyncThunk(
  "gmail/sendMailboxEmail",
  async (payload: GmailMailboxSendPayload, { rejectWithValue }) => {
    try {
      const response = await axiosPost("/gmail/mailbox/send", payload);
      return response.data?.data;
    } catch (error: any) {
      return rejectWithValue(apiError(error, "Failed to send email"));
    }
  }
);

export const saveGmailDraft = createAsyncThunk(
  "gmail/saveDraft",
  async (payload: GmailMailboxSendPayload, { rejectWithValue }) => {
    try {
      const response = await axiosPost("/gmail/mailbox/drafts", payload);
      return response.data?.data as { id: string; message?: { id: string; threadId: string } };
    } catch (error: any) {
      return rejectWithValue(apiError(error, "Failed to save draft"));
    }
  }
);

export const deleteGmailDraft = createAsyncThunk(
  "gmail/deleteDraft",
  async (draftId: string, { rejectWithValue }) => {
    try {
      await axiosDelete(`/gmail/mailbox/drafts/${encodeURIComponent(draftId)}`);
      return draftId;
    } catch (error: any) {
      return rejectWithValue(apiError(error, "Failed to discard draft"));
    }
  }
);

export const findGmailDraftByMessage = createAsyncThunk(
  "gmail/findDraftByMessage",
  async (messageId: string, { rejectWithValue }) => {
    try {
      const response = await axiosGet(
        `/gmail/mailbox/drafts/by-message/${encodeURIComponent(messageId)}`,
        fresh
      );
      return (response.data?.data?.draftId ?? null) as string | null;
    } catch (error: any) {
      return rejectWithValue(apiError(error, "Failed to open draft"));
    }
  }
);

export const downloadGmailAttachmentById = createAsyncThunk(
  "gmail/downloadAttachmentById",
  async (
    args: { messageId: string; attachmentId: string; filename: string; mimeType: string },
    { rejectWithValue }
  ) => {
    try {
      const response = await axiosGet(
        `/gmail/mailbox/messages/${encodeURIComponent(args.messageId)}/attachments/${encodeURIComponent(args.attachmentId)}`,
        {
          ...fresh,
          params: { filename: args.filename, mimeType: args.mimeType },
          responseType: "blob",
        }
      );
      return response.data as Blob;
    } catch (error: any) {
      return rejectWithValue(apiError(error, "Failed to download attachment"));
    }
  }
);


/** Tag messages with the protected `in-crm` label after "Send to CRM". */
export const markGmailMessagesInCrm = createAsyncThunk(
  "gmail/markMessagesInCrm",
  async (ids: string[], { rejectWithValue }) => {
    try {
      await axiosPost("/gmail/mailbox/in-crm", { ids });
      return ids;
    } catch (error: any) {
      return rejectWithValue(apiError(error, "Failed to label message in-crm"));
    }
  }
);
