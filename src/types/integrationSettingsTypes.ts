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
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  funderCount?: number;
};

export type FunderProfile = {
  id: string;
  name: string;
  displayName?: string | null;
  dealIdPrefix?: string | null;
  assignsDealId: boolean;
  mainContractLayoutKey: string;
  contractPdfFileName?: string | null;
  allowedStates: string[];
  organization?: string | null;
  legalName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  addressLine1?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
  docusignAccountProfileId?: string | null;
  docusignAccountName?: string | null;
  sortOrder: number;
  isActive: boolean;
};

export type DocuSignAccountProfileInput = {
  name: string;
  integrationKey: string;
  clientSecret?: string;
  impersonatedUserId: string;
  rsaPrivateKey?: string;
  accountId?: string;
  baseUri?: string;
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
  organization?: string;
  legalName?: string;
  contactEmail?: string;
  contactPhone?: string;
  addressLine1?: string;
  addressCity?: string;
  addressState?: string;
  addressZip?: string;
  docusignAccountProfileId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};
