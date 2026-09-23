import { Prisma } from '@prisma/client';
import prisma from '../config/prismaClient';
import { withDbRetry } from '../utils/dbRetry';
import uploadService from './uploadService';
import { parseContractLengthDaysFromOfferTerm } from '../utils/deriveFrequencyFromTerm';
import { sanitizePaymentFrequencyForPersist } from '../utils/sanitizePaymentFrequency';
import {
  applyContractCompletedSyncToApplicationRecord,
  syncApplicationToContractGenerated,
} from './contractApplicationWorkflowSync';
import {
  decryptEncryptedStringsInJson,
  mapAchRecordForApi,
  mapBankDetailRecordForApi,
  mapContractRecordForApi,
  decryptSensitiveField,
} from '../utils/fieldEncryption';
import contractKycDocumentExtractService from './contractKycDocumentExtractService';
import {
  EXHIBIT_C_ENTITIES_PREFILL_KEY,
  isKycDocumentType,
  mergeContractPrefillPatch,
  normalizeKycDocumentType,
  resolveKycUploadSlot,
  upsertExhibitCEntitiesJson,
  voidCheckAccountHolderDiffersFromBusiness,
  type KycDocumentType,
  type KycExtractionMapped,
  type KycOwnerIndex,
} from './contractKycPrefillMapper';
import { expandAddendumRefsAllowingDuplicates } from './signnow/utils/signnow-addendum-templates';
import {
  loadContractReverseDisbursementConfig,
  normalizeReverseDisbursementScheduleData,
  renderReverseDisbursementSchedulePdf,
} from './pdf/reverseDisbursementSchedule.service';
import {
  mirrorUploadToApplicationFile,
  removeMirroredApplicationFile,
  slugFromContractDocumentType,
} from './applicationDocumentMirrorService';
import { mergePreservingDocuSignEnvelopeMeta } from './docusign/utils/preserve-docusign-prefill-meta';
import {
  readBankFieldsFromPrefill,
  syncBankFieldsEverywhereSafe,
} from './bankFieldSync';
import {
  applyOfferDerivedValuesToContractRow,
  resolveOfferDerivedContractValues,
} from './contractOfferValueSync';
import { resolveApplicationWhere } from './applicationService';
import { resolveFunderProfile } from './funderProfileService';
import { buildPrefixedDealId } from '../utils/applyFunderDealIdPrefix';
import {
  contractStatesMatch,
  normalizeContractStateToken,
} from '../utils/usStateMatch';
import { OWNER_ORDER_BY } from '../utils/clientOwnerSlots';

const APPLICATION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accept Application UUID `id` or numeric display `applicationId` (e.g. "1115"). */
async function resolveContractApplicationUuid(applicationRef: string): Promise<string | null> {
  const ref = String(applicationRef ?? '').trim();
  if (!ref) return null;
  if (APPLICATION_UUID_RE.test(ref)) return ref;

  const where = resolveApplicationWhere(ref);
  if (!where) return null;

  const app = await prisma.application.findUnique({
    where,
    select: { id: true },
  });
  return app?.id ?? null;
}

/**
 * Prisma 7.9 adapter-pg fans out `include` with Promise.all, each checkout
 * competing for the Neon pool. After a long SignNow send that saturates the
 * pool, that burst becomes `timeout exceeded when trying to connect`.
 * Load relations one query at a time instead.
 */
async function loadContractRowForUpdateResponse(id: number) {
  const row = await prisma.contract.findUnique({ where: { id } });
  if (!row) return null;

  const client = row.clientId
    ? await prisma.client.findUnique({
        where: { id: row.clientId },
        select: { id: true, businessName: true, businessEmail: true },
      })
    : null;
  const application = row.applicationId
    ? await prisma.application.findUnique({
        where: { id: row.applicationId },
        select: { id: true, applicationId: true },
      })
    : null;
  const offer = row.offerId
    ? await prisma.offerDecision.findUnique({
        where: { id: row.offerId },
        select: { id: true },
      })
    : null;
  const paymentTerms = await prisma.paymentTerms.findMany({
    where: { contractId: id },
    select: { id: true, paymentMethod: true, paymentFrequency: true },
  });
  const paymentBank = row.paymentBankId
    ? await prisma.bankDetail.findUnique({
        where: { id: row.paymentBankId },
        select: { id: true, bankName: true },
      })
    : null;

  return { ...row, client, application, offer, paymentTerms, paymentBank };
}

/**
 * When a contract funder is selected, rewrite `Application.dealId` from the
 * numeric core (e.g. `3` / `WF3`) to `{prefix}{core}` using the funder's
 * `dealIdPrefix` from the FunderProfile table (Settings → Funders).
 * No hardcoded funder/prefix map — prefix and organization come from DB only.
 */
async function applyFunderDealIdPrefixToApplication(options: {
  applicationId?: string | null;
  funderName?: string | null;
  funderProfileId?: string | null;
  state?: string | null;
  tx?: any;
}): Promise<void> {
  const applicationId = String(options.applicationId ?? '').trim();
  const funderName = String(options.funderName ?? '').trim();
  if (!applicationId || (!funderName && !options.funderProfileId)) return;

  const db = options.tx ?? prisma;
  const profile = await resolveFunderProfile({
    funderProfileId: options.funderProfileId,
    funderName,
    state: options.state,
  });
  if (!profile) return;

  const prefix = String(profile.dealIdPrefix ?? '')
    .trim()
    .toUpperCase();
  // Presence of a configured Deal ID prefix is enough — Settings UI stores the
  // prefix without always flipping assignsDealId.
  if (!prefix) return;

  const app = await db.application.findUnique({
    where: { id: applicationId },
    select: { id: true, dealId: true },
  });
  if (!app) return;

  const nextDealId = buildPrefixedDealId(app.dealId, prefix);
  if (!nextDealId || nextDealId === String(app.dealId ?? '').trim()) return;

  const organization = String(profile.organization ?? '').trim() || null;
  const updateData: Record<string, unknown> = { dealId: nextDealId };
  if (organization) {
    updateData.organization = organization;
  }

  await db.application.update({
    where: { id: app.id },
    data: updateData,
  });
}

async function resolvePaymentBankDetailForContract(
  prismaClient: typeof prisma | any,
  options: {
    applicationId?: string;
    paymentBankId?: string;
  },
) {
  const { applicationId, paymentBankId } = options;

  const selectBank = {
    id: true,
    bankName: true,
    accountNumber: true,
    routingNumber: true,
  } as const;

  // Bank details are optional at contract creation — filled later from voided check / KYC.
  if (applicationId) {
    if (paymentBankId) {
      const bank = await prismaClient.bankDetail.findFirst({
        where: { id: paymentBankId, applicationId },
        select: selectBank,
      });
      if (bank) return mapBankDetailRecordForApi(bank);
    }
    const bank = await prismaClient.bankDetail.findFirst({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
      select: selectBank,
    });
    return bank ? mapBankDetailRecordForApi(bank) : null;
  }

  if (paymentBankId) {
    const bank = await prismaClient.bankDetail.findUnique({
      where: { id: paymentBankId },
      select: selectBank,
    });
    return bank ? mapBankDetailRecordForApi(bank) : null;
  }

  return null;
}

/** Coerce optional FK to a positive int or null so bogus values (e.g. NaN, 0, placeholders) never hit Prisma. */
/**
 * The ACH form holds the same bank block as the prefill editor and the application bank row —
 * mirror a saved ACH row outward so the values are already filled in everywhere else.
 */
async function syncAchRowBankFields(row: Record<string, unknown>) {
  await syncBankFieldsEverywhereSafe(
    {
      contractId: row.contractId == null ? null : Number(row.contractId),
      clientId: row.clientId == null ? null : String(row.clientId),
    },
    {
      bankName: row.bankName as string | null,
      accountNumber: row.accountNumber as string | null,
      routingNumber: row.routingNumber as string | null,
      bankPortal: row.ach_authorization_bank_portal_website as string | null,
      bankUsername: row.ach_authorization_username as string | null,
    },
    { sourceAchId: row.id == null ? undefined : Number(row.id) },
  );
}

function normalizeBusinessInfoIdForFk(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null;
  return n;
}

const CONTRACT_EXTRA_STRING_FIELDS = [
  'legalName',
  'clientName',
  'entityType',
  'remittance',
  'clientEmail',
  'clientPhone',
  'customerName',
  'purchasePrice',
  'purchaseAmount',
  'purchasePercent',
  'securityTaxEin',
  'businessAddress',
  'businessAddressCity',
  'businessAddressState',
  'businessAddressZip',
  'doingBusinessAs',
  'federalTaxIdEin',
  'exhibitOwnerName',
  'appendixClientName',
  'appendixUnderwritingFees',
  'authorizationApplication',
  'authorizationClientDate',
  'authorizationClientName',
  'authorizationClientNamePrint',
  'authorizationClientTaxId',
  'authorizationClientBankName',
  'authorizationClientBankAccount',
  'authorizationClientBankRouting',
  'achAuthorizationBankPortalWebsite',
  'achAuthorizationUsername',
  'achAuthorizationPassword',
  'achAuthorizationSecurityQuestion1',
  'achAuthorizationSecurityAnswer1',
  'achAuthorizationSecurityQuestion2',
  'achAuthorizationSecurityAnswer2',
  'achAuthorizationSecurityQuestion3',
  'achAuthorizationSecurityAnswer3',
  'achAuthorizationOtherInfomation',
  'authorizedBusinessPhone',
  'businessAddressContract',
  'businessAddressContractCity',
  'businessAddressContractState',
  'businessAddressContractZip',
  'securityBusinessName',
  'securityDoingBusinessAs',
  'securityBusinessAddress',
  'securityBusinessAddressCity',
  'securityBusinessAddressState',
  'securityBusinessAddressZip',
  'securityGuarantor',
] as const;

type ContractExtraStringField = (typeof CONTRACT_EXTRA_STRING_FIELDS)[number];
type ContractExtraFields = Partial<Record<ContractExtraStringField, string | null | undefined>>;

function applyContractExtraFields(target: Record<string, unknown>, source: ContractExtraFields) {
  for (const key of CONTRACT_EXTRA_STRING_FIELDS) {
    if (!(key in source)) continue;
    const raw = source[key];
    target[key] = raw == null ? null : String(raw);
  }
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    const s = String(value ?? '').trim();
    if (s) return s;
  }
  return '';
}

type ContractOwnerSeed = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  state: string | null;
  city: string | null;
  zip: string | null;
  ownershipPercentage: number | null;
};

function ownerSeedHasIdentity(owner: ContractOwnerSeed): boolean {
  return Boolean(owner.firstName || owner.lastName || owner.email);
}

function mapRelatedClientOwnerToSeed(owner: Record<string, unknown>): ContractOwnerSeed {
  const nestedAddress =
    owner.address && typeof owner.address === 'object'
      ? (owner.address as Record<string, unknown>)
      : null;
  return {
    firstName: firstNonEmptyString(owner.firstName),
    lastName: firstNonEmptyString(owner.lastName),
    email: firstNonEmptyString(owner.email) || null,
    phone: firstNonEmptyString(owner.mobileNumber, owner.phone) || null,
    address:
      firstNonEmptyString(
        owner.address1,
        owner.address2,
        nestedAddress?.address1,
        typeof owner.address === 'string' ? owner.address : '',
      ) || null,
    state: firstNonEmptyString(owner.state, nestedAddress?.state) || null,
    city: firstNonEmptyString(owner.city, nestedAddress?.city) || null,
    zip: firstNonEmptyString(owner.zipCode, owner.zip, nestedAddress?.zipCode) || null,
    ownershipPercentage:
      owner.ownershipPercentage != null && owner.ownershipPercentage !== ''
        ? Number(owner.ownershipPercentage)
        : null,
  };
}

/** Up to two CRM owners — ClientOwner[] first, then legacy flat owner fields. */
function resolveClientOwnersForContractSeed(client: Record<string, unknown> | null | undefined): ContractOwnerSeed[] {
  const related = Array.isArray(client?.owners) ? client.owners : [];
  const fromRelated = related
    .map((row) => mapRelatedClientOwnerToSeed((row ?? {}) as Record<string, unknown>))
    .filter(ownerSeedHasIdentity)
    .slice(0, 2);
  if (fromRelated.length) return fromRelated;
  const flat: ContractOwnerSeed = {
    firstName: firstNonEmptyString(client?.ownerFirstName),
    lastName: firstNonEmptyString(client?.ownerLastName),
    email: firstNonEmptyString(client?.ownerEmail, client?.businessEmail) || null,
    phone: firstNonEmptyString(client?.ownerMobileNumber, client?.businessNumber) || null,
    address: firstNonEmptyString(client?.ownerAddress1, client?.ownerAddress2) || null,
    state: firstNonEmptyString(client?.ownerState) || null,
    city: firstNonEmptyString(client?.ownerCity) || null,
    zip: firstNonEmptyString(client?.ownerZipCode) || null,
    ownershipPercentage:
      client?.ownerOwnershipPercentage != null ? Number(client.ownerOwnershipPercentage) : null,
  };
  return ownerSeedHasIdentity(flat) ? [flat] : [];
}

const DOCUMENT_TYPE_FILENAME_SEPARATOR = '::';

