import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import {
  syncGmail,
  getGmailMessageDetails,
  getGmailAttachments,
  autoCreateApplications,
  sendGmailCompose,
} from '../actions/gmailActions';
import type { GmailLabel } from '../actions/gmailActions';


// ===============================
// 🔵 Types
// ===============================
interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  subject?: string;
  from?: string;
  to?: string;
  date?: string;
  labelIds?: string[];
  isRead?: boolean;
}

interface GmailState {
  // List
  loadingList: boolean;
  messages: GmailMessage[];
  listError: string | null;
  nextPageToken: string | null;
  activeLabel: GmailLabel;

  // Detail
  loadingDetail: boolean;
  selectedMessage: any | null;
  detailError: string | null;

  // Attachments
  loadingAttachments: boolean;
  attachments: any[];
  attachmentError: string | null;

  // Sync
  syncing: boolean;
  syncSuccess: boolean;
  syncError: string | null;

  // Auto-create applications
  autoCreating: boolean;
  autoCreateResults: any[];
  autoCreateTotal: number;
  autoCreateMessage: string | null;
  autoCreateError: string | null;

  // Compose/send email
  sendingEmail: boolean;
  sendEmailSuccess: boolean;
  sendEmailError: string | null;
  sentEmailResponse: any | null;
}

const initialState: GmailState = {
  loadingList: false,
  messages: [],
  listError: null,
  nextPageToken: null,
  activeLabel: 'INBOX',

  loadingDetail: false,
  selectedMessage: null,
  detailError: null,

  loadingAttachments: false,
  attachments: [],
  attachmentError: null,

  syncing: false,
  syncSuccess: false,
  syncError: null,

  autoCreating: false,
  autoCreateResults: [],
  autoCreateTotal: 0,
  autoCreateMessage: null,
  autoCreateError: null,

  sendingEmail: false,
  sendEmailSuccess: false,
  sendEmailError: null,
  sentEmailResponse: null,
};


