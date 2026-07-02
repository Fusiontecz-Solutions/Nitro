import { axiosPost } from "@/redux/axios";
import type { OpenCorporatesLookupData } from "@/components/application/opencorporatesTypes";

export type OpenCorporatesImportResponse = {
  success: boolean;
  message: string;
  data?: OpenCorporatesLookupData & { searchedAt: string };
};

export async function importOpenCorporatesForApplication(
  applicationId: string,
  payload: {
    searchQuery: string;
    jurisdictionCode?: string;
    sourceUrl?: string;
    companies: OpenCorporatesLookupData["companies"];
  },
): Promise<OpenCorporatesImportResponse> {
  try {
    const response = await axiosPost(`/opencorporates/applications/${applicationId}/import`, payload);
    const body = response.data as {
      success?: boolean;
      message?: string;
      data?: OpenCorporatesLookupData & { searchedAt: string };
    };
    return {
      success: body.success !== false,
      message: body.message ?? "OpenCorporates data imported.",
      data: body.data,
    };
  } catch (error: unknown) {
    const err = error as { response?: { data?: { message?: string } }; message?: string };
    return {
      success: false,
      message:
        err.response?.data?.message ??
        err.message ??
        "Failed to save OpenCorporates import.",
    };
  }
}
