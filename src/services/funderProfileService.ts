import type { UploadedFile } from 'express-fileupload';
import { Prisma } from '@prisma/client';
import prisma from '../config/prismaClient';
import uploadService from './uploadService';
import {
  DEFAULT_FUNDER_CONTRACT_FILENAME,
  DEFAULT_FUNDER_CONTRACT_LAYOUT_KEY,
  FUNDER_SUPPLEMENTAL_LAYOUT_TYPES,
  funderContractLayoutKey,
  funderDisclosureLayoutKeyForState,
  funderNamedAddendumLayoutKey,
  funderSupplementalLayoutKey,
  isFunderContractLayoutKey,
  isFunderOwnedLayoutKey,
  slugifyFunderDocumentToken,
  type FunderSupplementalLayoutType,
} from '../utils/funderContractLayout';
import { isDocumentLayoutKey } from './docusign/platform-document-registry';
import { resolveKatanFunderFromName } from '../utils/katanFunderDealId';
import {
  inferDefaultFunderDocumentsSource,
  normalizeFunderDocumentsSource,
  resolveDocumentsLayoutFunderId,
  canManageFunderDocuments,
} from '../utils/funderDocumentSource';

/** Client-side fallback profile ids (e.g. `fallback-alliance-bridge`) are not DB UUIDs. */
const PERSISTED_FUNDER_PROFILE_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPersistedFunderProfileId(id?: string | null): boolean {
  return PERSISTED_FUNDER_PROFILE_ID_REGEX.test(String(id ?? '').trim());
}

function toStatesJson(
  states?: string[] | null,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (!states?.length) return Prisma.JsonNull;
  return states.map((s) => String(s).trim()).filter(Boolean);
}

export type FunderProfileInput = {
  name: string;
  displayName?: string | null;
  dealIdPrefix?: string | null;
  assignsDealId?: boolean;
  mainContractLayoutKey?: string | null;
  contractPdfFileName?: string | null;
  allowedStates?: string[] | null;
  excludedStates?: string[] | null;
  organization?: string | null;
  legalName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  addressLine1?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
  docusignAccountProfileId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  documentsSource?: string | null;
  sharedDocumentsFunderId?: string | null;
};

import {
  funderStateListIncludes,
  normalizeContractStateToken,
} from '../utils/usStateMatch';

function normalizeStateToken(state?: string | null): string {
  return normalizeContractStateToken(state);
}

function parseStateList(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((s) => normalizeStateToken(String(s))).filter(Boolean);
  }
  return [];
}

export function funderAvailableForState(
  allowedStates: string[],
  excludedStates: string[],
  state?: string | null,
): boolean {
  const normalized = normalizeStateToken(state);
  if (!normalized) return true;

  if (excludedStates.length > 0 && funderStateListIncludes(excludedStates, normalized)) {
    return false;
  }

  if (!allowedStates.length) return true;
  return funderStateListIncludes(allowedStates, normalized);
}

