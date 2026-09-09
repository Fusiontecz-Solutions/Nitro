import prisma from '../../../config/prismaClient';
import { extractSignNowTemplateId } from './signnow-client';

export const SIGNNOW_ACH_DAILY_LAYOUT_KEY = 'ach_daily';
export const SIGNNOW_ACH_WEEKLY_LAYOUT_KEY = 'ach_weekly';
export const SIGNNOW_EXHIBIT_A_LAYOUT_KEY = 'exhibit_a';
export const SIGNNOW_EXHIBIT_C_LAYOUT_KEY = 'exhibit_c';
export const SIGNNOW_FLEX_ADDENDUM_LAYOUT_KEY = 'flex_addendum';
export const SIGNNOW_PAYOFF_ADDENDUM_LAYOUT_KEY = 'payoff_addendum';
export const SIGNNOW_EPA_LAYOUT_KEY = 'epa';
export const SIGNNOW_MONTHLY_FEE_LAYOUT_KEY = 'monthly_fee';
export const SIGNNOW_DISCLOSURE_LAYOUT_KEY = 'signnow_disclosure';

export type SignNowAddendumTemplate = {
  layoutKey: string;
  name: string;
  type: string;
  frequency?: string;
  templateId: string;
};

export function signNowAchDailyTemplateId(): string {
  return String(
    process.env.SIGNNOW_ACH_DAILY_TEMPLATE_ID ||
      '5741b00ce3aa425bb96415ff89b67aa7b8b3daa6',
  ).trim();
}

export function signNowAchWeeklyTemplateId(): string {
  return String(
    process.env.SIGNNOW_ACH_WEEKLY_TEMPLATE_ID ||
      '37c76f0cae974ca085d0acf64bdf054686cb2815',
  ).trim();
}

export function signNowDisclosureTemplateId(): string {
  return String(
    process.env.SIGNNOW_DISCLOSURE_TEMPLATE_ID ||
      'ce1229f11a6942118bded3e3cb8715434dc3f8af',
  ).trim();
}

export function signNowExhibitCTemplateId(): string {
  return String(
    process.env.SIGNNOW_EXHIBIT_C_TEMPLATE_ID ||
      '00fcf8fd543d4c4a8323633190a9066959f081a8',
  ).trim();
}

export function signNowExhibitATemplateId(): string {
  return String(
    process.env.SIGNNOW_EXHIBIT_A_TEMPLATE_ID ||
      'a3f7578942f44c15b392c5cee48ee720c53c8c03',
  ).trim();
}

export function signNowFlexAddendumTemplateId(): string {
  return String(
    process.env.SIGNNOW_FLEX_ADDENDUM_TEMPLATE_ID ||
      'b5c267f0f50e4fd9a7f901c840106984402824f8',
  ).trim();
}

export function signNowPayoffAddendumTemplateId(): string {
  return String(
    process.env.SIGNNOW_PAYOFF_ADDENDUM_TEMPLATE_ID ||
      'f43506d2bed645099045b75bd9abc6f5825e7bf6',
  ).trim();
}

export function signNowEpaTemplateId(): string {
  return String(
    process.env.SIGNNOW_EPA_TEMPLATE_ID ||
      '084719dbcd1142c4b5ce8bcde5e253193fc47a4b',
  ).trim();
}

export function signNowMonthlyFeeTemplateId(): string {
  return String(
    process.env.SIGNNOW_MONTHLY_FEE_TEMPLATE_ID ||
      'd28e14071cc743d699d5ed70dafb5d43256c3fa2',
  ).trim();
}

