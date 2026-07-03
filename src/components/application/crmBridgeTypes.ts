export const CRM_BRIDGE_RETURN_MESSAGE_TYPE = "crm:bridge-return";

export type CrmBridgeSectionId = "opencorporates" | "nyscef";

export type CrmBridgeSearchMode = "business" | "owner";

export type CrmBridgeLaunchContext = {
  applicationId: string;
  origin: string;
  returnUrl: string;
  sectionId: CrmBridgeSectionId;
  searchMode?: CrmBridgeSearchMode;
  businessName?: string;
  ownerFirstName?: string;
  ownerMiddleName?: string;
  ownerLastName?: string;
};

export type CrmBridgeReturnMessage = {
  type: typeof CRM_BRIDGE_RETURN_MESSAGE_TYPE;
  applicationId: string;
  source: CrmBridgeSectionId;
  returnUrl?: string;
  sectionId?: string;
};

export function buildCrmBackgroundCheckReturnUrl(
  applicationId: string,
  sectionId: CrmBridgeSectionId,
): string {
  const origin =
    (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.replace(/\/$/, "") ||
    window.location.origin;
  return `${origin}/application-details/${applicationId}/background-check#bg-check-${sectionId}`;
}

export function splitOwnerName(fullName: string): {
  firstName: string;
  middleName: string;
  lastName: string;
} {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", middleName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0]!, middleName: "", lastName: "" };
  if (parts.length === 2) {
    return { firstName: parts[0]!, middleName: "", lastName: parts[1]! };
  }
  return {
    firstName: parts[0]!,
    middleName: parts.slice(1, -1).join(" "),
    lastName: parts[parts.length - 1]!,
  };
}

function buildCrmBridgeParamEntries(
  context: CrmBridgeLaunchContext,
): [string, string][] {
  const entries: [string, string][] = [
    ["hardrock_app_id", context.applicationId],
    ["hardrock_origin", context.origin],
    ["crm_app_id", context.applicationId],
    ["crm_origin", context.origin],
    ["crm_return_url", context.returnUrl],
    ["crm_section", context.sectionId],
  ];
  if (context.searchMode) {
    entries.push(["crm_search_mode", context.searchMode]);
  }
  if (context.businessName?.trim()) {
    entries.push(["crm_business_name", context.businessName.trim()]);
  }
  if (context.ownerFirstName?.trim()) {
    entries.push(["crm_owner_first", context.ownerFirstName.trim()]);
  }
  if (context.ownerMiddleName?.trim()) {
    entries.push(["crm_owner_middle", context.ownerMiddleName.trim()]);
  }
  if (context.ownerLastName?.trim()) {
    entries.push(["crm_owner_last", context.ownerLastName.trim()]);
  }
  return entries;
}

export function appendCrmBridgeParams(
  baseUrl: string,
  context: CrmBridgeLaunchContext,
): string {
  const url = new URL(baseUrl);
  for (const [key, value] of buildCrmBridgeParamEntries(context)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/** NYSCEF rejects unknown query params — pass bridge context in the URL hash instead. */
export function appendCrmBridgeHash(
  baseUrl: string,
  context: CrmBridgeLaunchContext,
): string {
  const url = new URL(baseUrl);
  const params = new URLSearchParams();
  for (const [key, value] of buildCrmBridgeParamEntries(context)) {
    params.set(key, value);
  }
  url.hash = params.toString();
  return url.toString();
}

export function isCrmBridgeReturnMessage(data: unknown): data is CrmBridgeReturnMessage {
  if (!data || typeof data !== "object") return false;
  const msg = data as CrmBridgeReturnMessage;
  return msg.type === CRM_BRIDGE_RETURN_MESSAGE_TYPE && Boolean(msg.applicationId);
}

export function handleCrmBridgeReturn(message: CrmBridgeReturnMessage): void {
  const sectionId = message.sectionId || message.source;
  const anchor = document.getElementById(`bg-check-${sectionId}`);
  if (anchor) {
    anchor.scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (message.returnUrl) {
    const hashIndex = message.returnUrl.indexOf("#");
    if (hashIndex >= 0) {
      const hash = message.returnUrl.slice(hashIndex + 1);
      document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
  window.focus();
}
