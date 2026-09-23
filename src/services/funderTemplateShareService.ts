/**
 * Sharing a funder's SignNow addendum / disclosure templates with other funders.
 *
 * A funder stores its templates as `[{ name, link }]` on its own row
 * (`signnowAddendumTemplates` / `signnowDisclosureTemplates`). Sharing copies
 * the chosen rows onto each target funder's list, so every funder ends up
 * owning an independent, separately editable copy. This is deliberately a copy
 * and not the by-reference `documentsSource: 'shared'` model, which points a
 * funder at another funder's uploads and gives it nothing of its own.
 *
 * The merge always runs against the target's current database row rather than
 * anything the client computed, so two admins sharing at the same time cannot
 * clobber each other's additions.
 */
import { Prisma } from '@prisma/client';

import prisma from '../config/prismaClient';
import { extractSignNowTemplateId } from './signnow/utils/signnow-client';
import type { SignNowTemplateLinkItem } from './funderProfileService';

export const FUNDER_TEMPLATE_KINDS = ['addendum', 'disclosure'] as const;
export type FunderTemplateKind = (typeof FUNDER_TEMPLATE_KINDS)[number];

/** Hard cap so one request cannot fan out across an unbounded number of rows. */
export const MAX_SHARE_TARGETS = 50;
export const MAX_SHARE_TEMPLATES = 100;

export function isFunderTemplateKind(value: unknown): value is FunderTemplateKind {
  return FUNDER_TEMPLATE_KINDS.includes(String(value ?? '') as FunderTemplateKind);
}

export function funderTemplateColumn(
  kind: FunderTemplateKind,
): 'signnowAddendumTemplates' | 'signnowDisclosureTemplates' {
  return kind === 'addendum' ? 'signnowAddendumTemplates' : 'signnowDisclosureTemplates';
}

/**
 * Stable identity of a template row. The 40-char SignNow template id is the real
 * document identity, so the same template pasted as a bare id and as a full
 * `app.signnow.com/webapp/document/<id>` URL counts as one template. Rows whose
 * link we cannot parse fall back to the raw link, then to the name.
 */
export function funderTemplateIdentity(item: SignNowTemplateLinkItem): string {
  const templateId = extractSignNowTemplateId(String(item?.link ?? ''));
  if (templateId) return `signnow:${templateId.toLowerCase()}`;
  const link = String(item?.link ?? '').trim().toLowerCase();
  if (link) return `link:${link}`;
  return `name:${String(item?.name ?? '').trim().toLowerCase()}`;
}

/** Coerce whatever is stored in the Json column into a clean item list. */
export function readFunderTemplateList(raw: unknown): SignNowTemplateLinkItem[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  return list
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const name = String(row.name ?? '').trim();
      const link = String(row.link ?? row.url ?? row.templateLink ?? '').trim();
      if (!name && !link) return null;
      return { name, link };
    })
    .filter((item): item is SignNowTemplateLinkItem => Boolean(item));
}

export type MergeFunderTemplatesResult = {
  merged: SignNowTemplateLinkItem[];
  added: SignNowTemplateLinkItem[];
  skipped: SignNowTemplateLinkItem[];
};

/**
 * Append `incoming` to `existing`, dropping anything the target already has and
 * any duplicate inside `incoming` itself. Existing rows keep their own name, so
 * a funder that renamed its copy does not get overwritten by a re-share.
 */
