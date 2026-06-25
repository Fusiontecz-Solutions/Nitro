export type BackgroundCheckStatus = "pass" | "fail" | "flag" | "na";

export type BackgroundCheckAttachment = {
  name: string;
  url: string;
  publicId: string;
};

export type BackgroundCheckItemState = {
  notes: string;
  status?: BackgroundCheckStatus;
  optional?: boolean;
  attachmentName?: string;
  attachmentUrl?: string;
  attachmentPublicId?: string;
  savedAt?: string;
  linkOpenedAt?: string;
};

export type BackgroundCheckFormState = Record<string, BackgroundCheckItemState>;

export type BackgroundCheckPersistedState = {
  checks: BackgroundCheckFormState;
  savedAt?: string;
};
