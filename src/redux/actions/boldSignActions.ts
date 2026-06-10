import { createAsyncThunk } from "@reduxjs/toolkit";
import { axiosGet, axiosPatch, axiosPost } from "../axios";

export type BoldSignMergeAndSendRole = {
  roleIndex: number;
  signerName: string;
  signerEmail: string;
  signerOrder?: number;
  privateMessage?: string;
  signerType?: string;
  locale?: string;
  deliveryMode?: string;
  formFields?: unknown[];
};

/** Filters `BoldSignTemplate` rows (state / frequency / type stored lowercase in DB). */
export type BoldSignContractTemplateFilters = {
  state?: string | null;
  frequency?: string | null;
  type?: string | null;
};

export type BoldSignMergeAndSendPayload = {
  /** Legacy v1 merge: `{ templateId }[]` → resolved to `templateIds` server-side. */
  templates?: Array<{ templateId: string }>;
  /** BoldSign v1-beta: explicit template GUIDs. */
  templateIds?: string[];
  /** Code-defined layout keys (e.g. flex_addendum, balance_transfer). */
  supplementalLayoutKeys?: string[];
  /** @deprecated Use supplementalLayoutKeys — accepts layout keys or legacy CRM row ids. */
  supplementalDocumentRefs?: string[];
  ownerCount?: number;
  guarantorCount?: number;
  /** Resolve template IDs from CRM `BoldSignTemplate` (AND on provided fields). */
  contractTemplateFilters?: BoldSignContractTemplateFilters;
  roles: Array<BoldSignMergeAndSendRole | Record<string, unknown>>;
  /** Non-empty BoldSign form-field rows for merged templates after the first (e.g. state disclosure). */
  secondaryMergeRoleFormFields?: Array<Record<string, unknown>>;
  prefillFields?: Array<{ id: string; value: string }>;
  redirectUrl?: string;
  showToolbar?: boolean;
  sendViewOption?: string;
  showSaveButton?: boolean;
  showSendButton?: boolean;
  showPreviewButton?: boolean;
  showNavigationButtons?: boolean;
  sendLinkValidTill?: string;
  applicationId?: string;
  /** When true, backend uses `/v1/template/mergeAndSend` with minimal roles. */
  useLegacyMergeApi?: boolean;
  /** Non-signers who receive a copy when the merged document is sent from BoldSign. */
  ccEmails?: string[];
  /** When false, creates a draft envelope only (no signing emails). */
  autoSend?: boolean;
  /** DocuSign envelope email subject (`emailSubject`). */
  title?: string;
  /** DocuSign envelope email body (`emailBlurb`). */
  message?: string;
  reminderSettings?: {
    enableAutoReminder?: boolean;
    reminderDays?: number;
    reminderCount?: number;
  };
};

export const mergeAndSendBoldSignTemplates = createAsyncThunk(
  "boldSign/mergeAndSendTemplates",
  async (payload: BoldSignMergeAndSendPayload, { rejectWithValue }) => {
    try {
      const response = await axiosPost("/docusign/merge-and-send", payload);
      return response.data;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to merge and send templates"
      );
    }
  }
);

export const sendBoldSignDocument = createAsyncThunk(
  "boldSign/sendDocument",
  async (payload: {
    documentBase64: string;
    signerName: string;
    signerEmail: string;
    title?: string;
    message?: string;
    ccEmails?: string[];
  }, { rejectWithValue }) => {
    try {
      const response = await axiosPost("/docusign/send-document", payload);
      return response.data;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to send DocuSign document"
      );
    }
  }
);

export type BoldSignTemplateRole = {
  roleIndex?: number;
  signerName: string;
  signerEmail: string;
  signerOrder?: number;
  privateMessage?: string;
  authenticationCode?: string;
  authenticationType?: string;
  deliveryMode?: string;
  signerType?: string;
  signerRole?: string;
  locale?: string;
};

export type BoldSignSendTemplateOptions = {
  templateId?: string;
  redirectUrl?: string;
  showToolbar?: boolean;
  sendViewOption?: string;
  showSaveButton?: boolean;
  showSendButton?: boolean;
  showPreviewButton?: boolean;
  showNavigationButtons?: boolean;
  sendLinkValidTill?: string;
  title?: string;
  message?: string;
  roles?: BoldSignTemplateRole[];
  signerName?: string;
  signerEmail?: string;
  labels?: string[];
  reminderSettings?: {
    enableAutoReminder?: boolean;
    reminderDays?: number;
    reminderCount?: number;
  };
  prefillFields?: Array<{
    id: string;
    value: string;
  }>;
  ccEmails?: string[];
  expiryDays?: number;
  expiryDateType?: string;
  expiryValue?: number;
  disableExpiryAlert?: boolean;
  enablePrintAndSign?: boolean;
  enableReassign?: boolean;
  roleRemovalIndices?: number[];
  /** Application UUID — backend links BoldSign document to CRM `Document` / `Contract` for webhooks. */
  applicationId?: string;
  /** When true (default), DocuSign emails signers without opening sender UI. */
  autoSend?: boolean;
};