function normalizeUploadedDocumentType(raw: unknown): string {
  const input = String(raw ?? '').trim();
  if (!input) return 'Other';
  const key = input.replace(/[\s_-]+/g, '').toLowerCase();
  const byKey: Record<string, string> = {
    voidedcheck: 'Voided Check',
    driverlicense: 'Driver License',
    driverlicenseowner2: 'Driver License Owner 2',
    bankstatement: 'Bank Statement',
    utilitybill: 'Utility Bill',
  };
  if (byKey[key]) return byKey[key];
  return input
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function encodeTypedFileName(documentType: string, originalFileName: string): string {
  const safeType = normalizeUploadedDocumentType(documentType);
  const safeName = String(originalFileName || '').trim() || `${safeType}-${Date.now()}`;
  return `${safeType}${DOCUMENT_TYPE_FILENAME_SEPARATOR}${safeName}`;
}

function decodeTypedFileName(storedFileName: unknown): {
  documentType: string | null;
  displayFileName: string;
} {
  const raw = String(storedFileName ?? '').trim();
  if (!raw) {
    return { documentType: null, displayFileName: '' };
  }
  const idx = raw.indexOf(DOCUMENT_TYPE_FILENAME_SEPARATOR);
  if (idx <= 0) {
    return { documentType: null, displayFileName: raw };
  }
  const maybeType = raw.slice(0, idx).trim();
  const rest = raw.slice(idx + DOCUMENT_TYPE_FILENAME_SEPARATOR.length).trim();
  return {
    documentType: maybeType || null,
    displayFileName: rest || raw,
  };
}

/**
 * Origination fee in dollars, using the same percent-vs-dollars rule as every other
 * offer-derived value so contract creation and the offer sync cannot disagree.
 */
function resolveOfferFeeDollarsForContract(
  fundedAmount: number | null | undefined,
  feesRaw: unknown,
): string | null {
  return resolveOfferDerivedContractValues({ offer: fundedAmount, fees: feesRaw })
    ?.appendixUnderwritingFees ?? null;
}

const OFFER_DECISION_CONTRACT_SELECT = {
  id: true,
  offer: true,
  totalRemit: true,
  term: true,
  frequency: true,
  repayPerPeriod: true,
  rate: true,
  /** Origination fee drives the disclosure broker/underwriting line — keep it on every read. */
  fees: true,
} as const;

/** Latest terms offer fields needed for contract UI (buy rate, % gross, factor, etc.). */
const TERMS_OFFER_CONTRACT_SELECT = {
  id: true,
  termsOfferId: true,
  approvedAmount: true,
  factorRate: true,
  paybackAmount: true,
  paymentAmount: true,
  percentOfGross: true,
  buyRate: true,
  commissionPercent: true,
  commissionAmount: true,
  termLength: true,
  frequency: true,
  position: true,
  numberOfPayments: true,
  createdAt: true,
  updatedAt: true,
} as const;

function mapTermsOfferNestedForApi(offer: Record<string, unknown> | null | undefined) {
  if (!offer || typeof offer !== 'object') return offer;
  const { id, ...rest } = offer;
  return { ...rest, _id: id, id };
}

function enrichContractRowForApi(row: Record<string, unknown> | null | undefined) {
  if (!row) return row;
  // Contract columns are a creation-time snapshot of the offer. Overlay the live
  // OfferDecision so the Info Required step (disclosure / addendum prefill) shows the
  // current terms even when the row predates the last offer change.
  const fresh = applyOfferDerivedValuesToContractRow(row) as Record<string, unknown>;
  const mapped = mapContractRecordForApi(fresh) as Record<string, unknown>;
  const termsOffers = Array.isArray(row.termsOffers)
    ? row.termsOffers.map((t) => mapTermsOfferNestedForApi(t as Record<string, unknown>))
    : row.termsOffers;
  const app = row.application as Record<string, unknown> | undefined;
  const application =
    app && typeof app === 'object'
      ? {
          ...app,
          termsOffers: Array.isArray(app.termsOffers)
            ? app.termsOffers.map((t) =>
                mapTermsOfferNestedForApi(t as Record<string, unknown>),
              )
            : app.termsOffers,
        }
      : app;
  return { ...mapped, termsOffers, application };
}

function mapUploadedDocumentForResponse(row: Record<string, unknown>) {
  const parsed = decodeTypedFileName(row.fileName);
  const explicitType = normalizeUploadedDocumentType(firstNonEmptyString(row.documentType));
  return {
    ...row,
    fileName: parsed.displayFileName || String(row.fileName ?? ''),
    documentType: explicitType || parsed.documentType || 'Other',
  };
}

class ContractService {
  private async resolveBoldSignTemplateRowId(templateRef: string): Promise<string> {
    const ref = String(templateRef || '').trim();
    if (!ref) throw new Error('templateRef is required');
    const { isDocumentLayoutKey, ensurePlatformBoldSignTemplateRow } = await import(
      './docusign/platform-document-registry'
    );
    if (isDocumentLayoutKey(ref)) {
      return ensurePlatformBoldSignTemplateRow(ref);
    }
    const {
      isSignNowSupplementalLayoutKey,
      ensureSignNowAddendumTemplateRow,
    } = await import('./signnow/utils/signnow-addendum-templates');
    if (isSignNowSupplementalLayoutKey(ref)) {
      return ensureSignNowAddendumTemplateRow(ref);
    }
    const byLayoutKey = await (prisma as any).boldSignTemplate.findFirst({
      where: { layoutKey: ref },
      select: { id: true },
    });
    if (byLayoutKey?.id) return byLayoutKey.id;
    const byId = await (prisma as any).boldSignTemplate.findUnique({
      where: { id: ref },
      select: { id: true },
    });
    if (byId?.id) return byId.id;
    const byTemplateId = await (prisma as any).boldSignTemplate.findFirst({
      where: { templateId: ref },
      select: { id: true },
    });
    if (byTemplateId?.id) return byTemplateId.id;
    throw new Error('BoldSign template not found');
  }

  async createContractDocumentTemplateMapping(data: {
    contractId: number;
    templateRef: string;
    documentType: string;
    order?: number;
  }) {
    const contractId = Number(data.contractId);
    if (!Number.isFinite(contractId) || contractId <= 0) {
      throw new Error('Contract not found');
    }
    const contract = await (prisma as any).contract.findUnique({
      where: { id: contractId },
      select: { id: true },
    });
    if (!contract) {
      throw new Error('Contract not found');
    }
    const templateId = await this.resolveBoldSignTemplateRowId(data.templateRef);
    const maxOrderRow = await (prisma as any).contractDocumentTemplateMapping.findFirst({
      where: { contractId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const nextOrder = Number.isFinite(Number(data.order))
      ? Number(data.order)
      : Number(maxOrderRow?.order || 0) + 1;
    return (prisma as any).contractDocumentTemplateMapping.create({
      data: {
        contractId,
        templateId,
        documentType: String(data.documentType || '').trim() || 'other',
        order: nextOrder,
      },
      include: { template: true },
    });
  }

  async getAllContractDocumentTemplateMappings(contractId: number) {
    return (prisma as any).contractDocumentTemplateMapping.findMany({
      where: { contractId },
      include: { template: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async updateContractDocumentTemplateMapping(
    id: string,
    data: { templateRef?: string; documentType?: string; order?: number },
  ) {
    const updateData: any = {};
    if (data.templateRef !== undefined) {
      updateData.templateId = await this.resolveBoldSignTemplateRowId(data.templateRef);
    }
    if (data.documentType !== undefined) {
      updateData.documentType = String(data.documentType || '').trim() || 'other';
    }
    if (data.order !== undefined) {
      updateData.order = Number(data.order);
    }
    return (prisma as any).contractDocumentTemplateMapping.update({
      where: { id },
      data: updateData,
      include: { template: true },
    });
  }

  async deleteContractDocumentTemplateMapping(id: string, contractId?: number) {
    // deleteMany is idempotent — concurrent cleanup can race and hit the same id twice.
    const where: { id: string; contractId?: number } = { id };
    if (contractId != null && Number.isFinite(contractId)) {
      where.contractId = contractId;
    }
    return (prisma as any).contractDocumentTemplateMapping.deleteMany({ where });
  }

  /**
   * Replace every mapping of `documentType` with `templateRefs` in one round trip.
   * Used by the addendum multi-select so five checkboxes do not fire five POSTs.
   */
  async replaceContractDocumentTemplateMappings(data: {
    contractId: number;
    documentType: string;
    templateRefs: string[];
  }) {
    const contractId = Number(data.contractId);
    if (!Number.isFinite(contractId) || contractId <= 0) {
      throw new Error('Contract not found');
    }
    const documentType = String(data.documentType || '').trim() || 'other';

    const contract = await (prisma as any).contract.findUnique({
      where: { id: contractId },
      select: { id: true, funderName: true },
    });
    if (!contract) {
      throw new Error('Contract not found');
    }

    const funderName = String((contract as { funderName?: string | null }).funderName || '').trim();
    const funderRow = funderName
      ? await (prisma as any).funderProfile.findFirst({
          where: { name: funderName },
          select: { signnowAddendumTemplates: true, signnowDisclosureTemplates: true },
        })
      : null;
    // Preserve duplicate Exhibit C refs; still collapse other templates. Funder
    // context here is what lets a funder's own Exhibit C template (often just a
    // bare SignNow hex id, e.g. Obsidian's) still be recognized as Exhibit C —
    // without it, extra copies silently collapsed back to one on save.
    const nextRefs = expandAddendumRefsAllowingDuplicates(
      Array.isArray(data.templateRefs) ? data.templateRefs : [],
      funderRow,
    );

    const existing = await (prisma as any).contractDocumentTemplateMapping.findMany({
      where: { contractId, documentType },
      select: { id: true, templateId: true, order: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });

    const resolved = await Promise.all(
      nextRefs.map(async (templateRef) => ({
        templateRef,
        templateId: await this.resolveBoldSignTemplateRowId(templateRef),
      })),
    );

    // Match desired slots to existing rows by templateId (allowing N rows per template).
    const unusedByTid = new Map<string, Array<{ id: string; order: number }>>();
    for (const row of existing as Array<{ id: string; templateId: string; order: number }>) {
      const tid = String(row.templateId || '');
      if (!tid) continue;
      const list = unusedByTid.get(tid) || [];
      list.push({ id: row.id, order: Number(row.order || 0) });
      unusedByTid.set(tid, list);
    }

    const keepIds = new Set<string>();
    const orderUpdates: Array<{ id: string; order: number }> = [];
    const createSlots: Array<{ templateId: string; order: number }> = [];

    for (let index = 0; index < resolved.length; index += 1) {
      const tid = resolved[index].templateId;
      const pool = unusedByTid.get(tid) || [];
      const nextOrder = index + 1;
      const taken = pool.shift();
      unusedByTid.set(tid, pool);
      if (taken) {
        keepIds.add(taken.id);
        if (taken.order !== nextOrder) {
          orderUpdates.push({ id: taken.id, order: nextOrder });
        }
      } else {
        createSlots.push({ templateId: tid, order: nextOrder });
      }
    }

    const deleteIds = (existing as Array<{ id: string }>)
      .map((row) => row.id)
      .filter((id) => !keepIds.has(id));

    if (deleteIds.length) {
      await (prisma as any).contractDocumentTemplateMapping.deleteMany({
        where: { id: { in: deleteIds } },
      });
    }

    if (createSlots.length) {
      await (prisma as any).contractDocumentTemplateMapping.createMany({
        data: createSlots.map((row) => ({
          contractId,
          templateId: row.templateId,
          documentType,
          order: row.order,
        })),
      });
    }

    if (orderUpdates.length) {
      await (prisma as any).$transaction(
        orderUpdates.map((row) =>
          (prisma as any).contractDocumentTemplateMapping.update({
            where: { id: row.id },
            data: { order: row.order },
          }),
        ),
      );
    }

    return this.getAllContractDocumentTemplateMappings(contractId);
  }

  /**
   * Persist KYC extraction into contract prefill JSON, contract scalar columns, and ACH row.
   * Voided-check scans must update bank fields everywhere they are read (not only JSON overrides).
   */
  async persistKycExtractionToContract(
    contractId: number,
    mapped: KycExtractionMapped,
  ): Promise<Record<string, unknown>> {
    const contractRow = await (prisma as any).contract.findUnique({
      where: { id: contractId },
      select: {
        id: true,
        clientId: true,
        legalName: true,
        contractPrefillOverrides: true,
        client: { select: { businessName: true } },
      },
    });
    if (!contractRow) {
      throw new Error('Contract not found');
    }

    const existingOverrides =
      contractRow.contractPrefillOverrides &&
      typeof contractRow.contractPrefillOverrides === 'object' &&
      !Array.isArray(contractRow.contractPrefillOverrides)
        ? { ...(contractRow.contractPrefillOverrides as Record<string, unknown>) }
        : {};

    const clientBusinessName =
      firstNonEmptyString(
        (contractRow.client as { businessName?: string } | null)?.businessName,
      ) || '';

    /** Prefer live Client.businessName over stale Contract / override snapshots (e.g. void-check OCR). */
    const businessLegalName =
      firstNonEmptyString(
        clientBusinessName,
        contractRow.legalName,
        existingOverrides.legalName,
      ) || '';

    let prefillPatch: Record<string, string> = { ...mapped.contractPrefill };

    if (mapped.documentType === 'voidedCheck' && mapped.panels?.ach) {
      const ach = mapped.panels.ach;
      const holderOnCheck = firstNonEmptyString(ach.fullNameOnAccount) || '';
      if (
        holderOnCheck &&
        voidCheckAccountHolderDiffersFromBusiness(holderOnCheck, businessLegalName)
      ) {
        // Keep merchant legal name; park the check's entity on Exhibit C.
        delete prefillPatch.legalName;
        delete prefillPatch.authorizationClientName;
        delete prefillPatch.authorizationClientNamePrint;
        delete prefillPatch.authorizationApplication;
        delete prefillPatch.securityBusinessName;
        delete prefillPatch.achAuthorizationConcentAccountHolderName;
        // Main ACH holder stays the merchant business name (re-applied on prefill build).
        delete prefillPatch.achAuthorizationAccountHolderName;

        const entities = upsertExhibitCEntitiesJson(
          existingOverrides[EXHIBIT_C_ENTITIES_PREFILL_KEY],
          {
            accountHolderName: holderOnCheck,
            dba: firstNonEmptyString(ach.dba) || undefined,
            bankName: firstNonEmptyString(ach.bankName) || undefined,
            accountNumber: firstNonEmptyString(ach.accountNumber) || undefined,
            routingNumber: firstNonEmptyString(ach.routingNumber) || undefined,
            address: firstNonEmptyString(ach.address) || undefined,
            city: firstNonEmptyString(ach.city) || undefined,
            state: firstNonEmptyString(ach.state) || undefined,
            zip: firstNonEmptyString(ach.zip) || undefined,
          },
        );
        if (entities) {
          prefillPatch[EXHIBIT_C_ENTITIES_PREFILL_KEY] = entities;
        }
      }

      // Heal merchant legal name if an older OCR write poisoned Contract.legalName / overrides.
      if (
        clientBusinessName &&
        voidCheckAccountHolderDiffersFromBusiness(
          firstNonEmptyString(contractRow.legalName, existingOverrides.legalName) || '',
          clientBusinessName,
        )
      ) {
        prefillPatch.legalName = clientBusinessName;
        prefillPatch.securityBusinessName = clientBusinessName;
        prefillPatch.authorizationApplication = clientBusinessName;
        prefillPatch.authorizationClientName = clientBusinessName;
        prefillPatch.authorizationClientSignerName = clientBusinessName;
      }
    }

    const mergedContractPrefillOverrides = mergeContractPrefillPatch(
      existingOverrides,
      prefillPatch,
    );

    const scalarUpdate: ContractExtraFields = {};
    for (const key of CONTRACT_EXTRA_STRING_FIELDS) {
      const val = prefillPatch[key];
      if (firstNonEmptyString(val)) {
        scalarUpdate[key] = String(val).trim();
      }
    }

    await this.updateContract(contractId, {
      contractPrefillOverrides: mergedContractPrefillOverrides,
      ...scalarUpdate,
    });

    if (mapped.documentType === 'voidedCheck' && mapped.panels?.ach) {
      const ach = mapped.panels.ach;
      const achPayload = {
        bankName: firstNonEmptyString(ach.bankName) || undefined,
        accountHolderName: firstNonEmptyString(ach.fullNameOnAccount) || undefined,
        accountNumber: firstNonEmptyString(ach.accountNumber) || undefined,
        routingNumber: firstNonEmptyString(ach.routingNumber) || undefined,
        dba: firstNonEmptyString(ach.dba) || undefined,
        address: firstNonEmptyString(ach.address) || undefined,
        city: firstNonEmptyString(ach.city) || undefined,
        state: firstNonEmptyString(ach.state) || undefined,
        zip: firstNonEmptyString(ach.zip) || undefined,
      };
      const hasAchData = Object.values(achPayload).some((v) => Boolean(v));
      if (hasAchData) {
        const existing = await (prisma as any).aCH.findFirst({
          where: { contractId },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
        });
        if (existing?.id) {
          await this.updateACH(existing.id, achPayload);
        } else if (contractRow.clientId) {
          await this.createACH({
            clientId: contractRow.clientId,
            contractId,
            ...achPayload,
          });
        }
      }
    }

    if (mapped.documentType === 'driverLicense') {
      const ownerIndex: KycOwnerIndex = mapped.ownerIndex === 2 ? 2 : 1;
      if (mapped.panels?.owner) {
        const owner = mapped.panels.owner;
        const ownerFirstName = firstNonEmptyString(owner.firstName);
        const ownerLastName = firstNonEmptyString(owner.lastName);
        if (ownerFirstName || ownerLastName) {
          const ownerPayload = {
            firstName: ownerFirstName || undefined,
            lastName: ownerLastName || undefined,
            address: firstNonEmptyString(owner.address) || undefined,
            city: firstNonEmptyString(owner.city) || undefined,
            state: firstNonEmptyString(owner.state) || undefined,
            zip: firstNonEmptyString(owner.zipCode) || undefined,
          };
          const existingOwners = await (prisma as any).contractOwner.findMany({
            where: { contractId },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
          });
          const existingOwner = existingOwners[ownerIndex - 1];
          if (existingOwner?.id) {
            await this.updateContractOwner(existingOwner.id, ownerPayload);
          } else {
            await this.createContractOwner({
              contractId,
              firstName: ownerFirstName || '—',
              lastName: ownerLastName || '—',
              address: ownerPayload.address,
              city: ownerPayload.city,
              state: ownerPayload.state,
              zip: ownerPayload.zip,
            });
          }
        }
      }

      if (mapped.panels?.guarantor) {
        const guarantor = mapped.panels.guarantor;
        const guarantorFirstName = firstNonEmptyString(guarantor.firstName);
        const guarantorLastName = firstNonEmptyString(guarantor.lastName);
        if (guarantorFirstName || guarantorLastName) {
          const guarantorPayload = {
            firstName: guarantorFirstName || undefined,
            lastName: guarantorLastName || undefined,
            address: firstNonEmptyString(guarantor.address) || undefined,
            city: firstNonEmptyString(guarantor.city) || undefined,
            state: firstNonEmptyString(guarantor.state) || undefined,
            zip: firstNonEmptyString(guarantor.zipCode) || undefined,
            driverLicense: firstNonEmptyString(guarantor.driverLicenseNumber) || undefined,
          };
          const existingGuarantors = await (prisma as any).contractGuarantor.findMany({
            where: { contractId },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
          });
          const existingGuarantor = existingGuarantors[ownerIndex - 1];
          if (existingGuarantor?.id) {
            await this.updateContractGuarantor(existingGuarantor.id, guarantorPayload);
          } else {
            await this.createContractGuarantor({
              contractId,
              firstName: guarantorFirstName || '—',
              lastName: guarantorLastName || '—',
              address: guarantorPayload.address,
              city: guarantorPayload.city,
              state: guarantorPayload.state,
              zip: guarantorPayload.zip,
              driverLicense: guarantorPayload.driverLicense,
            });
          }
        }
      }
    }

    return mergedContractPrefillOverrides;
  }

  async uploadContractDocuments(
    contractId: number,
    filesByType: Record<string, any>,
  ) {
    const contract = await (prisma as any).contract.findUnique({
      where: { id: contractId },
      select: { id: true, contractNumber: true, applicationId: true },
    });

    if (!contract) {
      throw new Error('Contract not found');
    }

    const normalizedEntries = Object.entries(filesByType).flatMap(([documentType, input]) => {
      const fileArray = Array.isArray(input) ? input : [input];
      return fileArray
        .filter(Boolean)
        .map((file) => ({ documentType, file }));
    });

    if (!normalizedEntries.length) {
      throw new Error('No files found to upload');
    }

    const folder = `ih-crm/contracts/${contract.contractNumber || contract.id}`;
    const savedDocuments: any[] = [];
    const kycExtractions: any[] = [];

    for (const { documentType, file } of normalizedEntries) {
      const normalizedType = normalizeUploadedDocumentType(documentType);
      const uploadResult = await uploadService.uploadFile(file, folder, file?.name);
      if (!uploadResult.success || !uploadResult.data) {
        throw new Error(uploadResult.error || `Failed to upload ${documentType}`);
      }

      const secureUrl = uploadResult.data.secure_url as string;
      const publicId = uploadResult.data.public_id as string;

      const metadata = await (prisma as any).fileMetadata.create({
        data: {
          fileName: encodeTypedFileName(
            normalizedType,
            file?.name || uploadResult.fileName || `${documentType}-${Date.now()}`,
          ),
          documentType: normalizedType,
          filePath: publicId,
          fileUrl: secureUrl,
          downloadUrl: secureUrl,
          contentType: file?.mimetype || 'application/octet-stream',
          size: Number(file?.size || uploadResult.data.bytes || 0),
          contractId,
        },
      });

      if (contract.applicationId) {
        await mirrorUploadToApplicationFile({
          applicationId: String(contract.applicationId),
          url: secureUrl,
          publicId,
          originalName: file?.name || uploadResult.fileName || `${normalizedType}`,
          mimeType: file?.mimetype || 'application/octet-stream',
          size: Number(file?.size || uploadResult.data.bytes || 0),
          requestedDocumentSlug: slugFromContractDocumentType(normalizedType),
        });
      }

      savedDocuments.push({
        documentType: normalizedType,
        metadata: mapUploadedDocumentForResponse(metadata as Record<string, unknown>),
      });

      if (isKycDocumentType(documentType)) {
        try {
          const slot = resolveKycUploadSlot(documentType)!;
          const mapped = await contractKycDocumentExtractService.extractFromUploadedFile(
            file,
            slot.documentType,
            slot.ownerIndex,
          );

          kycExtractions.push({
            documentType: mapped.documentType,
            ownerIndex: mapped.ownerIndex,
            slot: mapped.slot,
            keyData: mapped.keyData,
            contractPrefill: mapped.contractPrefill,
            panels: mapped.panels,
          });
        } catch (extractErr: unknown) {
          const msg =
            extractErr instanceof Error ? extractErr.message : 'KYC extraction failed';
          console.error(
            `[uploadContractDocuments] KYC extraction failed for ${documentType}:`,
            extractErr,
          );
          kycExtractions.push({
            documentType: normalizeKycDocumentType(documentType),
            error: msg,
          });
        }
      }
    }

    return { documents: savedDocuments, kycExtractions };
  }

  async extractKycDocumentForContract(
    contractId: number,
    file: any,
    documentTypeRaw: string,
  ) {
    const contract = await (prisma as any).contract.findUnique({
      where: { id: contractId },
      select: { id: true },
    });
    if (!contract) {
      throw new Error('Contract not found');
    }

    const slot = resolveKycUploadSlot(documentTypeRaw);
    if (!slot) {
      throw new Error('documentType must be driverLicense or voidedCheck');
    }

    const mapped = await contractKycDocumentExtractService.extractFromUploadedFile(
      file,
      slot.documentType,
      slot.ownerIndex,
    );

    const mergedContractPrefillOverrides = await this.persistKycExtractionToContract(
      contractId,
      mapped,
    );

    const updated = await this.getByIdContract(contractId);

    return {
      documentType: mapped.documentType,
      ownerIndex: mapped.ownerIndex,
      slot: mapped.slot,
      keyData: mapped.keyData,
      contractPrefill: mapped.contractPrefill,
      panels: mapped.panels,
      mergedContractPrefillOverrides,
      contract: updated,
    };
  }

  /**
   * Apply reviewed KYC extraction (driver license / voided check) to contract prefill + related rows.
   */
  async syncKycPrefillToContract(
    contractId: number,
    payload: {
      documentType: KycDocumentType | string;
      slot?: string;
      ownerIndex?: number;
      contractPrefill?: Record<string, string>;
      panels?: KycExtractionMapped['panels'];
      keyData?: Record<string, string>;
    },
  ) {
    const resolved =
      resolveKycUploadSlot(payload.slot || payload.documentType) ??
      (payload.ownerIndex === 2
        ? resolveKycUploadSlot('driverLicenseOwner2')
        : resolveKycUploadSlot(payload.documentType));
    if (!resolved) {
      throw new Error('documentType must be driverLicense or voidedCheck');
    }

    const mapped: KycExtractionMapped = {
      documentType: resolved.documentType,
      ownerIndex: resolved.ownerIndex,
      slot: resolved.slot,
      keyData: payload.keyData ?? {},
      contractPrefill: payload.contractPrefill ?? {},
      panels: payload.panels ?? {},
    };

    const mergedContractPrefillOverrides = await this.persistKycExtractionToContract(
      contractId,
      mapped,
    );

    const updated = await this.getByIdContract(contractId);

    return {
      documentType: mapped.documentType,
      ownerIndex: mapped.ownerIndex,
      slot: mapped.slot,
      keyData: mapped.keyData,
      contractPrefill: mapped.contractPrefill,
      panels: mapped.panels,
      mergedContractPrefillOverrides,
      contract: updated,
    };
  }

  async getUploadedContractDocuments(contractId: number) {
    const contract = await (prisma as any).contract.findUnique({
      where: { id: contractId },
      select: { id: true },
    });

    if (!contract) {
      throw new Error('Contract not found');
    }

    const rows = await (prisma as any).fileMetadata.findMany({
      where: { contractId },
      orderBy: { uploadedAt: 'desc' },
    });
    return Array.isArray(rows)
      ? rows.map((row: Record<string, unknown>) => mapUploadedDocumentForResponse(row))
      : [];
  }

  async getUploadedContractDocumentById(contractId: number, fileId: string) {
    const contract = await (prisma as any).contract.findUnique({
      where: { id: contractId },
      select: { id: true },
    });

    if (!contract) {
      throw new Error('Contract not found');
    }

    const row = await (prisma as any).fileMetadata.findFirst({
      where: { id: fileId, contractId },
    });
    if (!row) return null;
    return mapUploadedDocumentForResponse(row as Record<string, unknown>);
  }

  async updateUploadedContractDocument(
    contractId: number,
    fileId: string,
    payload: { fileName?: string; file?: any },
  ) {
    const contract = await (prisma as any).contract.findUnique({
      where: { id: contractId },
      select: { id: true, contractNumber: true, applicationId: true },
    });

    if (!contract) {
      throw new Error('Contract not found');
    }

    const existing = await (prisma as any).fileMetadata.findFirst({
      where: { id: fileId, contractId },
    });

    if (!existing) {
      throw new Error('Uploaded file not found');
    }

    const updateData: any = {};
    const existingType = normalizeUploadedDocumentType(
      firstNonEmptyString(
        (existing as Record<string, unknown>).documentType,
        decodeTypedFileName((existing as Record<string, unknown>).fileName).documentType,
      ),
    );

    if (payload.fileName) {
      updateData.fileName = encodeTypedFileName(existingType, payload.fileName);
      updateData.documentType = existingType;
    }

    if (payload.file) {
      const folder = `ih-crm/contracts/${contract.contractNumber || contract.id}`;
      const uploadResult = await uploadService.uploadFile(payload.file, folder, payload.file.name);
      if (!uploadResult.success || !uploadResult.data) {
        throw new Error(uploadResult.error || 'Failed to upload replacement file');
      }

      // Best effort cleanup of old asset if it exists in Cloudinary.
      if (existing.filePath) {
        await uploadService.deleteFile(existing.filePath, 'raw');
      }

      updateData.fileName = encodeTypedFileName(
        existingType,
        payload.file?.name || updateData.fileName || existing.fileName,
      );
      updateData.documentType = existingType;
      updateData.filePath = uploadResult.data.public_id;
      updateData.fileUrl = uploadResult.data.secure_url;
      updateData.downloadUrl = uploadResult.data.secure_url;
      updateData.contentType = payload.file?.mimetype || 'application/octet-stream';
      updateData.size = Number(payload.file?.size || uploadResult.data.bytes || 0);
    }

    if (!Object.keys(updateData).length) {
      return mapUploadedDocumentForResponse(existing as Record<string, unknown>);
    }

    const updated = await (prisma as any).fileMetadata.update({
      where: { id: fileId },
      data: updateData,
    });
    if (contract.applicationId && (updateData.fileUrl || updateData.filePath)) {
      await removeMirroredApplicationFile({
        applicationId: String(contract.applicationId),
        url: existing.fileUrl,
        publicId: existing.filePath,
      });
      await mirrorUploadToApplicationFile({
        applicationId: String(contract.applicationId),
        url: String(updated.fileUrl || ''),
        publicId: String(updated.filePath || ''),
        originalName: decodeTypedFileName(updated.fileName).displayFileName,
        mimeType: updated.contentType,
        size: Number(updated.size || 0),
        requestedDocumentSlug: slugFromContractDocumentType(updated.documentType),
      });
    }
    return mapUploadedDocumentForResponse(updated as Record<string, unknown>);
  }

  async deleteUploadedContractDocument(contractId: number, fileId: string) {
    const contract = await (prisma as any).contract.findUnique({
      where: { id: contractId },
      select: { id: true, applicationId: true },
    });

    if (!contract) {
      throw new Error('Contract not found');
    }

    const existing = await (prisma as any).fileMetadata.findFirst({
      where: { id: fileId, contractId },
    });

    if (!existing) {
      throw new Error('Uploaded file not found');
    }

    if (existing.filePath) {
      await uploadService.deleteFile(existing.filePath, 'raw');
    }

    if (contract.applicationId) {
      await removeMirroredApplicationFile({
        applicationId: String(contract.applicationId),
        url: existing.fileUrl,
        publicId: existing.filePath,
      });
    }

    await (prisma as any).fileMetadata.delete({
      where: { id: fileId },
    });

    return { id: fileId };
  }



  async createContract(data: {
    clientId?: string;
    applicationId?: string;
    offerId?: string;
    startDate?: Date | string;
    endDate?: Date | string;
    contractLenght?: number;
    approvedAmount?: number;
    totalAmount?: number;
    status?:
    | 'DRAFT'
    | 'SENT'
    | 'VIEWED'
    | 'SIGNED'
    | 'COMPLETED'
    | 'DECLINED'
    | 'REVOKED'
    | 'EXPIRED';
    createdById?: string;
    agreementDate?: Date | string;
    paymentBankId?: string;
    state?: string | null;
    funderName?: string | null;
  } & ContractExtraFields) {
    const application = data.applicationId
      ? await (prisma as any).application.findUnique({
        where: { id: data.applicationId },
        select: {
          id: true,
          applicationId: true,
          clientId: true,
          createdById: true,
          client: {
            select: {
              id: true,
              businessName: true,
              businessEmail: true,
              businessNumber: true,
              businessAddress1: true,
              businessAddress2: true,
              businessCity: true,
              businessState: true,
              businessZipCode: true,
              businessEinNumber: true,
              businessEntityType: true,
              ownerFirstName: true,
              ownerLastName: true,
              ownerEmail: true,
              ownerMobileNumber: true,
              ownerAddress1: true,
              ownerAddress2: true,
              ownerCity: true,
              ownerState: true,
              ownerZipCode: true,
              ownerOwnershipPercentage: true,
              owners: {
                orderBy: OWNER_ORDER_BY,
                take: 2,
                select: {
                  firstName: true,
                  lastName: true,
                  email: true,
                  mobileNumber: true,
                  address1: true,
                  address2: true,
                  city: true,
                  state: true,
                  zipCode: true,
                  ownershipPercentage: true,
                },
              },
            },
          },
          salesRepresentative: { select: { id: true } },
          referringAgent: { select: { id: true } },
          OfferDecision: {
            select: {
              id: true,
              offer: true,
              totalRemit: true,
              term: true,
              frequency: true,
              repayPerPeriod: true,
              rate: true,
              fees: true,
            },
          },
          businessInfo: { select: { id: true } },
          kycPrefill: true,
        },
      })
      : null;

    const resolvedPaymentBank = await resolvePaymentBankDetailForContract(prisma as any, {
      applicationId: data.applicationId,
      paymentBankId: data.paymentBankId,
    });

    const derivedClientId = data.clientId ?? application?.clientId ?? null;
    // Prefer a User.id that actually exists — Super Admin proxy / deleted users break Contract_createdById_fkey.
    const createdByCandidates = [
      data.createdById,
      application?.createdById,
      application?.salesRepresentative?.id,
      application?.referringAgent?.id,
    ].filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
    const uniqueCreatedByIds = [...new Set(createdByCandidates)];
    let derivedCreatedById: string | null = null;
    if (uniqueCreatedByIds.length > 0) {
      const users = await (prisma as any).user.findMany({
        where: { id: { in: uniqueCreatedByIds } },
        select: { id: true },
      });
      const found = new Set((users as Array<{ id: string }>).map((u) => u.id));
      derivedCreatedById = createdByCandidates.find((id) => found.has(id)) ?? null;
    }
    // Contract.offerId FK → OfferDecision.id (never TermsOffer.id).
    const derivedOfferId =
      data.offerId ?? application?.OfferDecision?.id ?? null;
    const derivedPaymentBankId = resolvedPaymentBank?.id ?? null;
    const derivedContractLength =
      data.contractLenght ??
      parseContractLengthDaysFromOfferTerm(application?.OfferDecision?.term ?? null);
    const derivedApprovedAmount =
      data.approvedAmount ?? (application?.OfferDecision?.offer != null ? Number(application.OfferDecision.offer) : null);
    const derivedTotalAmount =
      data.totalAmount ?? (application?.OfferDecision?.totalRemit != null ? Number(application.OfferDecision.totalRemit) : null);
    const derivedStartDate = data.startDate ? new Date(data.startDate) : new Date();
    const derivedAgreementDate = data.agreementDate ? new Date(data.agreementDate) : new Date();
    const derivedEndDate = data.endDate
      ? new Date(data.endDate)
      : (() => {
        const end = new Date(derivedStartDate);
        end.setDate(end.getDate() + Number(derivedContractLength || 0));
        return end;
      })();

    if (!derivedOfferId) {
      throw new Error(
        'offerId could not be derived from request/application OfferDecision',
      );
    }
    if (!derivedCreatedById) throw new Error('createdById could not be derived');
    if (derivedContractLength == null) throw new Error('contractLenght could not be derived');
    if (derivedApprovedAmount == null) throw new Error('approvedAmount could not be derived');
    if (derivedTotalAmount == null) throw new Error('totalAmount could not be derived');
    const client = application?.client as any;
    const seedOwners = resolveClientOwnersForContractSeed(client);
    const secondOwnerSeed = seedOwners[1];
    const secondOwnerName = firstNonEmptyString(
      `${String(secondOwnerSeed?.firstName ?? '').trim()} ${String(secondOwnerSeed?.lastName ?? '').trim()}`,
    );
    const biz = application?.businessInfo as any;
    const offer = application?.OfferDecision as any;
    const paymentBank = resolvedPaymentBank as any;

    const customerName = firstNonEmptyString(
      `${String(client?.ownerFirstName ?? '').trim()} ${String(client?.ownerLastName ?? '').trim()}`,
    );
    const businessAddress = firstNonEmptyString(
      [client?.businessAddress1, client?.businessAddress2].filter(Boolean).join(', '),
      biz?.businessAddress,
    );
    const businessCity = firstNonEmptyString(client?.businessCity, biz?.city);
    const businessState = firstNonEmptyString(client?.businessState, biz?.state);
    const businessZip = firstNonEmptyString(client?.businessZipCode, biz?.zipCode, biz?.zip);
    /**
     * Owner 1's home address. Kept strictly separate from the business physical
     * address above — the contract's merchant contact block prints this one, and
     * falling back to the business address here is what made the two print the
     * same value. When the owner has no address on file these stay null so the
     * widget is left for the signer rather than stamped with the wrong address.
     */
    const firstOwnerSeed = seedOwners[0];
    const ownerHomeAddress = firstNonEmptyString(
      [client?.ownerAddress1, client?.ownerAddress2].filter(Boolean).join(', '),
      firstOwnerSeed?.address,
    );
    const ownerHomeCity = firstNonEmptyString(client?.ownerCity, firstOwnerSeed?.city);
    const ownerHomeState = firstNonEmptyString(client?.ownerState, firstOwnerSeed?.state);
    const ownerHomeZip = firstNonEmptyString(client?.ownerZipCode, firstOwnerSeed?.zip);
    const purchaseAmount = derivedApprovedAmount != null ? String(derivedApprovedAmount) : '';
    const purchasePrice = derivedTotalAmount != null ? String(derivedTotalAmount) : '';
    const legalName = firstNonEmptyString(client?.businessName, biz?.clientBusinessName);
    const bankRouting = firstNonEmptyString(
      decryptSensitiveField(paymentBank?.routingNumber ?? undefined),
    );
    const bankAccount = firstNonEmptyString(
      decryptSensitiveField(paymentBank?.accountNumber ?? undefined),
    );
    const bankName = firstNonEmptyString(paymentBank?.bankName);
    const taxEin = firstNonEmptyString(client?.businessEinNumber, biz?.federalTaxIdEin);
    const dba = firstNonEmptyString(biz?.doingBusinessAs, biz?.dba);

    const derivedExtraFields: ContractExtraFields = {
      legalName: legalName || null,
      clientName: customerName || null,
      entityType: firstNonEmptyString(client?.businessEntityType, biz?.entityType) || null,
      remittance:
        firstNonEmptyString(
          offer?.repayPerPeriod != null ? String(offer.repayPerPeriod) : '',
          offer?.paymentAmount != null ? String(offer.paymentAmount) : '',
          biz?.remittance,
        ) || null,
      clientEmail: firstNonEmptyString(client?.businessEmail, client?.ownerEmail) || null,
      clientPhone: firstNonEmptyString(client?.businessNumber, client?.ownerMobileNumber) || null,
      customerName: customerName || null,
      purchasePrice: purchasePrice || null,
      purchaseAmount: purchaseAmount || null,
      purchasePercent: null,
      securityTaxEin: taxEin || null,
      businessAddress: businessAddress || null,
      businessAddressCity: businessCity || null,
      businessAddressState: businessState || null,
      businessAddressZip: businessZip || null,
      doingBusinessAs: dba || null,
      federalTaxIdEin: taxEin || null,
      exhibitOwnerName: customerName || null,
      appendixClientName: customerName || null,
      appendixUnderwritingFees:
        resolveOfferFeeDollarsForContract(
          derivedApprovedAmount ?? (offer?.offer != null ? Number(offer.offer) : null),
          offer?.fees,
        ) ||
        firstNonEmptyString(biz?.appendixUnderwritingFees) ||
        null,
      authorizationApplication: firstNonEmptyString(legalName, customerName) || null,
      authorizationClientDate: derivedAgreementDate.toISOString().slice(0, 10),
      authorizationClientName: legalName || null,
      authorizationClientNamePrint: legalName || null,
      authorizationClientTaxId: taxEin || null,
      authorizationClientBankName: bankName || null,
      authorizationClientBankAccount: bankAccount || null,
      authorizationClientBankRouting: bankRouting || null,
      authorizedBusinessPhone: firstNonEmptyString(client?.businessNumber, client?.ownerMobileNumber) || null,
      /** Contact / mailing address = Owner 1 home (not business location). */
      businessAddressContract: ownerHomeAddress || null,
      businessAddressContractCity: ownerHomeCity || null,
      businessAddressContractState: ownerHomeState || null,
      businessAddressContractZip: ownerHomeZip || null,
      securityBusinessName: legalName || null,
      securityDoingBusinessAs: dba || null,
      securityBusinessAddress: businessAddress || null,
      securityBusinessAddressCity: businessCity || null,
      securityBusinessAddressState: businessState || null,
      securityBusinessAddressZip: businessZip || null,
      securityGuarantor: customerName || null,
    };

    const contractInclude = {
      client: {
        select: {
          id: true,
          businessName: true,
          businessEmail: true,
          ownerFirstName: true,
          ownerLastName: true,
        },
      },
      application: {
        select: {
          id: true,
          applicationId: true,
          OfferDecision: { select: OFFER_DECISION_CONTRACT_SELECT },
        },
      },
      offer: { select: OFFER_DECISION_CONTRACT_SELECT },
      createdBy: { select: { id: true, userId: true, firstName: true, lastName: true, email: true } },
      paymentTerms: { select: { id: true, paymentMethod: true, paymentFrequency: true } },
      paymentBank: { select: { id: true, bankName: true } },
    };

    /** Default interactive tx timeout is 5s — this flow runs multiple writes (contract + ACH + addendum + owner + application). */
    const createContractTransactionOptions = { maxWait: 10_000, timeout: 30_000 } as const;

    const contractData: Record<string, unknown> = {
      clientId: derivedClientId,
      applicationId: data.applicationId || null,
      offerId: derivedOfferId,
      startDate: derivedStartDate,
      endDate: derivedEndDate,
      contractLenght: Number(derivedContractLength),
      approvedAmount: Number(derivedApprovedAmount),
      totalAmount: Number(derivedTotalAmount),
      status: data.status || 'DRAFT',
      createdById: derivedCreatedById,
      agreementDate: derivedAgreementDate,
      paymentBankId: derivedPaymentBankId,
      state: data.state ?? (businessState || null),
      ...derivedExtraFields,
    };
    if (data.funderName !== undefined) {
      contractData.funderName =
        data.funderName === '' || data.funderName == null
          ? null
          : String(data.funderName).trim();
    }
    applyContractExtraFields(contractData, data);

    const savedKycSlots = (() => {
      const raw = (application as { kycPrefill?: { slots?: Record<string, KycExtractionMapped> } } | null)
        ?.kycPrefill?.slots;
      if (!raw || typeof raw !== 'object') return [] as KycExtractionMapped[];
      return Object.values(raw).filter(
        (slot): slot is KycExtractionMapped =>
          Boolean(slot && typeof slot === 'object' && (slot.documentType === 'driverLicense' || slot.documentType === 'voidedCheck')),
      );
    })();
    if (savedKycSlots.length) {
      let kycOverrides: Record<string, unknown> = {};
      for (const slot of savedKycSlots) {
        kycOverrides = mergeContractPrefillPatch(kycOverrides, slot.contractPrefill ?? {});
        const extraPatch: ContractExtraFields = {};
        for (const key of CONTRACT_EXTRA_STRING_FIELDS) {
          const val = slot.contractPrefill?.[key];
          if (firstNonEmptyString(val)) extraPatch[key] = String(val).trim();
        }
        applyContractExtraFields(contractData, extraPatch);
      }
      if (Object.keys(kycOverrides).length) {
        contractData.contractPrefillOverrides = kycOverrides;
      }
    }

    const buildContractUpdateData = (existingStatusRaw?: string | null) => {
      // Preserve lifecycle status set by BoldSign/DocuSign webhooks
      // (SENT/VIEWED/SIGNED/COMPLETED/etc.) when a repeated create is triggered.
      // Never downgrade an advanced status back to DRAFT.
      const existingStatus = String(existingStatusRaw ?? '').toUpperCase();
      const incomingStatusRaw = (contractData as { status?: string }).status;
      const incomingStatus = String(incomingStatusRaw ?? '').toUpperCase();
      const lifecycleAdvanced = Boolean(existingStatus && existingStatus !== 'DRAFT');
      const updateData: Record<string, unknown> = { ...contractData };
      if (lifecycleAdvanced && (!incomingStatus || incomingStatus === 'DRAFT')) {
        delete updateData.status;
      }
      return updateData;
    };

    // Prisma upsert is SELECT-then-INSERT (not ON CONFLICT) with the JS driver adapter,
    // so concurrent/repeated creates still throw P2002 and abort the Postgres tx.
    // Retry the whole transaction: after a conflict the next attempt finds the row and updates.
    const maxAttempts = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const createdContract = await (prisma as any).$transaction(async (tx: any) => {
          const findExistingContractRow = async (): Promise<{ id: number; status: string } | null> => {
            if (data.applicationId) {
              const byApp = await tx.contract.findUnique({
                where: { applicationId: data.applicationId },
                select: { id: true, status: true },
              });
              if (byApp?.id) return byApp;
            }
            if (derivedOfferId) {
              const byOffer = await tx.contract.findUnique({
                where: { offerId: derivedOfferId },
                select: { id: true, status: true },
              });
              if (byOffer?.id) return byOffer;
            }
            return null;
          };

          let created: any;
          const existing = await findExistingContractRow();
          if (existing?.id) {
            created = await tx.contract.update({
              where: { id: existing.id },
              data: buildContractUpdateData(existing.status),
              include: contractInclude,
            });
          } else {
            // SAVEPOINT so a unique violation does not abort the whole interactive tx;
            // Prisma upsert is not atomic with the JS driver adapter (SELECT then INSERT).
            await tx.$executeRaw`SAVEPOINT contract_create_sp`;
            try {
              created = await tx.contract.create({
                data: contractData,
                include: contractInclude,
              });
              await tx.$executeRaw`RELEASE SAVEPOINT contract_create_sp`;
            } catch (createErr: any) {
              await tx.$executeRaw`ROLLBACK TO SAVEPOINT contract_create_sp`;
              if (createErr?.code !== 'P2002') throw createErr;
              const raced = await findExistingContractRow();
              if (!raced?.id) throw createErr;
              created = await tx.contract.update({
                where: { id: raced.id },
                data: buildContractUpdateData(raced.status),
                include: contractInclude,
              });
            }
          }

          const businessInfoId = normalizeBusinessInfoIdForFk(application?.businessInfo?.id);

          const existingAch = await tx.aCH.findFirst({
            where: { contractId: created.id },
            select: { id: true },
          });
          if (!existingAch) {
            await tx.aCH.create({
              data: {
                clientId: created.clientId,
                contractId: created.id,
                businessInfoId,
                bankName: bankName || null,
                accountHolderName: legalName || null,
                accountNumber: bankAccount || null,
                routingNumber: bankRouting || null,
                paymentAmount: purchaseAmount || null,
                frequency:
                  sanitizePaymentFrequencyForPersist(offer?.frequency) || null,
                dba: dba || null,
                phone: firstNonEmptyString(client?.businessNumber, client?.ownerMobileNumber) || null,
                // ACH account-holder address is Owner 1's address, not the
                // business physical address — the ACH form prints the business
                // address on its own line, so seeding both from the business
                // made the two fields repeat the same street.
                address: ownerHomeAddress || null,
                city: ownerHomeCity || null,
                state: ownerHomeState || null,
                zip: ownerHomeZip || null,
                bankBranchCity: null,
                bankState: null,
                bankZip: null,
              },
            });
          }

          const existingAddendum = await tx.addendum.findFirst({
            where: { contractId: created.id },
            select: { id: true },
          });
          if (!existingAddendum) {
            await tx.addendum.create({
              data: {
                clientId: created.clientId,
                contractId: created.id,
                businessInfoId,
                legalName1: legalName || null,
                dba1: dba || null,
                typeOfEntity1: firstNonEmptyString(client?.businessEntityType, biz?.entityType) || null,
                ein1: taxEin || null,
                mailingAddress1: businessAddress || null,
                legalName2: null,
                dba2: null,
                typeOfEntity2: null,
                ein2: null,
                mailingAddress2: null,
                legalName3: null,
                dba3: null,
                typeOfEntity3: null,
                ein3: null,
                mailingAddress3: null,
                addendumDated: derivedAgreementDate.toISOString().slice(0, 10),
                principalOwner: customerName || null,
                principalBusiness: legalName || null,
                businessLocation: businessAddress || null,
                principalState: businessState || null,
                principalOwnerAmount1: purchaseAmount || null,
                principalOwnerAmount2: purchasePrice || null,
                principalOwner1Name: customerName || null,
                principalOwner1Date: derivedAgreementDate.toISOString().slice(0, 10),
                principalOwner2Name: secondOwnerName || null,
                principalOwner2Date: secondOwnerName
                  ? derivedAgreementDate.toISOString().slice(0, 10)
                  : null,
              },
            });
          }

          const existingOwners = await tx.contractOwner.findMany({
            where: { contractId: created.id },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
          });
          if (existingOwners.length === 0) {
            for (const owner of seedOwners) {
              await tx.contractOwner.create({
                data: {
                  contractId: created.id,
                  firstName: owner.firstName || 'Owner',
                  lastName: owner.lastName || '—',
                  email: owner.email,
                  phone: owner.phone,
                  address: owner.address,
                  state: owner.state,
                  city: owner.city,
                  zip: owner.zip,
                  ownershipPercentage: Number.isFinite(owner.ownershipPercentage)
                    ? owner.ownershipPercentage
                    : null,
                },
              });
            }
          } else if (existingOwners.length === 1 && seedOwners.length >= 2) {
            const owner = seedOwners[1]!;
            await tx.contractOwner.create({
              data: {
                contractId: created.id,
                firstName: owner.firstName || 'Owner',
                lastName: owner.lastName || '—',
                email: owner.email,
                phone: owner.phone,
                address: owner.address,
                state: owner.state,
                city: owner.city,
                zip: owner.zip,
                ownershipPercentage: Number.isFinite(owner.ownershipPercentage)
                  ? owner.ownershipPercentage
                  : null,
              },
            });
          }

          if (data.applicationId) {
            await syncApplicationToContractGenerated(tx, data.applicationId, {
              source: 'contractService.createContract',
              contractId: created.id,
              contractStatusNew: 'DRAFT',
            });
          }

          const createdFunderName =
            data.funderName === undefined
              ? null
              : data.funderName === '' || data.funderName == null
                ? null
                : String(data.funderName).trim();
          if (createdFunderName && data.applicationId) {
            await applyFunderDealIdPrefixToApplication({
              applicationId: data.applicationId,
              funderName: createdFunderName,
              state: (contractData.state as string | null | undefined) ?? null,
              tx,
            });
          }

          return mapContractRecordForApi(created);
        }, createContractTransactionOptions);
        if (savedKycSlots.length && createdContract?.id) {
          await this.applySavedApplicationKycSlotsToContract(
            Number(createdContract.id),
            savedKycSlots,
          );
        }
        return createdContract;
      } catch (err: any) {
        lastError = err;
        const isUniqueViolation = err?.code === 'P2002';
        if (!isUniqueViolation || attempt >= maxAttempts) {
          throw err;
        }
      }
    }
    throw lastError;
  }

  private async applySavedApplicationKycSlotsToContract(
    contractId: number,
    slots: KycExtractionMapped[],
  ) {
    for (const slot of slots) {
      try {
        await this.persistKycExtractionToContract(contractId, {
          documentType: slot.documentType,
          ownerIndex: slot.ownerIndex === 2 ? 2 : 1,
          slot: slot.slot || (slot.ownerIndex === 2 ? 'driverLicenseOwner2' : slot.documentType === 'voidedCheck' ? 'voidedCheck' : 'driverLicense'),
          keyData: slot.keyData ?? {},
          contractPrefill: slot.contractPrefill ?? {},
          panels: slot.panels ?? {},
        });
      } catch (err) {
        console.warn(
          `[createContract] skipped applying saved KYC slot ${slot.slot ?? slot.documentType}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  async getAllContracts(filters: {
    clientId?: string;
    applicationId?: string;
    status?:
    | 'DRAFT'
    | 'SENT'
    | 'VIEWED'
    | 'SIGNED'
    | 'COMPLETED'
    | 'DECLINED'
    | 'REVOKED'
    | 'EXPIRED';
  }) {
    const where: any = {};
    if (filters.clientId) where.clientId = filters.clientId;
    if (filters.applicationId) where.applicationId = filters.applicationId;
    if (filters.status) where.status = filters.status;

    const rows = await (prisma as any).contract.findMany({
      where,
      include: {
        client: { select: { id: true, businessName: true, businessEmail: true, ownerFirstName: true, ownerLastName: true } },
        application: {
          select: {
            id: true,
            applicationId: true,
            OfferDecision: true,
          },
        },
        offer: { select: OFFER_DECISION_CONTRACT_SELECT },
        paymentTerms: { select: { id: true, paymentMethod: true, paymentFrequency: true } },
        paymentBank: { select: { id: true, bankName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row: Record<string, unknown>) =>
      mapContractRecordForApi(applyOfferDerivedValuesToContractRow(row) as Record<string, unknown>),
    );
  }

  async getByIdContract(id: number) {
    const row = await (prisma as any).contract.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, businessName: true, businessEmail: true, ownerFirstName: true, ownerLastName: true } },
        application: {
          select: {
            id: true,
            applicationId: true,
            salesRepresentative: { select: { id: true, userId: true, firstName: true, lastName: true, email: true } },
            referringAgent: { select: { id: true, userId: true, firstName: true, lastName: true, email: true } },
            document: {
              select: {
                id: true,
                envelopeId: true,
                status: true,
                sentAt: true,
                completedAt: true,
                updatedAt: true,
              },
            },
            termsOffers: {
              orderBy: { createdAt: 'desc' as const },
              take: 1,
              select: TERMS_OFFER_CONTRACT_SELECT,
            },
          },
        },
        offer: { select: OFFER_DECISION_CONTRACT_SELECT },
        termsOffers: {
          orderBy: { createdAt: 'desc' as const },
          take: 1,
          select: TERMS_OFFER_CONTRACT_SELECT,
        },
        paymentTerms: { select: { id: true, paymentMethod: true, paymentFrequency: true } },
        paymentBank: { select: { id: true, bankName: true } },
      },
    });
    return row ? enrichContractRowForApi(row) : row;
  }

  async getByApplicationIdContract(applicationId: string) {
    const applicationUuid = await resolveContractApplicationUuid(applicationId);
    if (!applicationUuid) return null;

    const row = await (prisma as any).contract.findUnique({
      where: { applicationId: applicationUuid },
      include: {
        client: { select: { id: true, businessName: true, businessEmail: true, ownerFirstName: true, ownerLastName: true } },
        application: {
          select: {
            id: true,
            applicationId: true,
            currentQueue: true,
            currentState: true,
            salesRepresentative: { select: { id: true, userId: true, firstName: true, lastName: true, email: true } },
            referringAgent: { select: { id: true, userId: true, firstName: true, lastName: true, email: true } },
            document: {
              select: {
                id: true,
                envelopeId: true,
                status: true,
                sentAt: true,
                completedAt: true,
                updatedAt: true,
              },
            },
            termsOffers: {
              orderBy: { createdAt: 'desc' as const },
              take: 1,
              select: TERMS_OFFER_CONTRACT_SELECT,
            },
          },
        },
        offer: { select: OFFER_DECISION_CONTRACT_SELECT },
        termsOffers: {
          orderBy: { createdAt: 'desc' as const },
          take: 1,
          select: TERMS_OFFER_CONTRACT_SELECT,
        },
        paymentTerms: { select: { id: true, paymentMethod: true, paymentFrequency: true } },
        paymentBank: { select: { id: true, bankName: true } },
      },
    });
    if (row?.application) {
      await applyContractCompletedSyncToApplicationRecord(
        prisma,
        row.application,
        'contract.getByApplicationIdContract',
      );
    }
    return row ? enrichContractRowForApi(row) : row;
  }

  async updateContract(
    id: number,
    data: {
      clientId?: string;
      applicationId?: string;
      offerId?: string;
      startDate?: Date | string;
      endDate?: Date | string;
      contractLenght?: number;
      approvedAmount?: number;
      totalAmount?: number;
      status?:
      | 'DRAFT'
      | 'SENT'
      | 'VIEWED'
      | 'SIGNED'
      | 'COMPLETED'
      | 'DECLINED'
      | 'REVOKED'
      | 'EXPIRED';
      createdById?: string;
      agreementDate?: Date | string;
      paymentBankId?: string;
      state?: string | null;
      funderName?: string | null;
      contractPrefillOverrides?: unknown;
      reverseDisbursementEnabled?: boolean;
      reverseDisbursementSchedule?: unknown;
    } & ContractExtraFields,
  ) {
    const updateData: any = {};
    if (data.clientId !== undefined) updateData.clientId = data.clientId;
    if (data.applicationId !== undefined) updateData.applicationId = data.applicationId;
    if (data.offerId !== undefined) updateData.offerId = data.offerId;
    if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate);
    if (data.endDate !== undefined) updateData.endDate = new Date(data.endDate);
    if (data.contractLenght !== undefined) updateData.contractLenght = data.contractLenght;
    if (data.approvedAmount !== undefined) updateData.approvedAmount = data.approvedAmount;
    if (data.totalAmount !== undefined) updateData.totalAmount = data.totalAmount;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.createdById !== undefined) updateData.createdById = data.createdById;
    if (data.agreementDate !== undefined) updateData.agreementDate = new Date(data.agreementDate);
    if (data.paymentBankId !== undefined) updateData.paymentBankId = data.paymentBankId;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.funderName !== undefined) updateData.funderName = data.funderName;
    if (data.contractPrefillOverrides !== undefined) {
      if (data.contractPrefillOverrides === null) {
        updateData.contractPrefillOverrides = Prisma.DbNull;
      }
    }
    if (data.reverseDisbursementEnabled !== undefined) {
      updateData.reverseDisbursementEnabled = data.reverseDisbursementEnabled === true;
    }
    if (data.reverseDisbursementSchedule !== undefined) {
      updateData.reverseDisbursementSchedule =
        data.reverseDisbursementSchedule === null
          ? Prisma.DbNull
          : (data.reverseDisbursementSchedule as Prisma.InputJsonValue);
    }
    applyContractExtraFields(updateData, data);

    const existingMeta = await withDbRetry(
      () =>
        prisma.contract.findUnique({
          where: { id },
          select: {
            applicationId: true,
            state: true,
            funderName: true,
            contractPrefillOverrides: true,
          },
        }),
      { maxAttempts: 5, baseDelayMs: 400, label: 'updateContract.existingMeta' },
    );

    if (data.contractPrefillOverrides !== undefined && data.contractPrefillOverrides !== null) {
      // FE prefill saves often rebuild the JSON blob and omit DocuSign history keys.
      // Preserve voided/sent/completed history + ACH/package capsules from existing.
      const merged =
        mergePreservingDocuSignEnvelopeMeta(
          existingMeta?.contractPrefillOverrides,
          data.contractPrefillOverrides,
        ) ?? data.contractPrefillOverrides;
      updateData.contractPrefillOverrides = decryptEncryptedStringsInJson(
        merged,
      ) as Prisma.InputJsonValue;
    }

    if (Object.keys(updateData).length === 0) {
      throw new Error('No contract fields provided for update');
    }

    const funderOrStateChanged =
      data.funderName !== undefined || data.state !== undefined;

    // Write without `include`, then reload relations sequentially. Prisma 7.9
    // adapter-pg fans out includes with Promise.all and exhausts the Neon pool
    // right after a long SignNow send ("timeout exceeded when trying to connect").
    await withDbRetry(
      () =>
        prisma.contract.update({
          where: { id },
          data: updateData,
        }),
      { maxAttempts: 5, baseDelayMs: 400, label: 'updateContract.write' },
    );

    // Bank block edited in the prefill editor (or its Exhibit C entity modal): mirror it into
    // the contract columns, ACH rows and the application bank row so it is never retyped.
    if (data.contractPrefillOverrides != null && updateData.contractPrefillOverrides) {
      const bank = readBankFieldsFromPrefill(updateData.contractPrefillOverrides);
      await syncBankFieldsEverywhereSafe({ contractId: id }, bank);
    }
    const row = await withDbRetry(
      async () => {
        const updated = await loadContractRowForUpdateResponse(id);
        if (!updated) {
          throw new Error(`Contract ${id} not found after update`);
        }
        return updated;
      },
      { maxAttempts: 5, baseDelayMs: 400, label: 'updateContract.reload' },
    );

    if (funderOrStateChanged) {
      const nextFunder =
        data.funderName !== undefined
          ? data.funderName === '' || data.funderName == null
            ? null
            : String(data.funderName).trim()
          : String(existingMeta?.funderName ?? (row as { funderName?: string | null }).funderName ?? '').trim() ||
            null;
      const applicationId =
        (data.applicationId !== undefined ? data.applicationId : existingMeta?.applicationId) ??
        (row as { applicationId?: string | null }).applicationId ??
        null;
      const state =
        (data.state !== undefined ? data.state : existingMeta?.state) ??
        (row as { state?: string | null }).state ??
        null;
      if (nextFunder && applicationId) {
        await applyFunderDealIdPrefixToApplication({
          applicationId,
          funderName: nextFunder,
          state,
        });
      }
    }

    return mapContractRecordForApi(row as Record<string, unknown>);
  }

  async deleteContract(id: number) {
    return (prisma as any).contract.delete({ where: { id } });
  }

  async createACH(data: {
    clientId: string;
    contractId?: number;
    businessInfoId?: number;
    bankName?: string;
    accountHolderName?: string;
    accountNumber?: string;
    routingNumber?: string;
    ach_authorization_bank_portal_website?: string;
    ach_authorization_username?: string;
    ach_authorization_password?: string;
    ach_authorization_security_question1?: string;
    ach_authorization_security_answer1?: string;
    ach_authorization_security_question2?: string;
    ach_authorization_security_answer2?: string;
    ach_authorization_security_question3?: string;
    ach_authorization_security_answer3?: string;
    ach_authorization_other_infomation?: string;
    ach_authorization_reference_name1?: string;
    ach_authorization_reference_number_1?: string;
    ach_authorization_reference_relationship1?: string;
    ach_authorization_reference_name2?: string;
    ach_authorization_reference_number2?: string;
    ach_authorization_reference_relationship2?: string;
    ach_authorization_reference_name3?: string;
    ach_authorization_reference_number3?: string;
    ach_authorization_reference_relationship3?: string;
    paymentAmount?: string;
    frequency?: string;
    dba?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    bankBranchCity?: string;
    bankState?: string;
    bankZip?: string;
  }) {
    const row = await (prisma as any).aCH.create({
      data: {
        clientId: data.clientId,
        contractId: data.contractId ?? null,
        businessInfoId: normalizeBusinessInfoIdForFk(data.businessInfoId),
        bankName: data.bankName || null,
        accountHolderName: data.accountHolderName || null,
        accountNumber:
          decryptSensitiveField(data.accountNumber ?? undefined) ?? data.accountNumber ?? null,
        routingNumber:
          decryptSensitiveField(data.routingNumber ?? undefined) ?? data.routingNumber ?? null,
        ach_authorization_bank_portal_website:
          data.ach_authorization_bank_portal_website || null,
        ach_authorization_username: data.ach_authorization_username || null,
        ach_authorization_password: data.ach_authorization_password || null,
        ach_authorization_security_question1:
          data.ach_authorization_security_question1 || null,
        ach_authorization_security_answer1:
          data.ach_authorization_security_answer1 || null,
        ach_authorization_security_question2:
          data.ach_authorization_security_question2 || null,
        ach_authorization_security_answer2:
          data.ach_authorization_security_answer2 || null,
        ach_authorization_security_question3:
          data.ach_authorization_security_question3 || null,
        ach_authorization_security_answer3:
          data.ach_authorization_security_answer3 || null,
        ach_authorization_other_infomation:
          data.ach_authorization_other_infomation || null,
        ach_authorization_reference_name1:
          data.ach_authorization_reference_name1 || null,
        ach_authorization_reference_number_1:
          data.ach_authorization_reference_number_1 || null,
        ach_authorization_reference_relationship1:
          data.ach_authorization_reference_relationship1 || null,
        ach_authorization_reference_name2:
          data.ach_authorization_reference_name2 || null,
        ach_authorization_reference_number2:
          data.ach_authorization_reference_number2 || null,
        ach_authorization_reference_relationship2:
          data.ach_authorization_reference_relationship2 || null,
        ach_authorization_reference_name3:
          data.ach_authorization_reference_name3 || null,
        ach_authorization_reference_number3:
          data.ach_authorization_reference_number3 || null,
        ach_authorization_reference_relationship3:
          data.ach_authorization_reference_relationship3 || null,
        paymentAmount: data.paymentAmount || null,
        frequency: sanitizePaymentFrequencyForPersist(data.frequency),
        dba: data.dba || null,
        phone: data.phone || null,
        address: data.address || null,
        city: data.city || null,
        state: data.state || null,
        zip: data.zip || null,
        bankBranchCity: data.bankBranchCity || null,
        bankState: data.bankState || null,
        bankZip: data.bankZip || null,
      },
      include: {
        client: { select: { id: true, businessName: true, businessEmail: true, ownerFirstName: true, ownerLastName: true } },
      },
    });
    await syncAchRowBankFields(row);
    return mapAchRecordForApi(row);
  }

  async getAllACH(filters: { clientId?: string; contractId?: number }) {
    const where: any = {};
    if (filters.clientId) where.clientId = filters.clientId;
    if (filters.contractId) where.contractId = filters.contractId;

    const rows = await (prisma as any).aCH.findMany({
      where,
      include: {
        client: { select: { id: true, businessName: true, businessEmail: true, ownerFirstName: true, ownerLastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row: Record<string, unknown>) => mapAchRecordForApi(row));
  }

  async getByIdACH(id: number) {
    const row = await (prisma as any).aCH.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, businessName: true, businessEmail: true, ownerFirstName: true, ownerLastName: true } },
      },
    });
    return row ? mapAchRecordForApi(row) : row;
  }

  async updateACH(
    id: number,
    data: {
      bankName?: string;
      accountHolderName?: string;
      accountNumber?: string;
      routingNumber?: string;
      ach_authorization_bank_portal_website?: string;
      ach_authorization_username?: string;
      ach_authorization_password?: string;
      ach_authorization_security_question1?: string;
      ach_authorization_security_answer1?: string;
      ach_authorization_security_question2?: string;
      ach_authorization_security_answer2?: string;
      ach_authorization_security_question3?: string;
      ach_authorization_security_answer3?: string;
      ach_authorization_other_infomation?: string;
      ach_authorization_reference_name1?: string;
      ach_authorization_reference_number_1?: string;
      ach_authorization_reference_relationship1?: string;
      ach_authorization_reference_name2?: string;
      ach_authorization_reference_number2?: string;
      ach_authorization_reference_relationship2?: string;
      ach_authorization_reference_name3?: string;
      ach_authorization_reference_number3?: string;
      ach_authorization_reference_relationship3?: string;
      paymentAmount?: string;
      frequency?: string;
      clientId?: string;
      contractId?: number;
      businessInfoId?: number;
      dba?: string;
      phone?: string;
      address?: string;
      city?: string;
      state?: string;
      zip?: string;
      bankBranchCity?: string;
      bankState?: string;
      bankZip?: string;
    },
  ) {
    const updateData: any = {};
    if (data.bankName !== undefined) updateData.bankName = data.bankName;
    if (data.accountHolderName !== undefined) updateData.accountHolderName = data.accountHolderName;
    if (data.accountNumber !== undefined) {
      updateData.accountNumber =
        decryptSensitiveField(data.accountNumber) ?? data.accountNumber;
    }
    if (data.routingNumber !== undefined) {
      updateData.routingNumber =
        decryptSensitiveField(data.routingNumber) ?? data.routingNumber;
    }
    if (data.ach_authorization_bank_portal_website !== undefined) updateData.ach_authorization_bank_portal_website = data.ach_authorization_bank_portal_website;
    if (data.ach_authorization_username !== undefined) updateData.ach_authorization_username = data.ach_authorization_username;
    if (data.ach_authorization_password !== undefined) updateData.ach_authorization_password = data.ach_authorization_password;
    if (data.ach_authorization_security_question1 !== undefined) updateData.ach_authorization_security_question1 = data.ach_authorization_security_question1;
    if (data.ach_authorization_security_answer1 !== undefined) updateData.ach_authorization_security_answer1 = data.ach_authorization_security_answer1;
    if (data.ach_authorization_security_question2 !== undefined) updateData.ach_authorization_security_question2 = data.ach_authorization_security_question2;
    if (data.ach_authorization_security_answer2 !== undefined) updateData.ach_authorization_security_answer2 = data.ach_authorization_security_answer2;
    if (data.ach_authorization_security_question3 !== undefined) updateData.ach_authorization_security_question3 = data.ach_authorization_security_question3;
    if (data.ach_authorization_security_answer3 !== undefined) updateData.ach_authorization_security_answer3 = data.ach_authorization_security_answer3;
    if (data.ach_authorization_other_infomation !== undefined) updateData.ach_authorization_other_infomation = data.ach_authorization_other_infomation;
    if (data.ach_authorization_reference_name1 !== undefined) updateData.ach_authorization_reference_name1 = data.ach_authorization_reference_name1;
    if (data.ach_authorization_reference_number_1 !== undefined) updateData.ach_authorization_reference_number_1 = data.ach_authorization_reference_number_1;
    if (data.ach_authorization_reference_relationship1 !== undefined) updateData.ach_authorization_reference_relationship1 = data.ach_authorization_reference_relationship1;
    if (data.ach_authorization_reference_name2 !== undefined) updateData.ach_authorization_reference_name2 = data.ach_authorization_reference_name2;
    if (data.ach_authorization_reference_number2 !== undefined) updateData.ach_authorization_reference_number2 = data.ach_authorization_reference_number2;
    if (data.ach_authorization_reference_relationship2 !== undefined) updateData.ach_authorization_reference_relationship2 = data.ach_authorization_reference_relationship2;
    if (data.ach_authorization_reference_name3 !== undefined) updateData.ach_authorization_reference_name3 = data.ach_authorization_reference_name3;
    if (data.ach_authorization_reference_number3 !== undefined) updateData.ach_authorization_reference_number3 = data.ach_authorization_reference_number3;
    if (data.ach_authorization_reference_relationship3 !== undefined) updateData.ach_authorization_reference_relationship3 = data.ach_authorization_reference_relationship3;
    if (data.paymentAmount !== undefined) updateData.paymentAmount = data.paymentAmount;
    if (data.frequency !== undefined) {
      // Skip junk % values; do not clobber a good stored cadence with "0.00%".
      const sanitized = sanitizePaymentFrequencyForPersist(data.frequency);
      if (sanitized != null) updateData.frequency = sanitized;
    }
    if (data.clientId !== undefined) updateData.clientId = data.clientId;
    if (data.contractId !== undefined) updateData.contractId = data.contractId;
    if (data.businessInfoId !== undefined) {
      updateData.businessInfoId = normalizeBusinessInfoIdForFk(data.businessInfoId);
    }
    if (data.dba !== undefined) updateData.dba = data.dba;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.address !== undefined) updateData.address = data.address;
    if (data.city !== undefined) updateData.city = data.city;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.zip !== undefined) updateData.zip = data.zip;
    if (data.bankBranchCity !== undefined) updateData.bankBranchCity = data.bankBranchCity;
    if (data.bankState !== undefined) updateData.bankState = data.bankState;
    if (data.bankZip !== undefined) updateData.bankZip = data.bankZip;

    const row = await (prisma as any).aCH.update({
      where: { id },
      data: updateData,
      include: {
        client: { select: { id: true, businessName: true, businessEmail: true, ownerFirstName: true, ownerLastName: true } },
      },
    });
    await syncAchRowBankFields(row);
    return mapAchRecordForApi(row);
  }

  async deleteACH(id: number) {
    return (prisma as any).aCH.delete({ where: { id } });
  }

  async createEPO(data: {
    clientId: string;
    contractId?: number;
    amountReceived1?: string;
    receivedDate1?: string;
    amountReceived2?: string;
    receivedDate2?: string;
    amountReceived3?: string;
    receivedDate3?: string;
  }) {
    return (prisma as any).ePO.create({
      data: {
        clientId: data.clientId,
        contractId: data.contractId ?? null,
        amountReceived1: data.amountReceived1 || null,
        receivedDate1: data.receivedDate1 || null,
        amountReceived2: data.amountReceived2 || null,
        receivedDate2: data.receivedDate2 || null,
        amountReceived3: data.amountReceived3 || null,
        receivedDate3: data.receivedDate3 || null,
      },
      include: {
        client: { select: { id: true, businessName: true, businessEmail: true, ownerFirstName: true, ownerLastName: true } },
      },
    });
  }

  async getAllEPO(filters: { clientId?: string; contractId?: number }) {
    const where: any = {};
    if (filters.clientId) where.clientId = filters.clientId;
    if (filters.contractId) where.contractId = filters.contractId;

    return (prisma as any).ePO.findMany({
      where,
      include: {
        client: { select: { id: true, businessName: true, businessEmail: true, ownerFirstName: true, ownerLastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getByIdEPO(id: number) {
    return (prisma as any).ePO.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, businessName: true, businessEmail: true, ownerFirstName: true, ownerLastName: true } },
      },
    });
  }

  async updateEPO(
    id: number,
    data: {
      amountReceived1?: string;
      receivedDate1?: string;
      amountReceived2?: string;
      receivedDate2?: string;
      amountReceived3?: string;
      receivedDate3?: string;
      clientId?: string;
      contractId?: number;
    },
  ) {
    const updateData: any = {};
    if (data.amountReceived1 !== undefined) updateData.amountReceived1 = data.amountReceived1;
    if (data.receivedDate1 !== undefined) updateData.receivedDate1 = data.receivedDate1;
    if (data.amountReceived2 !== undefined) updateData.amountReceived2 = data.amountReceived2;
    if (data.receivedDate2 !== undefined) updateData.receivedDate2 = data.receivedDate2;
    if (data.amountReceived3 !== undefined) updateData.amountReceived3 = data.amountReceived3;
    if (data.receivedDate3 !== undefined) updateData.receivedDate3 = data.receivedDate3;
    if (data.clientId !== undefined) updateData.clientId = data.clientId;
    if (data.contractId !== undefined) updateData.contractId = data.contractId;

    return (prisma as any).ePO.update({
      where: { id },
      data: updateData,
      include: {
        client: { select: { id: true, businessName: true, businessEmail: true, ownerFirstName: true, ownerLastName: true } },
      },
    });
  }

  async deleteEPO(id: number) {
    return (prisma as any).ePO.delete({ where: { id } });
  }

  async createAddendum(data: {
    clientId: string;
    contractId?: number;
    businessInfoId?: number;
    legalName1?: string;
    dba1?: string;
    typeOfEntity1?: string;
    ein1?: string;
    mailingAddress1?: string;
    legalName2?: string;
    dba2?: string;
    typeOfEntity2?: string;
    ein2?: string;
    mailingAddress2?: string;
    legalName3?: string;
    dba3?: string;
    typeOfEntity3?: string;
    ein3?: string;
    mailingAddress3?: string;
    addendumDated?: string;
    principalOwner?: string;
    principalBusiness?: string;
    businessLocation?: string;
    principalState?: string;
    principalOwnerAmount1?: string;
    principalOwnerAmount2?: string;
    principalOwner1Name?: string;
    principalOwner1Date?: string;
    principalOwner2Name?: string;
    principalOwner2Date?: string;
  }) {
    return (prisma as any).addendum.create({
      data: {
        clientId: data.clientId,
        contractId: data.contractId ?? null,
        businessInfoId: normalizeBusinessInfoIdForFk(data.businessInfoId),
        legalName1: data.legalName1 || null,
        dba1: data.dba1 || null,
        typeOfEntity1: data.typeOfEntity1 || null,
        ein1: data.ein1 || null,
        mailingAddress1: data.mailingAddress1 || null,
        legalName2: data.legalName2 || null,
        dba2: data.dba2 || null,
        typeOfEntity2: data.typeOfEntity2 || null,
        ein2: data.ein2 || null,
        mailingAddress2: data.mailingAddress2 || null,
        legalName3: data.legalName3 || null,
        dba3: data.dba3 || null,
        typeOfEntity3: data.typeOfEntity3 || null,
        ein3: data.ein3 || null,
        mailingAddress3: data.mailingAddress3 || null,
        addendumDated: data.addendumDated || null,
        principalOwner: data.principalOwner || null,
        principalBusiness: data.principalBusiness || null,
        businessLocation: data.businessLocation || null,
        principalState: data.principalState || null,
        principalOwnerAmount1: data.principalOwnerAmount1 || null,
        principalOwnerAmount2: data.principalOwnerAmount2 || null,
        principalOwner1Name: data.principalOwner1Name || null,
        principalOwner1Date: data.principalOwner1Date || null,
        principalOwner2Name: data.principalOwner2Name || null,
        principalOwner2Date: data.principalOwner2Date || null,
      },
      include: {
        client: { select: { id: true, businessName: true, businessEmail: true, ownerFirstName: true, ownerLastName: true } },
      },
    });
  }

  async getAllAddendum(filters: { clientId?: string; contractId?: number }) {
    const where: any = {};
    if (filters.clientId) where.clientId = filters.clientId;
    if (filters.contractId) where.contractId = filters.contractId;

    return (prisma as any).addendum.findMany({
      where,
      include: {
        client: { select: { id: true, businessName: true, businessEmail: true, ownerFirstName: true, ownerLastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getByIdAddendum(id: number) {
    return (prisma as any).addendum.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, businessName: true, businessEmail: true, ownerFirstName: true, ownerLastName: true } },
      },
    });
  }

  async updateAddendum(
    id: number,
    data: {
      legalName1?: string;
      dba1?: string;
      typeOfEntity1?: string;
      ein1?: string;
      mailingAddress1?: string;
      legalName2?: string;
      dba2?: string;
      typeOfEntity2?: string;
      ein2?: string;
      mailingAddress2?: string;
      legalName3?: string;
      dba3?: string;
      typeOfEntity3?: string;
      ein3?: string;
      mailingAddress3?: string;
      clientId?: string;
      contractId?: number;
      businessInfoId?: number;
      addendumDated?: string;
      principalOwner?: string;
      principalBusiness?: string;
      businessLocation?: string;
      principalState?: string;
      principalOwnerAmount1?: string;
      principalOwnerAmount2?: string;
      principalOwner1Name?: string;
      principalOwner1Date?: string;
      principalOwner2Name?: string;
      principalOwner2Date?: string;
    },
  ) {
    const updateData: any = {};
    if (data.legalName1 !== undefined) updateData.legalName1 = data.legalName1;
    if (data.dba1 !== undefined) updateData.dba1 = data.dba1;
    if (data.typeOfEntity1 !== undefined) updateData.typeOfEntity1 = data.typeOfEntity1;
    if (data.ein1 !== undefined) updateData.ein1 = data.ein1;
    if (data.mailingAddress1 !== undefined) updateData.mailingAddress1 = data.mailingAddress1;
    if (data.legalName2 !== undefined) updateData.legalName2 = data.legalName2;
    if (data.dba2 !== undefined) updateData.dba2 = data.dba2;
    if (data.typeOfEntity2 !== undefined) updateData.typeOfEntity2 = data.typeOfEntity2;
    if (data.ein2 !== undefined) updateData.ein2 = data.ein2;
    if (data.mailingAddress2 !== undefined) updateData.mailingAddress2 = data.mailingAddress2;
    if (data.legalName3 !== undefined) updateData.legalName3 = data.legalName3;
    if (data.dba3 !== undefined) updateData.dba3 = data.dba3;
    if (data.typeOfEntity3 !== undefined) updateData.typeOfEntity3 = data.typeOfEntity3;
    if (data.ein3 !== undefined) updateData.ein3 = data.ein3;
    if (data.mailingAddress3 !== undefined) updateData.mailingAddress3 = data.mailingAddress3;
    if (data.clientId !== undefined) updateData.clientId = data.clientId;
    if (data.contractId !== undefined) updateData.contractId = data.contractId;
    if (data.businessInfoId !== undefined) {
      updateData.businessInfoId = normalizeBusinessInfoIdForFk(data.businessInfoId);
    }
    if (data.addendumDated !== undefined) updateData.addendumDated = data.addendumDated;
    if (data.principalOwner !== undefined) updateData.principalOwner = data.principalOwner;
    if (data.principalBusiness !== undefined) updateData.principalBusiness = data.principalBusiness;
    if (data.businessLocation !== undefined) updateData.businessLocation = data.businessLocation;
    if (data.principalState !== undefined) updateData.principalState = data.principalState;
    if (data.principalOwnerAmount1 !== undefined) updateData.principalOwnerAmount1 = data.principalOwnerAmount1;
    if (data.principalOwnerAmount2 !== undefined) updateData.principalOwnerAmount2 = data.principalOwnerAmount2;
    if (data.principalOwner1Name !== undefined) updateData.principalOwner1Name = data.principalOwner1Name;
    if (data.principalOwner1Date !== undefined) updateData.principalOwner1Date = data.principalOwner1Date;
    if (data.principalOwner2Name !== undefined) updateData.principalOwner2Name = data.principalOwner2Name;
    if (data.principalOwner2Date !== undefined) updateData.principalOwner2Date = data.principalOwner2Date;

    return (prisma as any).addendum.update({
      where: { id },
      data: updateData,
      include: {
        client: { select: { id: true, businessName: true, businessEmail: true, ownerFirstName: true, ownerLastName: true } },
      },
    });
  }

  async deleteAddendum(id: number) {
    return (prisma as any).addendum.delete({ where: { id } });
  }

  async createContractOwner(data: {
    contractId: number;
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    address?: string;
    state?: string;
    city?: string;
    zip?: string;
    ownershipPercentage?: number;
  }) {
    return (prisma as any).contractOwner.create({
      data: {
        contractId: data.contractId,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email || null,
        phone: data.phone || null,
        address: data.address || null,
        state: data.state || null,
        city: data.city || null,
        zip: data.zip || null,
        ownershipPercentage:
          data.ownershipPercentage !== undefined ? data.ownershipPercentage : null,
      },
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            status: true,
            clientId: true,
          },
        },
      },
    });
  }

  async getAllContractOwners(filters: { contractId?: number }) {
    const where: any = {};
    if (filters.contractId) where.contractId = filters.contractId;

    return (prisma as any).contractOwner.findMany({
      where,
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            status: true,
            clientId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getByIdContractOwner(id: number) {
    return (prisma as any).contractOwner.findUnique({
      where: { id },
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            status: true,
            clientId: true,
          },
        },
      },
    });
  }

  async updateContractOwner(
    id: number,
    data: {
      contractId?: number;
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      address?: string;
      state?: string;
      city?: string;
      zip?: string;
      ownershipPercentage?: number;
    },
  ) {
    const updateData: any = {};
    if (data.contractId !== undefined) updateData.contractId = data.contractId;
    if (data.firstName !== undefined) updateData.firstName = data.firstName;
    if (data.lastName !== undefined) updateData.lastName = data.lastName;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.address !== undefined) updateData.address = data.address;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.city !== undefined) updateData.city = data.city;
    if (data.zip !== undefined) updateData.zip = data.zip;
    if (data.ownershipPercentage !== undefined) {
      updateData.ownershipPercentage = data.ownershipPercentage;
    }

    return (prisma as any).contractOwner.update({
      where: { id },
      data: updateData,
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            status: true,
            clientId: true,
          },
        },
      },
    });
  }

  async deleteContractOwner(id: number) {
    return (prisma as any).contractOwner.delete({ where: { id } });
  }

  async createContractGuarantor(data: {
    contractId: number;
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    address?: string;
    state?: string;
    city?: string;
    zip?: string;
    ssn?: string;
    driverLicense?: string;
    entityType?: string;
  }) {
    return (prisma as any).contractGuarantor.create({
      data: {
        contractId: data.contractId,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email || null,
        phone: data.phone || null,
        address: data.address || null,
        state: data.state || null,
        city: data.city || null,
        zip: data.zip || null,
        ssn: data.ssn || null,
        driverLicense: data.driverLicense || null,
        entityType: data.entityType || null,
      },
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            status: true,
            clientId: true,
          },
        },
      },
    });
  }

  async getAllContractGuarantors(filters: { contractId?: number }) {
    const where: any = {};
    if (filters.contractId) where.contractId = filters.contractId;

    return (prisma as any).contractGuarantor.findMany({
      where,
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            status: true,
            clientId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getByIdContractGuarantor(id: number) {
    return (prisma as any).contractGuarantor.findUnique({
      where: { id },
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            status: true,
            clientId: true,
          },
        },
      },
    });
  }

  async updateContractGuarantor(
    id: number,
    data: {
      contractId?: number;
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      address?: string;
      state?: string;
      city?: string;
      zip?: string;
      ssn?: string;
      driverLicense?: string;
      entityType?: string;
    },
  ) {
    const updateData: any = {};
    if (data.contractId !== undefined) updateData.contractId = data.contractId;
    if (data.firstName !== undefined) updateData.firstName = data.firstName;
    if (data.lastName !== undefined) updateData.lastName = data.lastName;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.address !== undefined) updateData.address = data.address;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.city !== undefined) updateData.city = data.city;
    if (data.zip !== undefined) updateData.zip = data.zip;
    if (data.ssn !== undefined) updateData.ssn = data.ssn;
    if (data.driverLicense !== undefined) updateData.driverLicense = data.driverLicense;
    if (data.entityType !== undefined) updateData.entityType = data.entityType;

    return (prisma as any).contractGuarantor.update({
      where: { id },
      data: updateData,
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            status: true,
            clientId: true,
          },
        },
      },
    });
  }

  async deleteContractGuarantor(id: number) {
    return (prisma as any).contractGuarantor.delete({ where: { id } });
  }

  async getContractRelatedDataByContractId(contractId: number) {
    const contract = await (prisma as any).contract.findUnique({
      where: { id: contractId },
      include: {
        achs: true,
        epos: true,
        addendums: true,
        owners: true,
        guarantors: true,
        documents: true,
        offer: { select: OFFER_DECISION_CONTRACT_SELECT },
      },
    });

    if (!contract) {
      throw new Error('Contract not found');
    }

    // ACH / addendum rows are seeded once at contract creation; overlay the live offer so
    // their amounts match the current terms rather than the ones in force back then.
    return mapContractRecordForApi(applyOfferDerivedValuesToContractRow(contract));
  }

  async createBoldSignTemplate(data: {
    name: string;
    type: string;
    templateId?: string;
    state?: string;
    frequency?: string;
    pdfUrl?: string;
    pdfPublicId?: string;
    originalFileName?: string;
    layoutKey?: string;
  }) {
    const { resolveLayoutKeyFromBoldSignType } = await import(
      './docusign/layouts/document-layout.registry'
    );
    const layoutKey =
      data.layoutKey ||
      resolveLayoutKeyFromBoldSignType(String(data.type || '')) ||
      null;
    return (prisma as any).boldSignTemplate.create({
      data: {
        name: data.name,
        type: data.type,
        state: data.state || null,
        frequency: data.frequency || null,
        templateId: data.templateId || null,
        pdfUrl: data.pdfUrl || null,
        pdfPublicId: data.pdfPublicId || null,
        originalFileName: data.originalFileName || null,
        layoutKey,
      },
    });
  }

  async getAllBoldSignTemplates(filters: {
    type?: string;
    state?: string;
    frequency?: string;
  }) {
    const where: any = {};
    if (filters.type) {
      const typeToken = String(filters.type).trim();
      where.type = { equals: typeToken, mode: 'insensitive' };
    }

    const rows = await (prisma as any).boldSignTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const wantedState = normalizeContractStateToken(filters.state);
    const wantedFrequency = String(filters.frequency ?? '')
      .trim()
      .toLowerCase();
    const freqKey =
      wantedFrequency.startsWith('week')
        ? 'weekly'
        : wantedFrequency.startsWith('day')
          ? 'daily'
          : wantedFrequency.startsWith('month')
            ? 'monthly'
            : wantedFrequency;

    const stateFiltered = (rows as Array<Record<string, unknown>>).filter((row) => {
      if (!wantedState) return true;
      const rowState = String(row.state ?? '').trim();
      const stateOk =
        (rowState && contractStatesMatch(rowState, wantedState)) ||
        (() => {
          // Legacy rows may omit `state` but encode it in name/layoutKey
          // (`california` or postal `ca`).
          const blob = `${String(row.name ?? '')} ${String(row.layoutKey ?? '')} ${String(row.templateId ?? '')}`
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_');
          const slug = wantedState.replace(/\s+/g, '_');
          const compact = wantedState.replace(/\s+/g, '');
          const postalByKey: Record<string, string> = {
            california: 'ca',
            'new york': 'ny',
            connecticut: 'ct',
            florida: 'fl',
            georgia: 'ga',
            kansas: 'ks',
            utah: 'ut',
            virginia: 'va',
            missouri: 'mo',
            louisiana: 'la',
            texas: 'tx',
          };
          const postal = postalByKey[wantedState] || postalByKey[compact];
          const postalHit =
            Boolean(postal) &&
            (blob.includes(`_${postal}_`) ||
              blob.startsWith(`${postal}_`) ||
              blob.endsWith(`_${postal}`) ||
              blob === postal);
          return (
            postalHit ||
            blob.includes(`_${slug}_`) ||
            blob.startsWith(`${slug}_`) ||
            blob.endsWith(`_${slug}`) ||
            blob.includes(slug) ||
            blob.includes(compact)
          );
        })();
      return stateOk;
    });

    if (!freqKey) return stateFiltered;

    const freqFiltered = stateFiltered.filter((row) => {
      const rowFreq = String(row.frequency ?? '')
        .trim()
        .toLowerCase();
      if (!rowFreq) {
        const blob = `${String(row.name ?? '')} ${String(row.layoutKey ?? '')} ${String(row.templateId ?? '')}`
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_');
        const inferred = blob.includes('biweek')
          ? 'biweekly'
          : blob.includes('week')
            ? 'weekly'
            : blob.includes('month')
              ? 'monthly'
              : blob.includes('daily') || blob.includes('_day_') || blob.startsWith('day_') || blob.endsWith('_day')
                ? 'daily'
                : '';
        if (!inferred) return false;
        return inferred === freqKey;
      }
      const normalizedRowFreq = rowFreq.startsWith('week')
        ? 'weekly'
        : rowFreq.startsWith('day')
          ? 'daily'
          : rowFreq.startsWith('month')
            ? 'monthly'
            : rowFreq;
      return normalizedRowFreq === freqKey;
    });

    // Frequency is a preference — never hide the shared state pack when cadence
    // labels don't line up (both funders consume the same California / NY / etc. PDFs).
    return freqFiltered.length ? freqFiltered : stateFiltered;
  }

  async getByIdBoldSignTemplate(id: string) {
    return (prisma as any).boldSignTemplate.findUnique({
      where: { id },
    });
  }

  async updateBoldSignTemplate(
    id: string,
    data: {
      name?: string;
      type?: string;
      templateId?: string;
      state?: string | null;
      frequency?: string | null;
    },
  ) {
    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.templateId !== undefined) updateData.templateId = data.templateId;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.frequency !== undefined) updateData.frequency = data.frequency;

    return (prisma as any).boldSignTemplate.update({
      where: { id },
      data: updateData,
    });
  }

  async deleteBoldSignTemplate(id: string) {
    return (prisma as any).boldSignTemplate.delete({
      where: { id },
    });
  }

  async previewReverseDisbursementSchedulePdf(
    contractId: number,
    scheduleOverride?: unknown,
  ): Promise<Buffer> {
    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      select: { funderName: true },
    });
    const funderName = contract?.funderName ?? null;

    let schedule = normalizeReverseDisbursementScheduleData(scheduleOverride);
    if (!schedule) {
      const config = await loadContractReverseDisbursementConfig(contractId);
      schedule = config.schedule;
    }
    if (!schedule?.rows?.length) {
      throw new Error(
        'No disbursement schedule rows found. Paste the table and save before previewing.',
      );
    }
    return renderReverseDisbursementSchedulePdf(schedule, funderName);
  }

}

const contractService = new ContractService();
export default contractService;