export function serializeFunderProfile(row: Record<string, unknown>) {
  const docusign = row.docusignAccountProfile as Record<string, unknown> | null | undefined;
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    displayName: row.displayName != null ? String(row.displayName) : null,
    dealIdPrefix: row.dealIdPrefix != null ? String(row.dealIdPrefix) : null,
    assignsDealId: row.assignsDealId === true,
    mainContractLayoutKey: String(row.mainContractLayoutKey ?? 'contract'),
    contractPdfFileName: row.contractPdfFileName != null ? String(row.contractPdfFileName) : null,
    allowedStates: parseStateList(row.allowedStates),
    excludedStates: parseStateList(row.excludedStates),
    organization: row.organization != null ? String(row.organization) : null,
    legalName: row.legalName != null ? String(row.legalName) : null,
    contactEmail: row.contactEmail != null ? String(row.contactEmail) : null,
    contactPhone: row.contactPhone != null ? String(row.contactPhone) : null,
    addressLine1: row.addressLine1 != null ? String(row.addressLine1) : null,
    addressCity: row.addressCity != null ? String(row.addressCity) : null,
    addressState: row.addressState != null ? String(row.addressState) : null,
    addressZip: row.addressZip != null ? String(row.addressZip) : null,
    docusignAccountProfileId:
      row.docusignAccountProfileId != null ? String(row.docusignAccountProfileId) : null,
    docusignAccountName: docusign?.name ? String(docusign.name) : null,
    sortOrder: Number(row.sortOrder ?? 0),
    isActive: row.isActive !== false,
    documentsSource: normalizeFunderDocumentsSource(
      row.documentsSource != null ? String(row.documentsSource) : null,
    ),
    sharedDocumentsFunderId:
      row.sharedDocumentsFunderId != null ? String(row.sharedDocumentsFunderId) : null,
    sharedDocumentsFunderName:
      row.sharedDocumentsFunderName != null ? String(row.sharedDocumentsFunderName) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type SerializedFunderProfile = ReturnType<typeof serializeFunderProfile>;

function normalizeFunderLookupToken(value?: string | null): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

export function funderNamesEquivalent(
  left?: string | null,
  right?: string | null,
): boolean {
  const a = normalizeFunderLookupToken(left);
  const b = normalizeFunderLookupToken(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const katanIi = new Set(['katan ii', 'katan 2', 'katan2']);
  const katanIii = new Set(['katan iii', 'katan 3', 'katan3']);
  if (katanIi.has(a) && katanIi.has(b)) return true;
  if (katanIii.has(a) && katanIii.has(b)) return true;
  return false;
}

export function pickCanonicalFunderName(
  profiles: SerializedFunderProfile[],
  funderName?: string | null,
  state?: string | null,
): string {
  const raw = String(funderName ?? '').trim();
  if (!raw) return '';
  const picked = pickFunderProfileFromList(profiles, raw, state);
  return picked?.name ?? raw;
}

export async function resolveStoredContractFunderName(
  funderNameRaw: string | null | undefined,
  contractState?: string | null,
): Promise<string | null> {
  const trimmed = String(funderNameRaw ?? '').trim();
  if (!trimmed) return null;

  const profiles = await listFunderProfiles({ activeOnly: false });
  const canonical = pickCanonicalFunderName(profiles, trimmed, contractState);
  if (pickFunderProfileFromList(profiles, canonical, contractState)) {
    return canonical;
  }

  const katan = resolveKatanFunderFromName(trimmed);
  if (katan) return katan.organization;

  return trimmed;
}

export function pickFunderProfileFromList<T extends SerializedFunderProfile>(
  profiles: T[],
  funderName?: string | null,
  state?: string | null,
): T | undefined {
  const key = normalizeFunderLookupToken(funderName);
  if (!key) return undefined;

  const matches = profiles.filter(
    (p) =>
      funderNamesEquivalent(p.name, key) ||
      funderNamesEquivalent(p.displayName, key),
  );
  if (!matches.length) return undefined;
  if (matches.length === 1) return matches[0];

  const normalizedState = normalizeFunderLookupToken(state);
  if (normalizedState) {
    const forState = matches.filter((p) =>
      funderAvailableForState(p.allowedStates, p.excludedStates, normalizedState),
    );
    if (forState.length === 1) return forState[0];
    if (forState.length > 1) {
      return [...forState].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0];
    }
  }

  return [...matches].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0];
}

export async function resolveFunderProfile(options: {
  funderProfileId?: string | null;
  funderName?: string | null;
  state?: string | null;
}): Promise<SerializedFunderProfile | null> {
  const funderProfileId = String(options.funderProfileId ?? '').trim();
  if (funderProfileId && isPersistedFunderProfileId(funderProfileId)) {
    const row = await prisma.funderProfile.findUnique({
      where: { id: funderProfileId },
      include: { docusignAccountProfile: true },
    });
    if (row?.isActive !== false) {
      return serializeFunderProfile(row as unknown as Record<string, unknown>);
    }
  }

  const funderName = String(options.funderName ?? '').trim();
  if (!funderName) return null;

  const rows = await prisma.funderProfile.findMany({
    where: { isActive: true },
    include: { docusignAccountProfile: true },
  });

  const serialized = rows.map((r) =>
    serializeFunderProfile(r as unknown as Record<string, unknown>),
  );
  return pickFunderProfileFromList(serialized, funderName, options.state) ?? null;
}