// ===============================
// 🔵 Slice
// ===============================
export const gmailSlice = createSlice({
  name: 'gmail',
  initialState,
  reducers: {
    clearGmailErrors: (state) => {
      state.listError = null;
      state.detailError = null;
      state.attachmentError = null;
      state.syncError = null;
    },

    clearSelectedMessage: (state) => {
      state.selectedMessage = null;
      state.attachments = [];
    },

    clearAttachments: (state) => {
      state.attachments = [];
      state.attachmentError = null;
    },

    resetSyncStatus: (state) => {
      state.syncSuccess = false;
      state.syncError = null;
    },

    setActiveLabel: (state, action: PayloadAction<GmailLabel>) => {
      state.activeLabel = action.payload;
      state.messages = [];          // clear when switching label
      state.nextPageToken = null;
    },

    clearAutoCreateStatus: (state) => {
      state.autoCreateResults = [];
      state.autoCreateTotal = 0;
      state.autoCreateMessage = null;
      state.autoCreateError = null;
    },

    resetSendEmailStatus: (state) => {
      state.sendingEmail = false;
      state.sendEmailSuccess = false;
      state.sendEmailError = null;
      state.sentEmailResponse = null;
    },
  },

  extraReducers: (builder) => {
    builder

      // ===============================
      // 🔵 Sync Gmail
      // ===============================
      .addCase(syncGmail.pending, (state) => {
        state.syncing = true;
        state.loadingList = true;
        state.listError = null;
        state.syncError = null;
        state.syncSuccess = false;
      })

      .addCase(syncGmail.fulfilled, (state, action) => {
        state.syncing = false;
        state.loadingList = false;
        state.syncSuccess = true;

        // 🔒 Stale-response guard: if the user already switched to a
        //    different label, discard the outdated response entirely.
        const requestedLabel = action.meta.arg?.label;
        if (requestedLabel && requestedLabel !== state.activeLabel) return;

        // Backend returns { messages, nextPageToken }
        // API may wrap in { success, data: { messages, nextPageToken } }
        const raw = action.payload;
        const data = raw?.data ?? raw;
        const newMessages: GmailMessage[] = Array.isArray(data)
          ? data
          : (data?.messages ?? []);
        const nextToken: string | null = data?.nextPageToken ?? null;

        // pageToken present → "Load More" → append
        // no pageToken      → fresh fetch / refresh → replace
        if (action.meta.arg?.pageToken) {
          state.messages = [...state.messages, ...newMessages];
        } else {
          state.messages = newMessages;
        }
        state.nextPageToken = nextToken;
      })

      .addCase(syncGmail.rejected, (state, action) => {
        // Stale guard – don't overwrite if label already changed
        const requestedLabel = action.meta.arg?.label;
        if (requestedLabel && requestedLabel !== state.activeLabel) return;

        state.syncing = false;
        state.loadingList = false;
        state.syncError = action.payload as string;
        state.listError = action.payload as string;
        state.syncSuccess = false;
      })


      // ===============================
      // 🔵 Get Gmail Message Details
      // ===============================
      .addCase(getGmailMessageDetails.pending, (state) => {
        state.loadingDetail = true;
        state.detailError = null;
      })
      .addCase(getGmailMessageDetails.fulfilled, (state, action) => {
        state.loadingDetail = false;
        state.selectedMessage = action.payload.data || action.payload;
      })
      .addCase(getGmailMessageDetails.rejected, (state, action) => {
        state.loadingDetail = false;
        state.detailError = action.payload as string;
      })


      // ===============================
      // 🔵 Get Gmail Attachments
      // ===============================
      .addCase(getGmailAttachments.pending, (state) => {
        state.loadingAttachments = true;
        state.attachmentError = null;
      })
      .addCase(getGmailAttachments.fulfilled, (state, action) => {
        state.loadingAttachments = false;
        state.attachments =
          (action.payload as any).attachments || action.payload || [];
      })
      .addCase(getGmailAttachments.rejected, (state, action) => {
        state.loadingAttachments = false;
        state.attachmentError = action.payload as string;
      })


      // ===============================
      // 🔵 Auto-Create Applications
      // ===============================
      .addCase(autoCreateApplications.pending, (state) => {
        state.autoCreating = true;
        state.autoCreateError = null;
        state.autoCreateMessage = null;
      })
      .addCase(autoCreateApplications.fulfilled, (state, action) => {
        state.autoCreating = false;
        const raw = action.payload;
        const payload = raw?.data ?? raw;
        state.autoCreateResults = payload?.data ?? [];
        state.autoCreateTotal = payload?.total ?? 0;
        state.autoCreateMessage = payload?.message ?? 'Applications created successfully';
      })
      .addCase(autoCreateApplications.rejected, (state, action) => {
        state.autoCreating = false;
        state.autoCreateError = action.payload as string;
      })

      // ===============================
      // 🔵 Gmail Compose / Send
      // ===============================
      .addCase(sendGmailCompose.pending, (state) => {
        state.sendingEmail = true;
        state.sendEmailSuccess = false;
        state.sendEmailError = null;
      })
      .addCase(sendGmailCompose.fulfilled, (state, action) => {
        state.sendingEmail = false;
        state.sendEmailSuccess = true;
        state.sentEmailResponse = action.payload?.data ?? action.payload;
      })
      .addCase(sendGmailCompose.rejected, (state, action) => {
        state.sendingEmail = false;
        state.sendEmailSuccess = false;
        state.sendEmailError = action.payload as string;
      });
  },
});


// ===============================
// 🔵 Export Actions
// ===============================
export const {
  clearGmailErrors,
  clearSelectedMessage,
  clearAttachments,
  resetSyncStatus,
  setActiveLabel,
  clearAutoCreateStatus,
  resetSendEmailStatus,
} = gmailSlice.actions;

export default gmailSlice.reducer;