export const sendBoldSignTemplate = createAsyncThunk(
  "boldSign/sendTemplate",
  async (payload: BoldSignSendTemplateOptions, { rejectWithValue }) => {
    try {
      const response = await axiosPost("/docusign/send-template", payload);
      console.log("sendBoldSignTemplate response:", response.data);
      console.log("sendBoldSignTemplate payload:", payload);
      return response.data;
    } catch (error: any) {
      console.log("sendBoldSignTemplate error:", error);
      return rejectWithValue(
        error.response?.data?.message || "Failed to send DocuSign template"
      );
    }
  }
);

export const getBoldSignEmbeddedRequestUrl = createAsyncThunk(
  "boldSign/getEmbeddedRequestUrl",
  async (payload: Record<string, any>, { rejectWithValue }) => {
    try {
      const response = await axiosPost("/docusign/embedded-request-url", payload);
      return response.data;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to get embedded request URL"
      );
    }
  }
);

export const getBoldSignEmbeddedSignLink = createAsyncThunk(
  "boldSign/getEmbeddedSignLink",
  async (payload: Record<string, any>, { rejectWithValue }) => {
    try {
      const response = await axiosPost("/docusign/embedded-sign-link", payload);
      return response.data;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to get embedded sign link"
      );
    }
  }
);

export const voidBoldSignDocument = createAsyncThunk(
  "boldSign/voidDocument",
  async (payload: Record<string, any>, { rejectWithValue }) => {
    try {
      const response = await axiosPost("/docusign/void-document", payload);
      return response.data;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to void document"
      );
    }
  }
);

export const getBoldSignDocumentProperties = createAsyncThunk(
  "boldSign/getDocumentProperties",
  async (documentId: string, { rejectWithValue }) => {
    try {
      const response = await axiosGet(`/docusign/document-properties/${documentId}`);
      return response.data;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to get document properties"
      );
    }
  }
);

export const downloadBoldSignSignedPdf = createAsyncThunk(
  "boldSign/downloadSignedPdf",
  async (documentId: string, { rejectWithValue }) => {
    try {
      const response = await axiosGet(`/docusign/download/${documentId}`, {
        responseType: "blob",
      });

      return {
        blob: response.data,
        headers: response.headers,
      };
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to download signed PDF"
      );
    }
  }
);

export const listBoldSignDocuments = createAsyncThunk(
  "boldSign/listDocuments",
  async (
    params: {
      page?: number;
      limit?: number;
      [key: string]: any;
    } = {},
    { rejectWithValue }
  ) => {
    try {
      const response = await axiosGet("/docusign/list", { params });
      return response.data;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to list documents"
      );
    }
  }
);

export interface BoldSignPrefillField {
  id: string;
  value: string;
}

export interface BoldSignPrefillFieldsPayload {
  documentId: string;
  fields: BoldSignPrefillField[];
}

export type BoldSignTemplateRecipientRole = {
  roleName?: string;
  signerName?: string;
  signerEmail?: string;
  locale?: string;
  privateMessage?: string;
  // authenticationCode?: string;
  // authenticationType?: string;
  deliveryMode?: string;
};

export type AddRecipientsToTemplatePayload = {
  templateId: string;
  roles: BoldSignTemplateRecipientRole[];
  title?: string;
  message?: string;
  enableSigningOrder?: boolean;
  ccEmails?: string[];
};

export const addRecipientsToBoldSignTemplate = createAsyncThunk(
  "boldSign/addRecipientsToTemplate",
  async (payload: AddRecipientsToTemplatePayload, { rejectWithValue }) => {
    try {
      const response = await axiosPost("/docusign/add-template-recipients", {
        templateId: payload.templateId,
        roles: payload.roles,
        title: payload.title,
        message: payload.message,
        enableSigningOrder: payload.enableSigningOrder,
        ccEmails: payload.ccEmails,
      });
      return response.data;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to add recipients to template"
      );
    }
  }
);

export const getBoldSignTemplateRecipients = createAsyncThunk(
  "boldSign/getTemplateRecipients",
  async (templateId: string | undefined, { rejectWithValue }) => {
    try {
      const tid = String(templateId ?? "").trim();
      const url = tid
        ? `/docusign/template/recipients?templateId=${encodeURIComponent(tid)}`
        : `/docusign/template/recipients`;
      const response = await axiosGet(url);
      return response.data;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to fetch template recipients"
      );
    }
  }
);

export const prefillBoldSignFields = createAsyncThunk(
  "boldSign/prefillFields",
  async (payload: BoldSignPrefillFieldsPayload, { rejectWithValue }) => {
    try {
      // Backend expects fields: [{ id, value }]
      const response = await axiosPatch("/docusign/prefill-fields", {
        documentId: payload.documentId,
        fields: payload.fields.map((field) => ({
          id: field.id,
          value: field.value,
        })),
      });
      return response.data;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.message || "Failed to prefill form fields"
      );
    }
  }
);
