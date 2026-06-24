import type { UploadedFile } from 'express-fileupload';
import { Prisma } from '@prisma/client';
import prisma from '../config/prismaClient';
import uploadService from './uploadService';
import {
  DEFAULT_FUNDER_CONTRACT_FILENAME,
  DEFAULT_FUNDER_CONTRACT_LAYOUT_KEY,
  funderContractLayoutKey,
  isFunderContractLayoutKey,
} from '../utils/funderContractLayout';

function toAllowedStatesJson(
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
};

function normalizeStateToken(state?: string | null): string {
  return String(state ?? '')
    .trim()
    .toLowerCase();
}

function parseAllowedStates(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((s) => normalizeStateToken(String(s))).filter(Boolean);
  }
  return [];
}

function stateMatchesAllowed(state: string | null | undefined, allowed: string[]): boolean {
  if (!allowed.length) return true;
  const normalized = normalizeStateToken(state);
  if (!normalized) return true;
  return allowed.some((a) => a === normalized);
}

export function serializeFunderProfile(row: Record<string, unknown>) {
  const docusign = row.docusignAccountProfile as Record<string, unknown> | null | undefined;
  return {
    id: row.id,
    name: row.name,
    displayName: row.displayName ?? null,
    dealIdPrefix: row.dealIdPrefix ?? null,
    assignsDealId: row.assignsDealId === true,
    mainContractLayoutKey: row.mainContractLayoutKey ?? 'contract',
    contractPdfFileName: row.contractPdfFileName ?? null,
    allowedStates: parseAllowedStates(row.allowedStates),
    organization: row.organization ?? null,
    legalName: row.legalName ?? null,
    contactEmail: row.contactEmail ?? null,
    contactPhone: row.contactPhone ?? null,
    addressLine1: row.addressLine1 ?? null,
    addressCity: row.addressCity ?? null,
    addressState: row.addressState ?? null,
    addressZip: row.addressZip ?? null,
    docusignAccountProfileId: row.docusignAccountProfileId ?? null,
    docusignAccountName: docusign?.name ? String(docusign.name) : null,
    sortOrder: Number(row.sortOrder ?? 0),
    isActive: row.isActive !== false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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
        const allowed = parseAllowedStates(row.allowedStates);
        return stateMatchesAllowed(stateFilter, allowed);
      })
    : rows;

  return filtered.map((r) => serializeFunderProfile(r as unknown as Record<string, unknown>));
}

export async function getFunderProfileByName(name: string) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;

  const rows = await prisma.funderProfile.findMany({
    where: { isActive: true },
    include: {
      docusignAccountProfile: true,
    },
  });

  const normalized = trimmed.toLowerCase();
  const row =
    rows.find((r) => String(r.name).trim().toLowerCase() === normalized) ||
    rows.find((r) => String(r.displayName || '').trim().toLowerCase() === normalized);

  if (!row) return null;
  return serializeFunderProfile(row as unknown as Record<string, unknown>);
}

export async function getFunderProfileById(id: string) {
  const row = await prisma.funderProfile.findUnique({
    where: { id },
    include: { docusignAccountProfile: { select: { id: true, name: true, isActive: true } } },
  });
  if (!row) return null;
  return serializeFunderProfile(row as unknown as Record<string, unknown>);
}

export async function getFunderWithDocuSignCredentials(funderName: string) {
  const trimmed = String(funderName || '').trim();
  if (!trimmed) return null;

  const rows = await prisma.funderProfile.findMany({
    where: { isActive: true },
    include: { docusignAccountProfile: true },
  });

  const normalized = trimmed.toLowerCase();
  const row =
    rows.find((r) => String(r.name).trim().toLowerCase() === normalized) ||
    rows.find((r) => String(r.displayName || '').trim().toLowerCase() === normalized);

  if (!row) return null;

  return {
    funder: serializeFunderProfile(row as unknown as Record<string, unknown>),
    docusignProfile: row.docusignAccountProfile,
  };
}

function defaultContractFields(input: FunderProfileInput) {
  const layoutKey = String(input.mainContractLayoutKey || '').trim();
  const fileName = String(input.contractPdfFileName || '').trim();
  const useCustomLayout = isFunderContractLayoutKey(layoutKey);

  return {
    mainContractLayoutKey: useCustomLayout
      ? layoutKey
      : DEFAULT_FUNDER_CONTRACT_LAYOUT_KEY,
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
      allowedStates: toAllowedStatesJson(input.allowedStates),
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
    },
    include: { docusignAccountProfile: { select: { id: true, name: true } } },
  });
  return serializeFunderProfile(row as unknown as Record<string, unknown>);
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
    data.mainContractLayoutKey = isFunderContractLayoutKey(layoutKey)
      ? layoutKey
      : DEFAULT_FUNDER_CONTRACT_LAYOUT_KEY;
  }
  if (input.contractPdfFileName !== undefined) {
    data.contractPdfFileName = input.contractPdfFileName
      ? String(input.contractPdfFileName).trim()
      : DEFAULT_FUNDER_CONTRACT_FILENAME;
  }
  if (input.allowedStates !== undefined) {
    data.allowedStates = toAllowedStatesJson(input.allowedStates);
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

  const row = await prisma.funderProfile.update({
    where: { id },
    data,
    include: { docusignAccountProfile: { select: { id: true, name: true } } },
  });
  return serializeFunderProfile(row as unknown as Record<string, unknown>);
}

export async function deleteFunderProfile(id: string) {
  await prisma.funderProfile.delete({ where: { id } });
  return { success: true };
}
