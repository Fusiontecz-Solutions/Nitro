export type BackgroundCheckLinkContext = {
  businessName: string;
  ein: string;
};

export type BackgroundCheckResource = {
  id: string;
  title: string;
  description: string;
  href?: string | ((ctx: BackgroundCheckLinkContext) => string);
  isApi?: boolean;
};

/** Quick links shown beside Mail log / Activity log in the application header. */
export const EXTERNAL_LINKS = [
  {
    label: "SOS Search Link",
    url: "https://www.quicksos.com/secretary-of-state-search",
  },
  {
    label: "Open Corporates Link",
    url: "https://opencorporates.com/",
  },
] as const;

/**
 * Background Check cards — DataMerch first, external links in the middle, TLO last.
 */
export const BACKGROUND_CHECK_RESOURCES: BackgroundCheckResource[] = [
  {
    id: "datamerch",
    title: "DataMerch",
    description: "Industry default database",
    isApi: true,
  },
  {
    id: "opencorporates",
    title: "OpenCorporates",
    description: "Entity registration & status",
    href: ({ businessName }) =>
      businessName.trim()
        ? `https://opencorporates.com/companies?q=${encodeURIComponent(businessName.trim())}`
        : "https://opencorporates.com/",
  },
  {
    id: "sos",
    title: "Secretary of State",
    description: "State business registration",
    href: "https://www.quicksos.com/secretary-of-state-search",
  },
  {
    id: "nyscef",
    title: "NY Court",
    description: "Civil / judgment search",
    href: "https://iapps.courts.state.ny.us/nyscef/CaseSearch",
  },
  {
    id: "google",
    title: "Google Search",
    description: "Open web search for the merchant",
    href: ({ businessName, ein }) => {
      const query = [businessName.trim(), ein.trim()].filter(Boolean).join(" ");
      return query
        ? `https://www.google.com/search?q=${encodeURIComponent(query)}`
        : "https://www.google.com/";
    },
  },
  {
    id: "tlo",
    title: "TLO",
    description: "Identity & background (TLOxp)",
  },
];

export function resolveBackgroundCheckHref(
  resource: BackgroundCheckResource,
  ctx: BackgroundCheckLinkContext,
): string | undefined {
  if (!resource.href) return undefined;
  return typeof resource.href === "function" ? resource.href(ctx) : resource.href;
}