export function getSignNowAddendumTemplates(): SignNowAddendumTemplate[] {
  const out: SignNowAddendumTemplate[] = [];
  const achDailyId = signNowAchDailyTemplateId();
  if (achDailyId) {
    out.push({
      layoutKey: SIGNNOW_ACH_DAILY_LAYOUT_KEY,
      name: 'ACH Daily',
      type: 'addendum',
      frequency: 'daily',
      templateId: achDailyId,
    });
  }
  const achWeeklyId = signNowAchWeeklyTemplateId();
  if (achWeeklyId) {
    out.push({
      layoutKey: SIGNNOW_ACH_WEEKLY_LAYOUT_KEY,
      name: 'ACH Weekly',
      type: 'addendum',
      frequency: 'weekly',
      templateId: achWeeklyId,
    });
  }
  const exhibitCId = signNowExhibitCTemplateId();
  if (exhibitCId) {
    out.push({
      layoutKey: SIGNNOW_EXHIBIT_C_LAYOUT_KEY,
      name: 'Exhibit C',
      type: 'addendum',
      templateId: exhibitCId,
    });
  }
  const exhibitAId = signNowExhibitATemplateId();
  if (exhibitAId) {
    out.push({
      layoutKey: SIGNNOW_EXHIBIT_A_LAYOUT_KEY,
      name: 'Exhibit A',
      type: 'addendum',
      templateId: exhibitAId,
    });
  }
  const flexAddendumId = signNowFlexAddendumTemplateId();
  if (flexAddendumId) {
    out.push({
      layoutKey: SIGNNOW_FLEX_ADDENDUM_LAYOUT_KEY,
      name: 'Flex Addendum',
      type: 'addendum',
      templateId: flexAddendumId,
    });
  }
  const payoffAddendumId = signNowPayoffAddendumTemplateId();
  if (payoffAddendumId) {
    out.push({
      layoutKey: SIGNNOW_PAYOFF_ADDENDUM_LAYOUT_KEY,
      name: 'PayOff Addendum (Refi)',
      type: 'addendum',
      templateId: payoffAddendumId,
    });
  }
  const epaId = signNowEpaTemplateId();
  if (epaId) {
    out.push({
      layoutKey: SIGNNOW_EPA_LAYOUT_KEY,
      name: 'EPA Nitro Advance',
      type: 'addendum',
      templateId: epaId,
    });
  }
  const monthlyFeeId = signNowMonthlyFeeTemplateId();
  if (monthlyFeeId) {
    out.push({
      layoutKey: SIGNNOW_MONTHLY_FEE_LAYOUT_KEY,
      name: 'Monthly Fee',
      type: 'addendum',
      templateId: monthlyFeeId,
    });
  }
  return out;
}

export function getSignNowDisclosureTemplates(): SignNowAddendumTemplate[] {
  const disclosureId = signNowDisclosureTemplateId();
  if (!disclosureId) return [];
  return [
    {
      layoutKey: SIGNNOW_DISCLOSURE_LAYOUT_KEY,
      name: 'State Disclosure',
      type: 'disclosure',
      templateId: disclosureId,
    },
  ];
}

export function getSignNowSupplementalTemplates(): SignNowAddendumTemplate[] {
  return [...getSignNowAddendumTemplates(), ...getSignNowDisclosureTemplates()];
}

