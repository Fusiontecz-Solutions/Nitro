/**
 * Sharing SignNow addendum / disclosure templates from one funder to another.
 *
 * A funder keeps its templates as `{ name, link }` rows on its own profile row
 * (`signnowAddendumTemplates` / `signnowDisclosureTemplates`). "Sharing" here
 * copies the selected rows onto another funder's profile so the target funder
 * can send the same document, while each funder keeps its own editable list.
 *
 * The write itself is done by the server
 * (`POST /integration-settings/funders/:id/share-templates`), which re-merges
 * against each target's live row. The helpers here mirror the server's identity
 * and merge rules so the dialog can preview what a share would do — "3 new
 * addendums will be added" / "already has all of these" — before sending it.
 */
import type {
  FunderProfile,
  SignNowTemplateLinkItem,
} from "@/types/integrationSettingsTypes";
import { extractSignNowTemplateId } from "@/utils/signnowTemplateLink";

export type FunderTemplateKind = "addendum" | "disclosure";

export const FUNDER_TEMPLATE_KIND_LABELS: Record<
  FunderTemplateKind,
  { singular: string; plural: string }
> = {
  addendum: { singular: "addendum", plural: "addendums" },
  disclosure: { singular: "disclosure", plural: "disclosures" },
};

/** Profile field that stores the templates for a kind. */
export function funderTemplateField(
  kind: FunderTemplateKind,
): "signnowAddendumTemplates" | "signnowDisclosureTemplates" {
  return kind === "addendum"
    ? "signnowAddendumTemplates"
    : "signnowDisclosureTemplates";
}

export function funderTemplatesForKind(
  profile: FunderProfile | null | undefined,
  kind: FunderTemplateKind,
): SignNowTemplateLinkItem[] {
  return profile?.[funderTemplateField(kind)] ?? [];
}

/**
 * Stable identity for a template row. The 40-char SignNow template id is the
 * real document identity; when a row holds something we cannot parse we fall
 * back to the raw link, and finally to the name so blank-link rows still dedupe.
 */
export function funderTemplateIdentity(item: SignNowTemplateLinkItem): string {
  const templateId = extractSignNowTemplateId(item.link);
  if (templateId) return `signnow:${templateId}`;
  const link = String(item.link ?? "").trim().toLowerCase();
  if (link) return `link:${link}`;
  return `name:${String(item.name ?? "").trim().toLowerCase()}`;
}

export type MergeFunderTemplatesResult = {
  merged: SignNowTemplateLinkItem[];
  added: SignNowTemplateLinkItem[];
  skipped: SignNowTemplateLinkItem[];
};

/**
 * Append `incoming` rows to `existing`, dropping any row the target already has
 * and any duplicate inside `incoming` itself. Existing rows keep their own name.
 */
export function mergeFunderTemplates(
  existing: SignNowTemplateLinkItem[] | null | undefined,
  incoming: SignNowTemplateLinkItem[] | null | undefined,
): MergeFunderTemplatesResult {
  const merged: SignNowTemplateLinkItem[] = (existing ?? []).map((item) => ({
    name: String(item.name ?? "").trim(),
    link: String(item.link ?? "").trim(),
  }));
  const seen = new Set(merged.map((item) => funderTemplateIdentity(item)));
  const added: SignNowTemplateLinkItem[] = [];
  const skipped: SignNowTemplateLinkItem[] = [];

  for (const raw of incoming ?? []) {
    const item = {
      name: String(raw?.name ?? "").trim(),
      link: String(raw?.link ?? "").trim(),
    };
    if (!item.name && !item.link) continue;
    const identity = funderTemplateIdentity(item);
    if (seen.has(identity)) {
      skipped.push(item);
      continue;
    }
    seen.add(identity);
    merged.push(item);
    added.push(item);
  }

  return { merged, added, skipped };
}
