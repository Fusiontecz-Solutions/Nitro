export type ClearBusinessHit = {
  groupId: string;
  companyEntityId?: string;
  name: string;
  fein: string;
  address1: string;
  city: string;
  state: string;
  zipCode: string;
  addressBlob: string;
};

export type ClearPersonHit = {
  groupId: string;
  personEntityId?: string;
  firstName: string;
  middleName: string;
  lastName: string;
  ssn: string;
  dateOfBirth: string;
  email: string;
  phoneNumber: string;
  address1: string;
  city: string;
  state: string;
  zipCode: string;
  addressBlob: string;
};

export type ClearBusinessSearchMeta = {
  groupCount?: number;
  groupIds?: string[];
  companyEntityIds?: string[];
  hits?: ClearBusinessHit[];
};

export type ClearPersonSearchMeta = {
  groupCount?: number;
  groupIds?: string[];
  personEntityIds?: string[];
  hits?: ClearPersonHit[];
  ownerId?: string;
  ownerIndex?: number;
  ownerName?: string;
};

export type ClearLookupMetadata = {
  provider?: string;
  searchedAt?: string;
  ownerCount?: number;
  groupCount?: number;
  businessSearch?: ClearBusinessSearchMeta | null;
  personSearches?: ClearPersonSearchMeta[];
  reports?: unknown;
};

export function isClearLookupMetadata(value: unknown): value is ClearLookupMetadata {
  return Boolean(value) && typeof value === "object";
}
