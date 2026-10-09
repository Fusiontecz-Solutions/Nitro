export type DocuSignAccountProfile = {
  id: string;
  name: string;
  integrationKey: string;
  clientSecret?: string | null;
  hasClientSecret?: boolean;
  impersonatedUserId: string;
  rsaPrivateKey?: string | null;
  hasRsaPrivateKey?: boolean;
  accountId?: string | null;
  baseUri?: string | null;
  defaultCcEmail?: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  funderCount?: number;
};

export type SignNowTemplateLinkItem = {
  name: string;
  link: string;
};

export type FunderProfile = {
  id: string;
  name: string;
  displayName?: string | null;
  dealIdPrefix?: string | null;
  assignsDealId: boolean;
  mainContractLayoutKey: string;
  contractPdfFileName?: string | null;
  logoUrl?: string | null;
  allowedStates: string[];
  excludedStates: string[];
  organization?: string | null;
  legalName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  defaultCcEmail?: string | null;
  /** Verified SendGrid sender for this funder; empty = server SENDGRID_FROM_EMAIL. */
  sendgridFromEmail?: string | null;
  /** Display name of that SendGrid sender identity (e.g. "Tiberian Funding"). */
  sendgridFromName?: string | null;
  addressLine1?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
  docusignAccountProfileId?: string | null;
  docusignAccountName?: string | null;
  docusignDefaultCcEmail?: string | null;
  sortOrder: number;
  isActive: boolean;
  documentsSource?: "platform" | "own" | "shared";
  sharedDocumentsFunderId?: string | null;
  sharedDocumentsFunderName?: string | null;
  addendumDocumentsSource?: "platform" | "own" | "shared";
  disclosureDocumentsSource?: "platform" | "own" | "shared";
  sharedAddendumFunderId?: string | null;
  sharedDisclosureFunderId?: string | null;
  sharedAddendumFunderName?: string | null;
  sharedDisclosureFunderName?: string | null;
  letterCompanyName?: string | null;
  letterLogoUrl?: string | null;
  letterWatermarkUrl?: string | null;
  letterAccentStripLight?: string | null;
  letterAccentStripDark?: string | null;
  letterInfoTableIconBg?: string | null;
  letterWireBankName?: string | null;
  letterWireAddressLine1?: string | null;
  letterWireCityStateZip?: string | null;
  letterWireRoutingNumber?: string | null;
  letterWireAccountNumber?: string | null;
  signnowContractTemplateLink?: string | null;
  signnowAddendumTemplates?: SignNowTemplateLinkItem[];
  signnowDisclosureTemplates?: SignNowTemplateLinkItem[];
};

export type DocuSignAccountProfileInput = {
  name: string;
  integrationKey: string;
  clientSecret?: string;
  impersonatedUserId: string;
  rsaPrivateKey?: string;
  accountId?: string;
  baseUri?: string;
  defaultCcEmail?: string;
  isActive?: boolean;
};

export type FunderProfileInput = {
  name: string;
  displayName?: string;
  dealIdPrefix?: string;
  assignsDealId?: boolean;
  mainContractLayoutKey?: string;
  contractPdfFileName?: string;
  allowedStates?: string[];
  excludedStates?: string[];
  organization?: string;
  legalName?: string;
  contactEmail?: string;
  contactPhone?: string;
  defaultCcEmail?: string;
  sendgridFromEmail?: string;
  sendgridFromName?: string;
  addressLine1?: string;
  addressCity?: string;
  addressState?: string;
  addressZip?: string;
  docusignAccountProfileId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  documentsSource?: "platform" | "own" | "shared";
  sharedDocumentsFunderId?: string | null;
  addendumDocumentsSource?: "platform" | "own" | "shared";
  disclosureDocumentsSource?: "platform" | "own" | "shared";
  sharedAddendumFunderId?: string | null;
  sharedDisclosureFunderId?: string | null;
  letterCompanyName?: string | null;
  letterLogoUrl?: string | null;
  letterWatermarkUrl?: string | null;
  letterAccentStripLight?: string | null;
  letterAccentStripDark?: string | null;
  letterInfoTableIconBg?: string | null;
  letterWireBankName?: string | null;
  letterWireAddressLine1?: string | null;
  letterWireCityStateZip?: string | null;
  letterWireRoutingNumber?: string | null;
  letterWireAccountNumber?: string | null;
  signnowContractTemplateLink?: string | null;
  signnowAddendumTemplates?: SignNowTemplateLinkItem[];
  signnowDisclosureTemplates?: SignNowTemplateLinkItem[];
};

/** GET /integration-settings/sendgrid-usage */
export interface SendGridUsageSummary {
  configured: boolean;
  planName: string | null;
  accountType: string | null;
  credits: {
    total: number | null;
    used: number | null;
    remaining: number | null;
    overage: number | null;
    resetFrequency: string | null;
    lastReset: string | null;
    nextReset: string | null;
  };
  today: {
    date: string;
    requests: number;
    delivered: number;
    opens: number;
    clicks: number;
    bounces: number;
    blocks: number;
    spamReports: number;
  } | null;
  warnings: string[];
  fetchedAt: string;
}
