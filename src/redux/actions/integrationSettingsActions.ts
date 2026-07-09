import { axiosDelete, axiosGet, axiosPatch, axiosPatchFormData, axiosPost, axiosPostFormData } from "../axios";
import type {
  DocuSignAccountProfile,
  DocuSignAccountProfileInput,
  FunderProfile,
  FunderProfileInput,
} from "@/types/integrationSettingsTypes";

const DEFAULT_CONTRACT_FILENAME = "Contract.pdf";

function appendFunderFormFields(formData: FormData, payload: FunderProfileInput) {
  formData.append("name", payload.name);
  if (payload.displayName) formData.append("displayName", payload.displayName);
  if (payload.dealIdPrefix) formData.append("dealIdPrefix", payload.dealIdPrefix);
  if (payload.assignsDealId != null) {
    formData.append("assignsDealId", String(payload.assignsDealId));
  }
  if (payload.mainContractLayoutKey) {
    formData.append("mainContractLayoutKey", payload.mainContractLayoutKey);
  }
  if (payload.contractPdfFileName) {
    formData.append("contractPdfFileName", payload.contractPdfFileName);
  }
  if (payload.allowedStates !== undefined) {
    formData.append("allowedStates", JSON.stringify(payload.allowedStates));
  }
  if (payload.excludedStates !== undefined) {
    formData.append("excludedStates", JSON.stringify(payload.excludedStates));
  }
  if (payload.organization) formData.append("organization", payload.organization);
  if (payload.legalName) formData.append("legalName", payload.legalName);
  if (payload.contactEmail) formData.append("contactEmail", payload.contactEmail);
  if (payload.contactPhone) formData.append("contactPhone", payload.contactPhone);
  if (payload.defaultCcEmail !== undefined) {
    formData.append("defaultCcEmail", payload.defaultCcEmail || "");
  }
  if (payload.addressLine1) formData.append("addressLine1", payload.addressLine1);
  if (payload.addressCity) formData.append("addressCity", payload.addressCity);
  if (payload.addressState) formData.append("addressState", payload.addressState);
  if (payload.addressZip) formData.append("addressZip", payload.addressZip);
  if (payload.docusignAccountProfileId != null) {
    formData.append("docusignAccountProfileId", payload.docusignAccountProfileId || "");
  }
  if (payload.sortOrder != null) formData.append("sortOrder", String(payload.sortOrder));
  if (payload.isActive != null) formData.append("isActive", String(payload.isActive));
  if (payload.documentsSource) formData.append("documentsSource", payload.documentsSource);
  if (payload.sharedDocumentsFunderId !== undefined) {
    formData.append("sharedDocumentsFunderId", payload.sharedDocumentsFunderId || "");
  }
}

export async function fetchFunderProfiles(
  state?: string | null,
  options?: { activeOnly?: boolean },
): Promise<FunderProfile[]> {
  const params: Record<string, string> = {};
  if (state?.trim()) params.state = state.trim();
  if (options?.activeOnly === false) params.activeOnly = "false";
  const res = await axiosGet("/integration-settings/funders", { params });
  return (res as { data?: { data?: FunderProfile[] } })?.data?.data ?? [];
}

export async function fetchDocuSignAccountProfiles(): Promise<DocuSignAccountProfile[]> {
  const res = await axiosGet("/integration-settings/docusign-accounts");
  return (res as { data?: { data?: DocuSignAccountProfile[] } })?.data?.data ?? [];
}

export async function fetchDocuSignAccountOptions(): Promise<Array<{ id: string; name: string }>> {
  const res = await axiosGet("/integration-settings/docusign-accounts/options");
  return (res as { data?: { data?: Array<{ id: string; name: string }> } })?.data?.data ?? [];
}

export async function createDocuSignAccountProfile(
  payload: DocuSignAccountProfileInput,
): Promise<DocuSignAccountProfile> {
  const res = await axiosPost("/integration-settings/docusign-accounts", payload);
  return (res as { data?: { data?: DocuSignAccountProfile } })?.data?.data as DocuSignAccountProfile;
}

