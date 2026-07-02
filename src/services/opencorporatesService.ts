import prisma from '../config/prismaClient';
import { NotFoundError, ValidationError } from '../utils/errors';

export type OpenCorporatesOfficer = {
  name: string;
  position?: string;
  status?: 'active' | 'inactive';
};

export type OpenCorporatesAddress = {
  label: string;
  address: string;
};

export type OpenCorporatesIdentifier = {
  system: string;
  value: string;
  category?: string;
};

export type OpenCorporatesCompanyHit = {
  name: string;
  companyNumber: string;
  jurisdictionCode: string;
  currentStatus?: string;
  incorporationDate?: string;
  registeredAddress?: string;
  headOfficeAddress?: string;
  mailingAddress?: string;
  agentName?: string;
  agentAddress?: string;
  addresses?: OpenCorporatesAddress[];
  companyType?: string;
  opencorporatesUrl: string;
  registryUrl?: string;
  officers?: OpenCorporatesOfficer[];
  inactiveOfficers?: OpenCorporatesOfficer[];
  identifiers?: OpenCorporatesIdentifier[];
  dataSource?: string;
  lastUpdateFromSource?: string;
  lastChangeRecorded?: string;
  nextUpdateFromSource?: string;
};

export type OpenCorporatesLookupData = {
  searchQuery: string;
  jurisdictionCode?: string;
  companies: OpenCorporatesCompanyHit[];
  sourceUrl?: string;
  searchedAt: string;
};

function optionalString(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function normalizeOfficers(raw: unknown): OpenCorporatesOfficer[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const officers = raw
    .map((officer) => {
      if (!officer || typeof officer !== 'object') return null;
      const row = officer as Record<string, unknown>;
      const name = String(row.name ?? '').trim();
      if (!name) return null;
      const position = String(row.position ?? '').trim();
      const status = String(row.status ?? '').trim();
      return {
        name,
        ...(position ? { position } : {}),
        ...(status === 'active' || status === 'inactive' ? { status } : {}),
      };
    })
    .filter((officer): officer is OpenCorporatesOfficer => officer != null);
  return officers.length > 0 ? officers : undefined;
}

function normalizeAddresses(raw: unknown): OpenCorporatesAddress[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const addresses = raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const row = entry as Record<string, unknown>;
      const label = String(row.label ?? '').trim();
      const address = String(row.address ?? '').trim();
      if (!label || !address) return null;
      return { label, address };
    })
    .filter((entry): entry is OpenCorporatesAddress => entry != null);
  return addresses.length > 0 ? addresses : undefined;
}

function normalizeIdentifiers(raw: unknown): OpenCorporatesIdentifier[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const identifiers = raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const row = entry as Record<string, unknown>;
      const system = String(row.system ?? '').trim();
      const value = String(row.value ?? '').trim();
      if (!system || !value) return null;
      const category = String(row.category ?? '').trim();
      return {
        system,
        value,
        ...(category ? { category } : {}),
      };
    })
    .filter((entry): entry is OpenCorporatesIdentifier => entry != null);
  return identifiers.length > 0 ? identifiers : undefined;
}

function normalizeCompanyHit(raw: unknown, index: number): OpenCorporatesCompanyHit {
  if (!raw || typeof raw !== 'object') {
    throw new ValidationError(`companies[${index}] must be an object`);
  }
  const item = raw as Record<string, unknown>;
  const name = String(item.name ?? '').trim();
  const companyNumber = String(item.companyNumber ?? '').trim();
  const jurisdictionCode = String(item.jurisdictionCode ?? '').trim().toLowerCase();
  const opencorporatesUrl = String(item.opencorporatesUrl ?? '').trim();

  if (!name || !companyNumber || !jurisdictionCode || !opencorporatesUrl) {
    throw new ValidationError(
      `companies[${index}] requires name, companyNumber, jurisdictionCode, and opencorporatesUrl`,
    );
  }

  const officers = normalizeOfficers(item.officers);
  const inactiveOfficers = normalizeOfficers(item.inactiveOfficers);
  const addresses = normalizeAddresses(item.addresses);
  const identifiers = normalizeIdentifiers(item.identifiers);

  return {
    name,
    companyNumber,
    jurisdictionCode,
    currentStatus: optionalString(item.currentStatus),
    incorporationDate: optionalString(item.incorporationDate),
    registeredAddress: optionalString(item.registeredAddress),
    headOfficeAddress: optionalString(item.headOfficeAddress),
    mailingAddress: optionalString(item.mailingAddress),
    agentName: optionalString(item.agentName),
    agentAddress: optionalString(item.agentAddress),
    companyType: optionalString(item.companyType),
    opencorporatesUrl,
    registryUrl: optionalString(item.registryUrl),
    dataSource: optionalString(item.dataSource),
    lastUpdateFromSource: optionalString(item.lastUpdateFromSource),
    lastChangeRecorded: optionalString(item.lastChangeRecorded),
    nextUpdateFromSource: optionalString(item.nextUpdateFromSource),
    ...(addresses ? { addresses } : {}),
    ...(officers ? { officers } : {}),
    ...(inactiveOfficers ? { inactiveOfficers } : {}),
    ...(identifiers ? { identifiers } : {}),
  };
}

async function assertApplicationExists(applicationId: string): Promise<void> {
  const id = String(applicationId ?? '').trim();
  if (!id) {
    throw new ValidationError('applicationId is required');
  }

  const application = await prisma.application.findFirst({
    where: {
      OR: [
        { id },
        ...(Number.isFinite(Number(id)) ? [{ applicationId: Number(id) }] : []),
        { dealId: id },
      ],
    },
    select: { id: true },
  });

  if (!application) {
    throw new NotFoundError('Application not found');
  }
}

export const opencorporatesService = {
  normalizeImportPayload(body: unknown): {
    searchQuery: string;
    jurisdictionCode?: string;
    sourceUrl?: string;
    companies: OpenCorporatesCompanyHit[];
  } {
    if (!body || typeof body !== 'object') {
      throw new ValidationError('Invalid OpenCorporates import payload');
    }
    const payload = body as Record<string, unknown>;
    const searchQuery = String(payload.searchQuery ?? '').trim();
    if (!searchQuery) {
      throw new ValidationError('searchQuery is required');
    }
    if (!Array.isArray(payload.companies)) {
      throw new ValidationError('companies must be an array');
    }

    return {
      searchQuery,
      jurisdictionCode: String(payload.jurisdictionCode ?? '').trim() || undefined,
      sourceUrl: String(payload.sourceUrl ?? '').trim() || undefined,
      companies: payload.companies.map((company, index) => normalizeCompanyHit(company, index)),
    };
  },

  async importForApplication(
    applicationId: string,
    body: unknown,
  ): Promise<OpenCorporatesLookupData> {
    const normalized = this.normalizeImportPayload(body);
    await assertApplicationExists(applicationId);

    return {
      searchQuery: normalized.searchQuery,
      jurisdictionCode: normalized.jurisdictionCode,
      sourceUrl: normalized.sourceUrl,
      companies: normalized.companies,
      searchedAt: new Date().toISOString(),
    };
  },
};