export async function listFunderProfiles(options?: { state?: string | null; activeOnly?: boolean }) {
  const where: Prisma.FunderProfileWhereInput = {};
  if (options?.activeOnly !== false) where.isActive = true;

  const rows = await prisma.funderProfile.findMany({
    where,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      docusignAccountProfile: { select: { id: true, name: true, isActive: true } },
    },
  });

  const stateFilter = normalizeStateToken(options?.state);
  const filtered = stateFilter
    ? rows.filter((row) => {
        const allowed = parseStateList(row.allowedStates);
        const excluded = parseStateList(row.excludedStates);
        return funderAvailableForState(allowed, excluded, stateFilter);
      })
    : rows;

  const serialized = filtered.map((r) =>
    serializeFunderProfile(r as unknown as Record<string, unknown>),
  );
  return enrichFunderProfilesWithSharedNames(serialized);
}

async function enrichFunderProfilesWithSharedNames<
  T extends SerializedFunderProfile,
>(profiles: T[]): Promise<T[]> {
  const ownerIds = [
    ...new Set(
      profiles
        .map((p) => p.sharedDocumentsFunderId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (!ownerIds.length) return profiles;

  const owners = await prisma.funderProfile.findMany({
    where: { id: { in: ownerIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(owners.map((o) => [o.id, o.name]));

  return profiles.map((p) => ({
    ...p,
    sharedDocumentsFunderName: p.sharedDocumentsFunderId
      ? nameById.get(p.sharedDocumentsFunderId) ?? null
      : null,
  }));
}

export async function getFunderProfileByName(name: string, state?: string | null) {
  return resolveFunderProfile({ funderName: name, state });
}

export async function getFunderProfileById(id: string) {
  if (!isPersistedFunderProfileId(id)) return null;
  const row = await prisma.funderProfile.findUnique({
    where: { id },
    include: { docusignAccountProfile: { select: { id: true, name: true, isActive: true } } },
  });
  if (!row) return null;
  const [enriched] = await enrichFunderProfilesWithSharedNames([
    serializeFunderProfile(row as unknown as Record<string, unknown>),
  ]);
  return enriched;
}

export function assertCanManageFunderDocuments(profile: SerializedFunderProfile) {
  if (canManageFunderDocuments(profile)) return;
  if (normalizeFunderDocumentsSource(profile.documentsSource) === 'platform') {
    throw new Error(
      'This funder uses platform addendums and disclosures (same as Katan II / Katan III).',
    );
  }
  const ownerName = profile.sharedDocumentsFunderName;
  if (ownerName) {
    throw new Error(`Upload PDFs on "${ownerName}" — this funder shares their documents.`);
  }
  throw new Error('This funder does not manage its own addendum/disclosure uploads.');
}

export async function getFunderWithDocuSignCredentials(
  funderName: string,
  state?: string | null,
) {
  const profile = await resolveFunderProfile({ funderName, state });
  if (!profile) return null;

  if (!isPersistedFunderProfileId(profile.id)) {
    return { funder: profile, docusignProfile: null };
  }

  const row = await prisma.funderProfile.findUnique({
    where: { id: profile.id },
    include: { docusignAccountProfile: true },
  });
  if (!row) return null;

  return {
    funder: profile,
    docusignProfile: row.docusignAccountProfile,
  };
}

function defaultContractFields(input: FunderProfileInput) {
  const layoutKey = String(input.mainContractLayoutKey || '').trim();
  const fileName = String(input.contractPdfFileName || '').trim();
  if (isFunderContractLayoutKey(layoutKey)) {
    return {
      mainContractLayoutKey: layoutKey,
      contractPdfFileName: fileName || DEFAULT_FUNDER_CONTRACT_FILENAME,
    };
  }
  if (isDocumentLayoutKey(layoutKey)) {
    return {
      mainContractLayoutKey: layoutKey,
      contractPdfFileName: fileName || DEFAULT_FUNDER_CONTRACT_FILENAME,
    };
  }

  return {
    mainContractLayoutKey: DEFAULT_FUNDER_CONTRACT_LAYOUT_KEY,
    contractPdfFileName: fileName || DEFAULT_FUNDER_CONTRACT_FILENAME,
  };
}

async function upsertFunderBoldSignTemplate(
  funderId: string,
  funderName: string,
  pdfUrl: string,
) {
  const layoutKey = funderContractLayoutKey(funderId);
  const templateData = {
    name: `${funderName} Contract`,
    type: 'contract',
    layoutKey,
    templateId: layoutKey,
    pdfUrl,
  };

  const existing = await prisma.boldSignTemplate.findFirst({
    where: { OR: [{ layoutKey }, { templateId: layoutKey }] },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    await prisma.boldSignTemplate.update({
      where: { id: existing.id },
      data: templateData,
    });
    return;
  }

  await prisma.boldSignTemplate.create({ data: templateData });
}

export async function uploadFunderContractPdf(
  funderId: string,
  funderName: string,
  file: UploadedFile,
) {
  const mimetype = String(file.mimetype || '').toLowerCase();
  if (mimetype !== 'application/pdf') {
    throw new Error('Only PDF files are allowed for funder contracts.');
  }

  const folder = 'ih-crm/funder-contracts';
  const result = await uploadService.uploadFile(file, folder);
  if (!result.success || !result.data?.secure_url) {
    throw new Error(result.message || 'Failed to upload contract PDF to Cloudinary.');
  }

  const fileName = String(result.fileName || file.name || DEFAULT_FUNDER_CONTRACT_FILENAME).trim();
  const layoutKey = funderContractLayoutKey(funderId);

  await upsertFunderBoldSignTemplate(funderId, funderName, result.data.secure_url);

  const row = await prisma.funderProfile.update({
    where: { id: funderId },
    data: {
      mainContractLayoutKey: layoutKey,
      contractPdfFileName: fileName,
    },
    include: { docusignAccountProfile: { select: { id: true, name: true } } },
  });

  return serializeFunderProfile(row as unknown as Record<string, unknown>);
}

async function upsertFunderSupplementalBoldSignTemplate(
  funderId: string,
  funderName: string,
  supplementalType: FunderSupplementalLayoutType,
  pdfUrl: string,
  fileName: string,
) {
  const layoutKey = funderSupplementalLayoutKey(funderId, supplementalType);
  const label =
    supplementalType === 'flex_addendum'
      ? 'Flex Addendum'
      : supplementalType === 'balance_transfer'
        ? 'Balance Transfer'
        : 'ACH Authorization';
  const templateData = {
    name: `${funderName} ${label}`,
    type: supplementalType,
    layoutKey,
    templateId: layoutKey,
    pdfUrl,
  };

  const existing = await prisma.boldSignTemplate.findFirst({
    where: { OR: [{ layoutKey }, { templateId: layoutKey }] },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    await prisma.boldSignTemplate.update({
      where: { id: existing.id },
      data: templateData,
    });
    return;
  }

  await prisma.boldSignTemplate.create({ data: templateData });
}

export async function uploadFunderSupplementalPdf(
  funderId: string,
  funderName: string,
  supplementalType: FunderSupplementalLayoutType,
  file: UploadedFile,
) {
  const profile = await getFunderProfileById(funderId);
  if (!profile) throw new Error('Funder not found.');
  assertCanManageFunderDocuments(profile);
  const layoutFunderId = resolveDocumentsLayoutFunderId(profile) || funderId;

  const mimetype = String(file.mimetype || '').toLowerCase();
  if (mimetype !== 'application/pdf') {
    throw new Error('Only PDF files are allowed for funder supplemental documents.');
  }

  const folder = `ih-crm/funder-supplemental/${supplementalType}`;
  const result = await uploadService.uploadFile(file, folder);
  if (!result.success || !result.data?.secure_url) {
    throw new Error(result.message || 'Failed to upload supplemental PDF to Cloudinary.');
  }

  const fileName = String(result.fileName || file.name || `${supplementalType}.pdf`).trim();
  await upsertFunderSupplementalBoldSignTemplate(
    layoutFunderId,
    funderName,
    supplementalType,
    result.data.secure_url,
    fileName,
  );

  return {
    layoutKey: funderSupplementalLayoutKey(layoutFunderId, supplementalType),
    fileName,
    supplementalType,
  };
}

export async function uploadFunderDisclosurePdf(
  funderId: string,
  funderName: string,
  state: string,
  frequency: string,
  file: UploadedFile,
) {
  const profile = await getFunderProfileById(funderId);
  if (!profile) throw new Error('Funder not found.');
  assertCanManageFunderDocuments(profile);

  const layoutFunderId = resolveDocumentsLayoutFunderId(profile) || funderId;
  const mimetype = String(file.mimetype || '').toLowerCase();
  if (mimetype !== 'application/pdf') {
    throw new Error('Only PDF files are allowed for funder disclosure documents.');
  }

  const folder = 'ih-crm/funder-disclosures';
  const result = await uploadService.uploadFile(file, folder);
  if (!result.success || !result.data?.secure_url) {
    throw new Error(result.message || 'Failed to upload disclosure PDF to Cloudinary.');
  }

  const normalizedState = normalizeStateToken(state);
  const normalizedFrequency = String(frequency || '').trim().toLowerCase();
  const layoutKey = funderDisclosureLayoutKeyForState(
    layoutFunderId,
    normalizedState,
    normalizedFrequency,
  );
  const fileName = String(result.fileName || file.name || 'disclosure.pdf').trim();
  const templateData = {
    name: `${funderName} ${normalizedState} ${normalizedFrequency} disclosure`.trim(),
    type: 'disclosure',
    state: normalizedState,
    frequency: normalizedFrequency || null,
    layoutKey,
    templateId: layoutKey,
    pdfUrl: result.data.secure_url,
  };

  const existing = await prisma.boldSignTemplate.findFirst({
    where: {
      OR: [{ layoutKey }, { templateId: layoutKey }],
    },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    await prisma.boldSignTemplate.update({
      where: { id: existing.id },
      data: templateData,
    });
  } else {
    await prisma.boldSignTemplate.create({ data: templateData });
  }

  return { layoutKey, fileName, state: normalizedState, frequency: normalizedFrequency };
}

export type FunderDocumentTemplateRow = {
  id: string;
  name: string;
  type: string;
  state: string | null;
  frequency: string | null;
  layoutKey: string | null;
  pdfUrl: string | null;
  createdAt: Date;
};

export async function listFunderDocumentTemplates(funderId: string): Promise<FunderDocumentTemplateRow[]> {
  const profile = await getFunderProfileById(funderId);
  if (!profile) throw new Error('Funder not found.');

  const layoutFunderId = resolveDocumentsLayoutFunderId(profile);
  if (!layoutFunderId) return [];

  const id = String(layoutFunderId || '').trim();
  if (!id) return [];

  const prefix = `funder_${id}_`;
  const contractKey = funderContractLayoutKey(id);
  const rows = await prisma.boldSignTemplate.findMany({
    where: {
      AND: [
        {
          OR: [
            { layoutKey: { startsWith: prefix } },
            { templateId: { startsWith: prefix } },
          ],
        },
        { NOT: { layoutKey: contractKey } },
        { NOT: { templateId: contractKey } },
      ],
    },
    orderBy: [{ type: 'asc' }, { state: 'asc' }, { frequency: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      type: true,
      state: true,
      frequency: true,
      layoutKey: true,
      pdfUrl: true,
      createdAt: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    state: row.state,
    frequency: row.frequency,
    layoutKey: row.layoutKey,
    pdfUrl: row.pdfUrl,
    createdAt: row.createdAt,
  }));
}

export async function uploadFunderNamedAddendumPdf(
  funderId: string,
  funderName: string,
  displayName: string,
  coordinateLayoutKey: string,
  file: UploadedFile,
) {
  const profile = await getFunderProfileById(funderId);
  if (!profile) throw new Error('Funder not found.');
  assertCanManageFunderDocuments(profile);

  const layoutFunderId = resolveDocumentsLayoutFunderId(profile) || funderId;

  const mimetype = String(file.mimetype || '').toLowerCase();
  if (mimetype !== 'application/pdf') {
    throw new Error('Only PDF files are allowed for funder addendum documents.');
  }

  const label = String(displayName || '').trim();
  if (!label) throw new Error('Addendum name is required.');

  const coordsKey = String(coordinateLayoutKey || '').trim();
  if (!coordsKey || !isDocumentLayoutKey(coordsKey)) {
    throw new Error(
      'Select a valid coordinate layout (Flex Addendum, Balance Transfer, or ACH Authorization).',
    );
  }

  const slug = slugifyFunderDocumentToken(label);
  const isStandardSupplemental = (
    FUNDER_SUPPLEMENTAL_LAYOUT_TYPES as readonly string[]
  ).includes(coordsKey);
  const layoutKey = isStandardSupplemental
    ? funderSupplementalLayoutKey(layoutFunderId, coordsKey)
    : funderNamedAddendumLayoutKey(layoutFunderId, slug);
  const folder = `ih-crm/funder-addendums/${slug || 'custom'}`;
  const result = await uploadService.uploadFile(file, folder);
  if (!result.success || !result.data?.secure_url) {
    throw new Error(result.message || 'Failed to upload addendum PDF to Cloudinary.');
  }

  const fileName = String(result.fileName || file.name || `${slug || 'addendum'}.pdf`).trim();
  const templateData = {
    name: label,
    type: coordsKey,
    layoutKey,
    templateId: layoutKey,
    pdfUrl: result.data.secure_url,
  };

  const existing = await prisma.boldSignTemplate.findFirst({
    where: { OR: [{ layoutKey }, { templateId: layoutKey }] },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    await prisma.boldSignTemplate.update({
      where: { id: existing.id },
      data: templateData,
    });
    return { id: existing.id, layoutKey, fileName, name: label, coordinateLayoutKey: coordsKey };
  }

  const created = await prisma.boldSignTemplate.create({ data: templateData });
  return {
    id: created.id,
    layoutKey,
    fileName,
    name: label,
    coordinateLayoutKey: coordsKey,
  };
}

export async function deleteFunderDocumentTemplate(funderId: string, templateId: string) {
  const fid = String(funderId || '').trim();
  const tid = String(templateId || '').trim();
  if (!fid || !tid) throw new Error('Funder id and template id are required.');

  const profile = await getFunderProfileById(fid);
  if (!profile) throw new Error('Funder not found.');
  assertCanManageFunderDocuments(profile);

  const row = await prisma.boldSignTemplate.findUnique({ where: { id: tid } });
  if (!row) throw new Error('Document template not found.');

  const layoutKey = String(row.layoutKey || row.templateId || '').trim();
  const layoutFunderId = resolveDocumentsLayoutFunderId(profile) || fid;
  if (
    !isFunderOwnedLayoutKey(layoutKey, layoutFunderId) ||
    layoutKey === funderContractLayoutKey(fid)
  ) {
    throw new Error('This document does not belong to the selected funder.');
  }

  await prisma.boldSignTemplate.delete({ where: { id: tid } });
  return { id: tid };
}

export async function createFunderProfile(input: FunderProfileInput) {
  const contractDefaults = defaultContractFields(input);
  const row = await prisma.funderProfile.create({
    data: {
      name: String(input.name).trim(),
      displayName: input.displayName ? String(input.displayName).trim() : null,
      dealIdPrefix: input.dealIdPrefix ? String(input.dealIdPrefix).trim().toUpperCase() : null,
      assignsDealId: input.assignsDealId === true,
      mainContractLayoutKey: contractDefaults.mainContractLayoutKey,
      contractPdfFileName: contractDefaults.contractPdfFileName,
      allowedStates: toStatesJson(input.allowedStates),
      excludedStates: toStatesJson(input.excludedStates),
      organization: input.organization ? String(input.organization).trim() : null,
      legalName: input.legalName ? String(input.legalName).trim() : null,
      contactEmail: input.contactEmail ? String(input.contactEmail).trim() : null,
      contactPhone: input.contactPhone ? String(input.contactPhone).trim() : null,
      addressLine1: input.addressLine1 ? String(input.addressLine1).trim() : null,
      addressCity: input.addressCity ? String(input.addressCity).trim() : null,
      addressState: input.addressState ? String(input.addressState).trim() : null,
      addressZip: input.addressZip ? String(input.addressZip).trim() : null,
      docusignAccountProfileId: input.docusignAccountProfileId || null,
      sortOrder: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 0,
      isActive: input.isActive !== false,
      documentsSource: normalizeFunderDocumentsSource(
        input.documentsSource ?? inferDefaultFunderDocumentsSource(input),
      ),
      sharedDocumentsFunderId:
        input.sharedDocumentsFunderId ? String(input.sharedDocumentsFunderId).trim() : null,
    },
    include: { docusignAccountProfile: { select: { id: true, name: true } } },
  });
  const [enriched] = await enrichFunderProfilesWithSharedNames([
    serializeFunderProfile(row as unknown as Record<string, unknown>),
  ]);
  return enriched;
}

export async function updateFunderProfile(id: string, input: Partial<FunderProfileInput>) {
  const existing = await prisma.funderProfile.findUnique({ where: { id } });
  if (!existing) throw new Error('Funder profile not found.');

  const data: Prisma.FunderProfileUpdateInput = {};
  if (input.name !== undefined) data.name = String(input.name).trim();
  if (input.displayName !== undefined) {
    data.displayName = input.displayName ? String(input.displayName).trim() : null;
  }
  if (input.dealIdPrefix !== undefined) {
    data.dealIdPrefix = input.dealIdPrefix ? String(input.dealIdPrefix).trim().toUpperCase() : null;
  }
  if (input.assignsDealId !== undefined) data.assignsDealId = Boolean(input.assignsDealId);
  if (input.mainContractLayoutKey !== undefined) {
    const layoutKey = String(input.mainContractLayoutKey || '').trim();
    data.mainContractLayoutKey =
      isFunderContractLayoutKey(layoutKey) || isDocumentLayoutKey(layoutKey)
        ? layoutKey
        : DEFAULT_FUNDER_CONTRACT_LAYOUT_KEY;
  }
  if (input.contractPdfFileName !== undefined) {
    data.contractPdfFileName = input.contractPdfFileName
      ? String(input.contractPdfFileName).trim()
      : DEFAULT_FUNDER_CONTRACT_FILENAME;
  }
  if (input.allowedStates !== undefined) {
    data.allowedStates = toStatesJson(input.allowedStates);
  }
  if (input.excludedStates !== undefined) {
    data.excludedStates = toStatesJson(input.excludedStates);
  }
  if (input.organization !== undefined) {
    data.organization = input.organization ? String(input.organization).trim() : null;
  }
  if (input.legalName !== undefined) data.legalName = input.legalName ? String(input.legalName).trim() : null;
  if (input.contactEmail !== undefined) {
    data.contactEmail = input.contactEmail ? String(input.contactEmail).trim() : null;
  }
  if (input.contactPhone !== undefined) {
    data.contactPhone = input.contactPhone ? String(input.contactPhone).trim() : null;
  }
  if (input.addressLine1 !== undefined) {
    data.addressLine1 = input.addressLine1 ? String(input.addressLine1).trim() : null;
  }
  if (input.addressCity !== undefined) {
    data.addressCity = input.addressCity ? String(input.addressCity).trim() : null;
  }
  if (input.addressState !== undefined) {
    data.addressState = input.addressState ? String(input.addressState).trim() : null;
  }
  if (input.addressZip !== undefined) data.addressZip = input.addressZip ? String(input.addressZip).trim() : null;
  if (input.docusignAccountProfileId !== undefined) {
    data.docusignAccountProfile =
      input.docusignAccountProfileId ?
        { connect: { id: input.docusignAccountProfileId } }
      : { disconnect: true };
  }
  if (input.sortOrder !== undefined) data.sortOrder = Number(input.sortOrder) || 0;
  if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);
  if (input.documentsSource !== undefined) {
    data.documentsSource = normalizeFunderDocumentsSource(input.documentsSource);
  }
  if (input.sharedDocumentsFunderId !== undefined) {
    data.sharedDocumentsFunderId = input.sharedDocumentsFunderId
      ? String(input.sharedDocumentsFunderId).trim()
      : null;
  }

  const row = await prisma.funderProfile.update({
    where: { id },
    data,
    include: { docusignAccountProfile: { select: { id: true, name: true } } },
  });
  const [enriched] = await enrichFunderProfilesWithSharedNames([
    serializeFunderProfile(row as unknown as Record<string, unknown>),
  ]);
  return enriched;
}

export async function deleteFunderProfile(id: string) {
  await prisma.funderProfile.delete({ where: { id } });
  return { success: true };
}
