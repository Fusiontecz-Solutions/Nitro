import { randomUUID } from 'crypto';
import prisma from '../config/prismaClient';

type IsoCreateInput = {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  bankAccountNo?: unknown;
  routingNumber?: unknown;
  commissionPercentage?: unknown;
  documents?: unknown;
  agreementAcceptedAt?: unknown;
};

type IsoUpdateInput = Partial<IsoCreateInput>;

type IsoDocumentRecord = {
  id: string;
  url: string;
  originalName: string;
  publicId?: string | null;
  uploadedAt: string;
  /** Portal use: w9 | supporting | other */
  category?: string | null;
};

function parseDocuments(value: unknown): IsoDocumentRecord[] | undefined {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value)) throw new Error('documents must be an array');
  const out: IsoDocumentRecord[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const url = String(o.url ?? '').trim();
    if (!url) continue;
    const idRaw = String(o.id ?? '').trim();
    const catRaw = o.category != null ? String(o.category).trim().toLowerCase().slice(0, 32) : '';
    const category =
      catRaw === 'w9' || catRaw === 'supporting' || catRaw === 'other' ? catRaw : null;

    const rec: IsoDocumentRecord = {
      id: idRaw || randomUUID(),
      url,
      originalName: (String(o.originalName ?? 'Document').trim().slice(0, 500) || 'Document'),
      publicId:
        o.publicId != null && String(o.publicId).trim() ? String(o.publicId).trim() : null,
      uploadedAt:
        typeof o.uploadedAt === 'string' && String(o.uploadedAt).trim()
          ? String(o.uploadedAt).trim()
          : new Date().toISOString(),
    };
    if (category) rec.category = category;
    out.push(rec);
  }
  return out;
}

// Prisma delegate may be missing from generated typings until `prisma generate` runs.
const isoModel = (prisma as any).iso;
let isoTableEnsured = false;

async function ensureIsoTableExists(): Promise<void> {
  if (isoTableEnsured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Iso" (
      "id" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "email" TEXT,
      "phone" TEXT,
      "bankAccountNo" TEXT NOT NULL,
      "routingNumber" TEXT NOT NULL,
      "commissionPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "Iso_pkey" PRIMARY KEY ("id")
    );
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Iso"
    ADD COLUMN IF NOT EXISTS "commissionPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Iso"
    ADD COLUMN IF NOT EXISTS "documents" JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Iso"
    ADD COLUMN IF NOT EXISTS "agreementAcceptedAt" TIMESTAMP(3);
  `);
  isoTableEnsured = true;
}

function parseAgreementAcceptedAt(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error('agreementAcceptedAt must be a valid date');
  return d;
}

const toTrimmedOrNull = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  return v ? v : null;
};

const toRequiredTrimmed = (value: unknown, field: string): string => {
  const v = String(value ?? '').trim();
  if (!v) throw new Error(`${field} is required`);
  return v;
};

const toCommissionPercentage = (value: unknown, field: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a valid number`);
  if (parsed < 0 || parsed > 100) throw new Error(`${field} must be between 0 and 100`);
  return Number(parsed.toFixed(2));
};

async function create(input: IsoCreateInput) {
  await ensureIsoTableExists();
  const name = toRequiredTrimmed(input.name, 'name');
  const bankAccountNo = toRequiredTrimmed(input.bankAccountNo, 'bankAccountNo');
  const routingNumber = toRequiredTrimmed(input.routingNumber, 'routingNumber');
  const commissionPercentage = toCommissionPercentage(input.commissionPercentage, 'commissionPercentage');
  const email = toTrimmedOrNull(input.email);
  const phone = toTrimmedOrNull(input.phone);
  const documents = parseDocuments(input.documents) ?? [];
  const agreementAcceptedAt = parseAgreementAcceptedAt(input.agreementAcceptedAt);

  return isoModel.create({
    data: {
      name,
      email,
      phone,
      bankAccountNo,
      routingNumber,
      commissionPercentage,
      documents,
      ...(agreementAcceptedAt !== undefined && agreementAcceptedAt !== null
        ? { agreementAcceptedAt }
        : {}),
    },
  });
}

async function getAll() {
  await ensureIsoTableExists();
  return isoModel.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      applications: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });
}

async function getById(id: string) {
  await ensureIsoTableExists();
  const isoId = String(id ?? '').trim();
  if (!isoId) throw new Error('id is required');
  return isoModel.findUnique({
    where: { id: isoId },
    include: {
      applications: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });
}

async function update(id: string, input: IsoUpdateInput) {
  await ensureIsoTableExists();
  const isoId = String(id ?? '').trim();
  if (!isoId) throw new Error('id is required');

  const existing = await isoModel.findUnique({ where: { id: isoId } });
  if (!existing) throw new Error('ISO not found');

  const payload: {
    name?: string;
    email?: string | null;
    phone?: string | null;
    bankAccountNo?: string;
    routingNumber?: string;
    commissionPercentage?: number;
    documents?: IsoDocumentRecord[];
    agreementAcceptedAt?: Date | null;
  } = {};

  if (input.name !== undefined) payload.name = toRequiredTrimmed(input.name, 'name');
  if (input.email !== undefined) payload.email = toTrimmedOrNull(input.email);
  if (input.phone !== undefined) payload.phone = toTrimmedOrNull(input.phone);
  if (input.bankAccountNo !== undefined) {
    payload.bankAccountNo = toRequiredTrimmed(input.bankAccountNo, 'bankAccountNo');
  }
  if (input.routingNumber !== undefined) {
    payload.routingNumber = toRequiredTrimmed(input.routingNumber, 'routingNumber');
  }
  if (input.commissionPercentage !== undefined) {
    payload.commissionPercentage = toCommissionPercentage(input.commissionPercentage, 'commissionPercentage');
  }
  if (input.documents !== undefined) {
    payload.documents = parseDocuments(input.documents) ?? [];
  }
  if (input.agreementAcceptedAt !== undefined) {
    payload.agreementAcceptedAt = parseAgreementAcceptedAt(input.agreementAcceptedAt) ?? null;
  }

  if (Object.keys(payload).length === 0) {
    throw new Error('No fields provided to update');
  }

  return isoModel.update({
    where: { id: isoId },
    data: payload,
  });
}

async function remove(id: string) {
  await ensureIsoTableExists();
  const isoId = String(id ?? '').trim();
  if (!isoId) throw new Error('id is required');

  const existing = await isoModel.findUnique({ where: { id: isoId } });
  if (!existing) throw new Error('ISO not found');

  await isoModel.delete({ where: { id: isoId } });
}

const isoService = {
  create,
  getAll,
  getById,
  update,
  delete: remove,
};

export default isoService;
