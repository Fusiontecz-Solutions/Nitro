import { axiosGet } from "@/redux/axios";

export type DataMerchRecord = {
  category?: string;
  note?: string;
  notes?: string;
  addedBy?: string | null;
  createdAt?: string | null;
  funder?: string;
  added_by?: string;
  created_at?: string;
  [key: string]: unknown;
};

export type DataMerchMerchant = {
  fein?: string | null;
  legalName?: string | null;
  legal_name?: string;
  name?: string;
  business_name?: string;
  ein?: string;
  dba?: string | null;
  address?: string | null;
  street1?: string | null;
  street2?: string | null;
  city?: string | null;
  state?: string | null;
  industry?: string | null;
  businessPhone?: string | null;
  businessStartDate?: string | null;
  risk_level?: string;
  records?: DataMerchRecord[];
  notes?: DataMerchRecord[];
  [key: string]: unknown;
};

export type DataMerchLookupData = {
  searchQuery: string;
  searchType: "ein" | "name";
  businessName: string | null;
  ein: string | null;
  merchants: DataMerchMerchant[];
  searchAttempts?: string[];
  raw: unknown;
};

function extractLookupData(payload: unknown): DataMerchLookupData | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const data = (root.data ?? root) as Record<string, unknown>;
  if (!data || typeof data !== "object") return null;
  const merchants = Array.isArray(data.merchants) ? data.merchants : [];
  return {
    searchQuery: String(data.searchQuery ?? ""),
    searchType: data.searchType === "name" ? "name" : "ein",
    businessName:
      data.businessName != null ? String(data.businessName) : null,
    ein: data.ein != null ? String(data.ein) : null,
    merchants: merchants as DataMerchMerchant[],
    searchAttempts: Array.isArray(data.searchAttempts)
      ? data.searchAttempts.map((item) => String(item))
      : undefined,
    raw: data.raw,
  };
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const root = payload as Record<string, unknown>;
  const msg = root.message ?? root.error;
  if (typeof msg === "string" && msg.trim()) return msg;
  if (msg && typeof msg === "object") {
    const nested = (msg as { description?: string }).description;
    if (nested) return nested;
  }
  return fallback;
}

export async function fetchDataMerchForApplication(applicationId: string) {
  const id = String(applicationId ?? "").trim();
  if (!id) {
    return { success: false as const, message: "Application id is required." };
  }

  try {
    const response = await axiosGet(`/datamerch/applications/${encodeURIComponent(id)}/lookup`);
    const data = extractLookupData(response.data);
    if (!data) {
      return { success: false as const, message: "Unexpected DataMerch response." };
    }
    return { success: true as const, data };
  } catch (error: unknown) {
    const err = error as { response?: { data?: unknown }; message?: string };
    return {
      success: false as const,
      message: extractErrorMessage(
        err.response?.data,
        err.message || "Failed to load DataMerch results.",
      ),
    };
  }
}