export function mergeFunderTemplates(
  existing: SignNowTemplateLinkItem[] | null | undefined,
  incoming: SignNowTemplateLinkItem[] | null | undefined,
): MergeFunderTemplatesResult {
  const merged = readFunderTemplateList(existing ?? []);
  const seen = new Set(merged.map((item) => funderTemplateIdentity(item)));
  const added: SignNowTemplateLinkItem[] = [];
  const skipped: SignNowTemplateLinkItem[] = [];

  for (const item of readFunderTemplateList(incoming ?? [])) {
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

export type ShareFunderTemplatesInput = {
  sourceFunderId: string;
  kind: FunderTemplateKind;
  /** Templates picked in the UI. Each must already exist on the source funder. */
  templates: SignNowTemplateLinkItem[];
  targetFunderIds: string[];
};

export type ShareFunderTemplatesTargetResult = {
  funderId: string;
  funderName: string;
  added: SignNowTemplateLinkItem[];
  skipped: SignNowTemplateLinkItem[];
  totalAfter: number;
};

export type ShareFunderTemplatesResult = {
  kind: FunderTemplateKind;
  sourceFunderId: string;
  sourceFunderName: string;
  shared: SignNowTemplateLinkItem[];
  /** Targets that gained at least one template and were written. */
  updated: ShareFunderTemplatesTargetResult[];
  /** Targets that already had every shared template; left untouched. */
  unchanged: ShareFunderTemplatesTargetResult[];
  addedCount: number;
};

/**
 * Copy the selected templates from one funder onto the target funders.
 *
 * The requested templates are matched against the source funder's saved list by
 * identity, so this route can only ever propagate templates the source funder
 * really owns — it is not a general "write arbitrary templates onto any funder"
 * escape hatch. The caller-supplied name is kept as the label for the copy.
 */
export async function shareFunderTemplates(
  input: ShareFunderTemplatesInput,
): Promise<ShareFunderTemplatesResult> {
  const { kind } = input;
  const column = funderTemplateColumn(kind);
  const sourceFunderId = String(input.sourceFunderId ?? '').trim();
  if (!sourceFunderId) throw new Error('Source funder id is required.');

  const requested = readFunderTemplateList(input.templates);
  if (!requested.length) {
    throw new Error(`Select at least one ${kind} to share.`);
  }
  if (requested.length > MAX_SHARE_TEMPLATES) {
    throw new Error(`Cannot share more than ${MAX_SHARE_TEMPLATES} templates at once.`);
  }

  const targetIds = Array.from(
    new Set(
      (Array.isArray(input.targetFunderIds) ? input.targetFunderIds : [])
        .map((id) => String(id ?? '').trim())
        .filter(Boolean),
    ),
  ).filter((id) => id !== sourceFunderId);
  if (!targetIds.length) {
    throw new Error('Select at least one other funder to share with.');
  }
  if (targetIds.length > MAX_SHARE_TARGETS) {
    throw new Error(`Cannot share with more than ${MAX_SHARE_TARGETS} funders at once.`);
  }

  const source = await prisma.funderProfile.findUnique({
    where: { id: sourceFunderId },
    select: { id: true, name: true, [column]: true } as never,
  });
  if (!source) throw new Error('Source funder profile not found.');

  // Only templates the source funder actually holds may be shared.
  const sourceItems = readFunderTemplateList(
    (source as unknown as Record<string, unknown>)[column],
  );
  const sourceIdentities = new Set(sourceItems.map((item) => funderTemplateIdentity(item)));
  const shared: SignNowTemplateLinkItem[] = [];
  const seenRequested = new Set<string>();
  for (const item of requested) {
    const identity = funderTemplateIdentity(item);
    if (!sourceIdentities.has(identity)) {
      throw new Error(
        `"${item.name || item.link}" is not a saved ${kind} on this funder. Save the funder first, then share.`,
      );
    }
    if (seenRequested.has(identity)) continue;
    seenRequested.add(identity);
    shared.push(item);
  }

  const targets = await prisma.funderProfile.findMany({
    where: { id: { in: targetIds } },
    select: { id: true, name: true, [column]: true } as never,
  });
  const foundIds = new Set(targets.map((row) => (row as { id: string }).id));
  const missing = targetIds.filter((id) => !foundIds.has(id));
  if (missing.length) {
    throw new Error(`Funder profile not found: ${missing.join(', ')}`);
  }

  const updated: ShareFunderTemplatesTargetResult[] = [];
  const unchanged: ShareFunderTemplatesTargetResult[] = [];
  const writes: Prisma.PrismaPromise<unknown>[] = [];

  for (const row of targets as unknown as Record<string, unknown>[]) {
    const funderId = String(row.id);
    const funderName = String(row.name ?? '');
    const result = mergeFunderTemplates(readFunderTemplateList(row[column]), shared);
    const entry: ShareFunderTemplatesTargetResult = {
      funderId,
      funderName,
      added: result.added,
      skipped: result.skipped,
      totalAfter: result.merged.length,
    };
    if (!result.added.length) {
      unchanged.push(entry);
      continue;
    }
    updated.push(entry);
    writes.push(
      prisma.funderProfile.update({
        where: { id: funderId },
        data: { [column]: result.merged as unknown as Prisma.InputJsonValue },
      }),
    );
  }

  // One transaction so a failure part-way through leaves no funder half-shared.
  if (writes.length) await prisma.$transaction(writes);

  return {
    kind,
    sourceFunderId,
    sourceFunderName: String((source as unknown as { name?: string }).name ?? ''),
    shared,
    updated,
    unchanged,
    addedCount: updated.reduce((total, entry) => total + entry.added.length, 0),
  };
}

/** One-line summary the client can show as a toast. */
export function describeShareResult(result: ShareFunderTemplatesResult): string {
  const plural = result.kind === 'addendum' ? 'addendums' : 'disclosures';
  const singular = result.kind;
  if (!result.updated.length) {
    return `Every selected funder already had ${
      result.shared.length === 1 ? `this ${singular}` : `these ${plural}`
    }.`;
  }
  const who =
    result.updated.length === 1
      ? result.updated[0].funderName
      : `${result.updated.length} funders`;
  const what = result.addedCount === 1 ? singular : plural;
  const already = result.unchanged.length
    ? ` ${result.unchanged.length} funder${result.unchanged.length === 1 ? '' : 's'} already had them.`
    : '';
  return `Shared ${result.addedCount} ${what} with ${who}.${already}`;
}