function slugifyTemplateName(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

/** Map Settings labels to known Create Contract layout keys (same rules as FE). */
function knownLayoutKeyFromSettingsName(
  name: string,
  type: 'addendum' | 'disclosure',
): string {
  const slug = slugifyTemplateName(name);
  if (!slug) return '';
  if (type === 'disclosure') {
    if (
      slug === 'state_disclosure' ||
      slug === 'disclosure' ||
      slug === 'signnow_disclosure' ||
      slug.includes('disclosure')
    ) {
      return SIGNNOW_DISCLOSURE_LAYOUT_KEY;
    }
    return '';
  }
  if (slug === 'ach_daily' || (slug.includes('ach') && slug.includes('daily'))) {
    return SIGNNOW_ACH_DAILY_LAYOUT_KEY;
  }
  if (slug === 'ach_weekly' || (slug.includes('ach') && slug.includes('weekly'))) {
    return SIGNNOW_ACH_WEEKLY_LAYOUT_KEY;
  }
  if (
    slug === 'exhibit_c' ||
    slug.includes('exhibit_c') ||
    (slug.includes('exhibit') && slug.includes('ach'))
  ) {
    return SIGNNOW_EXHIBIT_C_LAYOUT_KEY;
  }
  if (slug === 'exhibit_a' || slug.includes('exhibit_a')) {
    return SIGNNOW_EXHIBIT_A_LAYOUT_KEY;
  }
  if (slug === 'flex_addendum' || (slug.includes('flex') && slug.includes('addendum'))) {
    return SIGNNOW_FLEX_ADDENDUM_LAYOUT_KEY;
  }
  if (
    slug === 'payoff_addendum' ||
    slug === 'payoff_addendum_refi' ||
    (slug.includes('payoff') && slug.includes('addendum'))
  ) {
    return SIGNNOW_PAYOFF_ADDENDUM_LAYOUT_KEY;
  }
  if (slug === 'epa' || slug === 'epa_nitro_advance' || (slug.includes('epa') && !slug.includes('discover'))) {
    return SIGNNOW_EPA_LAYOUT_KEY;
  }
  if (slug === 'monthly_fee' || (slug.includes('monthly') && slug.includes('fee'))) {
    return SIGNNOW_MONTHLY_FEE_LAYOUT_KEY;
  }
  return '';
}

export function resolveSignNowAddendumTemplate(
  ref: string | null | undefined,
): SignNowAddendumTemplate | null {
  const raw = String(ref || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const fromCatalog = getSignNowSupplementalTemplates().find(
    (row) =>
      row.layoutKey === lower ||
      row.templateId.toLowerCase() === lower,
  );
  if (fromCatalog) return fromCatalog;

  // Settings → Funders may send a raw SignNow template id / pasted URL.
  const templateId = extractSignNowTemplateId(raw);
  if (!templateId) return null;
  const isDisclosure =
    lower.includes('disclosure') || lower.endsWith('_signnow_disclosure');
  return {
    layoutKey: templateId,
    name: isDisclosure ? 'Disclosure' : 'Addendum',
    type: isDisclosure ? 'disclosure' : 'addendum',
    templateId,
  };
}

type FunderSignNowLinkRow = { name?: string | null; link?: string | null };

function catalogRowFromFunderLink(
  row: FunderSignNowLinkRow,
  type: 'addendum' | 'disclosure',
): SignNowAddendumTemplate | null {
  const name = String(row.name ?? '').trim();
  const link = String(row.link ?? '').trim();
  const templateId = extractSignNowTemplateId(link);
  if (!templateId && !name) return null;
  const known = knownLayoutKeyFromSettingsName(name, type);
  const id = templateId || known || slugifyTemplateName(name);
  if (!id) return null;
  return {
    layoutKey: known || id,
    name: name || (type === 'disclosure' ? 'Disclosure' : 'Addendum'),
    type,
    templateId: id,
  };
}

/** Persist a CRM template row so the addendum picker can map `ach_weekly` (etc.). */
const signNowTemplateRowIdCache = new Map<string, Promise<string>>();
let funderSignNowSettingsCache:
  | { at: number; rows: Array<{ signnowAddendumTemplates: unknown; signnowDisclosureTemplates: unknown }> }
  | null = null;
const FUNDER_SIGNNOW_SETTINGS_TTL_MS = 60_000;

async function resolveSignNowTemplateFromFunderSettings(
  templateId: string,
): Promise<SignNowAddendumTemplate | null> {
  const id = extractSignNowTemplateId(templateId);
  if (!id) return null;
  const now = Date.now();
  if (
    !funderSignNowSettingsCache ||
    now - funderSignNowSettingsCache.at > FUNDER_SIGNNOW_SETTINGS_TTL_MS
  ) {
    const funders = await prisma.funderProfile.findMany({
      select: {
        signnowAddendumTemplates: true,
        signnowDisclosureTemplates: true,
      },
    });
    funderSignNowSettingsCache = { at: now, rows: funders };
  }

  for (const funder of funderSignNowSettingsCache.rows) {
    const buckets: Array<{ rows: unknown; type: 'addendum' | 'disclosure' }> = [
      { rows: funder.signnowAddendumTemplates, type: 'addendum' },
      { rows: funder.signnowDisclosureTemplates, type: 'disclosure' },
    ];
    for (const bucket of buckets) {
      if (!Array.isArray(bucket.rows)) continue;
      for (const raw of bucket.rows) {
        const row = catalogRowFromFunderLink(
          (raw || {}) as FunderSignNowLinkRow,
          bucket.type,
        );
        if (!row) continue;
        if (row.templateId.toLowerCase() === id) return row;
      }
    }
  }
  return null;
}

/** Resolve refs against a funder's Settings SignNow addendum/disclosure links. */
export function resolveSignNowAddendaFromFunderLinks(
  refs: unknown,
  funder: {
    signnowAddendumTemplates?: unknown;
    signnowDisclosureTemplates?: unknown;
  } | null | undefined,
): SignNowAddendumTemplate[] {
  const list = Array.isArray(refs) ? refs : [];
  if (!list.length || !funder) return [];

  const catalog: SignNowAddendumTemplate[] = [];
  const pushRows = (
    rows: unknown,
    type: 'addendum' | 'disclosure',
  ) => {
    if (!Array.isArray(rows)) return;
    for (const raw of rows) {
      const row = catalogRowFromFunderLink(
        (raw || {}) as FunderSignNowLinkRow,
        type,
      );
      if (!row) continue;
      catalog.push(row);
    }
  };
  pushRows(funder.signnowAddendumTemplates, 'addendum');
  pushRows(funder.signnowDisclosureTemplates, 'disclosure');
  if (!catalog.length) return [];

  const seen = new Set<string>();
  const out: SignNowAddendumTemplate[] = [];
  for (const raw of list) {
    const token = String(raw || '').trim().toLowerCase();
    if (!token) continue;
    const templateId = extractSignNowTemplateId(token);
    const match =
      catalog.find(
        (row) =>
          row.templateId.toLowerCase() === token ||
          row.layoutKey.toLowerCase() === token ||
          (templateId && row.templateId.toLowerCase() === templateId) ||
          row.name.toLowerCase() === token ||
          slugifyTemplateName(row.name) === token,
      ) || null;
    if (!match || seen.has(match.templateId)) continue;
    seen.add(match.templateId);
    out.push(match);
  }
  return out;
}

export function isSignNowAddendumLayoutKey(value: unknown): boolean {
  const match = resolveSignNowAddendumTemplate(String(value || ''));
  return Boolean(match && match.type !== 'disclosure');
}

export function isSignNowDisclosureLayoutKey(value: unknown): boolean {
  const match = resolveSignNowAddendumTemplate(String(value || ''));
  return Boolean(match && match.type === 'disclosure');
}

export function isSignNowSupplementalLayoutKey(value: unknown): boolean {
  return Boolean(resolveSignNowAddendumTemplate(String(value || '')));
}

export function resolveSignNowAddendaFromRefs(
  refs: unknown,
  funder?: {
    signnowAddendumTemplates?: unknown;
    signnowDisclosureTemplates?: unknown;
  } | null,
): SignNowAddendumTemplate[] {
  const list = Array.isArray(refs) ? refs : [];
  const fromFunder = resolveSignNowAddendaFromFunderLinks(refs, funder);
  const seen = new Set<string>();
  const out: SignNowAddendumTemplate[] = [];
  const remember = (row: SignNowAddendumTemplate) => {
    const id = String(row.templateId || row.layoutKey)
      .trim()
      .toLowerCase();
    const key = String(row.layoutKey || '')
      .trim()
      .toLowerCase();
    if (id) seen.add(id);
    if (key) seen.add(key);
    out.push(row);
  };
  for (const row of fromFunder) remember(row);

  // Funder Settings may match Monthly Fee (etc.) while the platform disclosure
  // ref is only in the catalog — keep both instead of dropping unmatched refs.
  for (const raw of list) {
    const match = resolveSignNowAddendumTemplate(String(raw || ''));
    if (!match) continue;
    const id = String(match.templateId || match.layoutKey)
      .trim()
      .toLowerCase();
    const key = String(match.layoutKey || '')
      .trim()
      .toLowerCase();
    if ((id && seen.has(id)) || (key && seen.has(key))) continue;
    remember(match);
  }
  return out;
}

/** Persist a CRM template row so the addendum picker can map `ach_weekly` (etc.). */
export async function ensureSignNowAddendumTemplateRow(
  layoutKeyOrId: string,
): Promise<string> {
  const cacheKey = String(layoutKeyOrId || '').trim().toLowerCase();
  if (!cacheKey) {
    throw new Error('Unknown SignNow addendum ""');
  }
  const cached = signNowTemplateRowIdCache.get(cacheKey);
  if (cached) return cached;
  const pending = ensureSignNowAddendumTemplateRowUncached(layoutKeyOrId);
  signNowTemplateRowIdCache.set(cacheKey, pending);
  try {
    const id = await pending;
    signNowTemplateRowIdCache.set(cacheKey, Promise.resolve(id));
    return id;
  } catch (err) {
    signNowTemplateRowIdCache.delete(cacheKey);
    throw err;
  }
}

async function ensureSignNowAddendumTemplateRowUncached(
  layoutKeyOrId: string,
): Promise<string> {
  let def = resolveSignNowAddendumTemplate(layoutKeyOrId);
  if (!def) {
    throw new Error(`Unknown SignNow addendum "${layoutKeyOrId}"`);
  }

  // Raw SignNow ids fall back to generic "Addendum" — recover the Settings → Funders
  // display name. Keep the funder's own SignNow templateId as the stored layoutKey
  // when it differs from the Nitro catalog id so we never overwrite shared rows.
  const genericName =
    !def.name ||
    def.name.toLowerCase() === 'addendum' ||
    def.name.toLowerCase() === 'disclosure' ||
    def.name.toLowerCase() === 'template';
  if (genericName || def.layoutKey === def.templateId) {
    const fromSettings = await resolveSignNowTemplateFromFunderSettings(def.templateId);
    if (fromSettings) {
      const catalogMatch = getSignNowSupplementalTemplates().find(
        (row) =>
          row.layoutKey === fromSettings.layoutKey ||
          row.templateId.toLowerCase() === fromSettings.templateId.toLowerCase(),
      );
      const sameSignNowId =
        Boolean(catalogMatch) &&
        catalogMatch!.templateId.toLowerCase() === def.templateId.toLowerCase();
      def = {
        ...def,
        name: fromSettings.name || def.name,
        // Only adopt the shared layout key when this really is the catalog template.
        layoutKey: sameSignNowId
          ? fromSettings.layoutKey || def.layoutKey
          : def.templateId,
        type: fromSettings.type || def.type,
        templateId: def.templateId,
      };
    }
  }

  // Prefer exact SignNow template id match so funder-specific copies do not update
  // the shared Nitro catalog row for the same logical layout key.
  const existingByTemplateId = await prisma.boldSignTemplate.findFirst({
    where: {
      OR: [{ templateId: def.templateId }, { layoutKey: def.templateId }],
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      layoutKey: true,
      name: true,
      type: true,
      templateId: true,
      frequency: true,
    },
  });
  const existingByLayoutKey =
    existingByTemplateId ||
    (await prisma.boldSignTemplate.findFirst({
      where: {
        OR: [{ layoutKey: def.layoutKey }, { templateId: def.layoutKey }],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        layoutKey: true,
        name: true,
        type: true,
        templateId: true,
        frequency: true,
      },
    }));

  const existing = existingByTemplateId
    ? existingByTemplateId
    : existingByLayoutKey &&
        String(existingByLayoutKey.templateId || '').toLowerCase() ===
          def.templateId.toLowerCase()
      ? existingByLayoutKey
      : null;

  const data = {
    layoutKey: def.layoutKey,
    name: def.name,
    type: def.type,
    templateId: def.templateId,
    frequency: def.frequency || null,
    pdfUrl: `platform://${def.layoutKey}`,
  };

  if (existing?.id) {
    const existingGeneric =
      !existing.name ||
      String(existing.name).toLowerCase() === 'addendum' ||
      String(existing.name).toLowerCase() === 'disclosure' ||
      String(existing.name).toLowerCase() === 'template';
    const nextName =
      existingGeneric && data.name ? data.name : existing.name || data.name;
    const synced = {
      ...data,
      name: nextName,
      // Keep an existing known layout key when this row already belongs to the catalog.
      layoutKey:
        existing.layoutKey &&
        existing.layoutKey !== existing.templateId &&
        data.layoutKey === data.templateId
          ? existing.layoutKey
          : data.layoutKey,
    };
    const needsSync =
      existing.layoutKey !== synced.layoutKey ||
      existing.name !== synced.name ||
      existing.type !== synced.type ||
      existing.templateId !== synced.templateId ||
      String(existing.frequency || '') !== String(synced.frequency || '');
    if (needsSync) {
      await prisma.boldSignTemplate.update({
        where: { id: existing.id },
        data: synced,
      });
    }
    return existing.id;
  }

  const created = await prisma.boldSignTemplate.create({ data });
  return created.id;
}