export async function updateDocuSignAccountProfile(
  id: string,
  payload: Partial<DocuSignAccountProfileInput>,
): Promise<DocuSignAccountProfile> {
  const res = await axiosPatch(`/integration-settings/docusign-accounts/${id}`, payload);
  return (res as { data?: { data?: DocuSignAccountProfile } })?.data?.data as DocuSignAccountProfile;
}

export async function deleteDocuSignAccountProfile(id: string): Promise<void> {
  await axiosDelete(`/integration-settings/docusign-accounts/${id}`);
}

export type FunderProfileFiles = {
  contractFile?: File | null;
};

function appendFunderFiles(formData: FormData, files?: FunderProfileFiles | null) {
  if (files?.contractFile) formData.append("contract", files.contractFile);
}

export type FunderDocumentTemplateRow = import("@/utils/funderLayoutKeys").FunderDocumentTemplateRow;

export async function fetchFunderDocuments(funderId: string): Promise<FunderDocumentTemplateRow[]> {
  const res = await axiosGet(`/integration-settings/funders/${funderId}/documents`);
  return (res as { data?: { data?: FunderDocumentTemplateRow[] } })?.data?.data ?? [];
}

export async function uploadFunderDisclosureDocument(
  funderId: string,
  args: { state: string; frequency: string; file: File },
): Promise<void> {
  const formData = new FormData();
  formData.append("state", args.state);
  formData.append("frequency", args.frequency);
  formData.append("file", args.file);
  await axiosPostFormData(`/integration-settings/funders/${funderId}/disclosures`, formData);
}

export async function uploadFunderAddendumDocument(
  funderId: string,
  args: { name: string; coordinateLayoutKey: string; file: File },
): Promise<void> {
  const formData = new FormData();
  formData.append("name", args.name);
  formData.append("coordinateLayoutKey", args.coordinateLayoutKey);
  formData.append("file", args.file);
  await axiosPostFormData(`/integration-settings/funders/${funderId}/addendums`, formData);
}

export async function deleteFunderDocument(funderId: string, templateId: string): Promise<void> {
  await axiosDelete(`/integration-settings/funders/${funderId}/documents/${templateId}`);
}

export async function createFunderProfile(
  payload: FunderProfileInput,
  files?: FunderProfileFiles | File | null,
): Promise<FunderProfile> {
  const normalizedFiles =
    files && files instanceof File
      ? { contractFile: files }
      : (files as FunderProfileFiles | null | undefined);
  const hasUploads = normalizedFiles?.contractFile;
  if (hasUploads) {
    const formData = new FormData();
    appendFunderFormFields(formData, payload);
    appendFunderFiles(formData, normalizedFiles);
    const res = await axiosPostFormData("/integration-settings/funders", formData);
    return (res as { data?: { data?: FunderProfile } })?.data?.data as FunderProfile;
  }
  const res = await axiosPost("/integration-settings/funders", payload);
  return (res as { data?: { data?: FunderProfile } })?.data?.data as FunderProfile;
}

export async function updateFunderProfile(
  id: string,
  payload: Partial<FunderProfileInput>,
  files?: FunderProfileFiles | File | null,
): Promise<FunderProfile> {
  const normalizedFiles =
    files && files instanceof File
      ? { contractFile: files }
      : (files as FunderProfileFiles | null | undefined);
  const hasUploads = normalizedFiles?.contractFile;
  if (hasUploads) {
    const formData = new FormData();
    appendFunderFormFields(formData, payload as FunderProfileInput);
    appendFunderFiles(formData, normalizedFiles);
    const res = await axiosPatchFormData(`/integration-settings/funders/${id}`, formData);
    return (res as { data?: { data?: FunderProfile } })?.data?.data as FunderProfile;
  }
  const res = await axiosPatch(`/integration-settings/funders/${id}`, payload);
  return (res as { data?: { data?: FunderProfile } })?.data?.data as FunderProfile;
}

export { DEFAULT_CONTRACT_FILENAME };

export async function deleteFunderProfile(id: string): Promise<void> {
  await axiosDelete(`/integration-settings/funders/${id}`);
}
