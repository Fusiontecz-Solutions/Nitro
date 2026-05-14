import { axiosDelete, axiosGet, axiosPost, axiosPut } from "@/redux/axios";
import type { ApiResponse } from "@/types/api.types";

export type TemplateCategory = "contract" | "email" | "letter";

export type TemplateItem = {
  id: string;
  name: string;
  category: TemplateCategory;
  variables: string[];
  body: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
};

type CreateTemplatePayload = {
  name: string;
  category: TemplateCategory;
  variables: string[];
  body: string;
  status?: string;
};

type UpdateTemplatePayload = Partial<CreateTemplatePayload>;

const BASE_PATH = "/payment-templates";
const SESSION_STORAGE_KEY = "ihcrm.paymentTemplates.v1";

/** `undefined` = never loaded; `[]` = loaded, empty list */
let memoryTemplates: TemplateItem[] | undefined;

/** Coalesce parallel `getPaymentTemplates(..., { force: true })` calls (prefetch + tab mount). */
let fetchAllInFlight: Promise<TemplateItem[]> | null = null;

function persistToSession(list: TemplateItem[]) {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota / private mode */
  }
}

function loadFromSession(): TemplateItem[] | undefined {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (raw == null) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return parsed as TemplateItem[];
  } catch {
    return undefined;
  }
}

/**
 * Synchronously read the last known full template list (memory, then session).
 * `undefined` means no cache yet; `[]` is a valid cached empty list.
 */
export function readPaymentTemplatesCache(): TemplateItem[] | undefined {
  if (memoryTemplates !== undefined) return memoryTemplates;
  const fromSession = loadFromSession();
  if (fromSession !== undefined) {
    memoryTemplates = fromSession;
  }
  return memoryTemplates;
}

export function writePaymentTemplatesCache(list: TemplateItem[]) {
  memoryTemplates = list;
  persistToSession(list);
}

export function invalidatePaymentTemplatesCache() {
  memoryTemplates = undefined;
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Warm the cache as soon as the payment deal shell mounts (before Templates tab). */
export function prefetchPaymentTemplates() {
  void getPaymentTemplates(undefined, { force: true }).catch(() => {});
}

function unwrapTemplateList(body: unknown): TemplateItem[] {
  if (Array.isArray(body)) return body as TemplateItem[];
  if (body && typeof body === "object" && "data" in body) {
    const inner = (body as { data: unknown }).data;
    if (Array.isArray(inner)) return inner as TemplateItem[];
  }
  return [];
}

export async function getPaymentTemplates(
  category?: "all" | TemplateCategory,
  opts?: { force?: boolean },
) {
  const fetchAll = !category || category === "all";
  const force = opts?.force ?? false;

  if (!force) {
    const cached = readPaymentTemplatesCache();
    if (cached !== undefined) {
      if (fetchAll) return cached;
      return cached.filter((t) => t.category === category);
    }
  }

  const doRequest = async (): Promise<TemplateItem[]> => {
    const query =
      category && category !== "all"
        ? `?category=${encodeURIComponent(category)}`
        : "";
    const response = await axiosGet(`${BASE_PATH}${query}`);
    const body = response.data as Record<string, unknown>;

    if (body && typeof body === "object" && body.success === false) {
      const msg =
        typeof body.message === "string"
          ? body.message
          : "Failed to load templates";
      throw new Error(msg);
    }

    const list = unwrapTemplateList(body);
    if (
      list.length === 0 &&
      body.data != null &&
      !Array.isArray(body.data)
    ) {
      console.warn("[payment-templates] Unexpected response shape:", body);
    }

    if (fetchAll) {
      writePaymentTemplatesCache(list);
    }

    return list;
  };

  if (fetchAll && force) {
    if (!fetchAllInFlight) {
      fetchAllInFlight = doRequest().finally(() => {
        fetchAllInFlight = null;
      });
    }
    return fetchAllInFlight;
  }

  return doRequest();
}

export async function createPaymentTemplate(payload: CreateTemplatePayload) {
  const response = await axiosPost(BASE_PATH, payload);
  return (response.data as ApiResponse<TemplateItem>).data;
}

export async function updatePaymentTemplate(
  id: string,
  payload: UpdateTemplatePayload,
) {
  const response = await axiosPut(`${BASE_PATH}/${id}`, payload);
  return (response.data as ApiResponse<TemplateItem>).data;
}

export async function deletePaymentTemplate(id: string) {
  await axiosDelete(`${BASE_PATH}/${id}`);
}
