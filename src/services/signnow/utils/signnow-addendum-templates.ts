import prisma from '../../../config/prismaClient';

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

export function resolveSignNowAddendumTemplate(
  ref: string | null | undefined,
): SignNowAddendumTemplate | null {
  const raw = String(ref || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  return (
    getSignNowSupplementalTemplates().find(
      (row) =>
        row.layoutKey === lower ||
        row.templateId.toLowerCase() === lower,
    ) || null
  );
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
): SignNowAddendumTemplate[] {
  const list = Array.isArray(refs) ? refs : [];
  const seen = new Set<string>();
  const out: SignNowAddendumTemplate[] = [];
  for (const raw of list) {
    const match = resolveSignNowAddendumTemplate(String(raw || ''));
    if (!match || seen.has(match.layoutKey)) continue;
    seen.add(match.layoutKey);
    out.push(match);
  }
  return out;
}

/** Persist a CRM template row so the addendum picker can map `ach_weekly` (etc.). */
export async function ensureSignNowAddendumTemplateRow(
  layoutKeyOrId: string,
): Promise<string> {
  const def = resolveSignNowAddendumTemplate(layoutKeyOrId);
  if (!def) {
    throw new Error(`Unknown SignNow addendum "${layoutKeyOrId}"`);
  }

  const existing = await prisma.boldSignTemplate.findFirst({
    where: {
      OR: [
        { layoutKey: def.layoutKey },
        { templateId: def.templateId },
        { templateId: def.layoutKey },
      ],
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

  const data = {
    layoutKey: def.layoutKey,
    name: def.name,
    type: def.type,
    templateId: def.templateId,
    frequency: def.frequency || null,
    pdfUrl: `platform://${def.layoutKey}`,
  };

  if (existing?.id) {
    const needsSync =
      existing.layoutKey !== data.layoutKey ||
      existing.name !== data.name ||
      existing.type !== data.type ||
      existing.templateId !== data.templateId ||
      String(existing.frequency || '') !== String(data.frequency || '');
    if (needsSync) {
      await prisma.boldSignTemplate.update({
        where: { id: existing.id },
        data,
      });
    }
    return existing.id;
  }

  const created = await prisma.boldSignTemplate.create({ data });
  return created.id;
}
