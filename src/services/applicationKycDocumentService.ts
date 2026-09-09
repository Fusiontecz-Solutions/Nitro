import prisma from '../config/prismaClient';
import uploadService from './uploadService';
import contractKycDocumentExtractService from './contractKycDocumentExtractService';
import contractService from './contractService';
import {
  type KycDocumentType,
  type KycExtractionMapped,
  type KycOwnerIndex,
  type KycUploadSlot,
  resolveKycUploadSlot,
  slugFromKycSlot,
} from './contractKycPrefillMapper';

export type ApplicationKycSlotRecord = {
  documentType: KycDocumentType;
  ownerIndex: KycOwnerIndex;
  slot: KycUploadSlot;
  keyData?: Record<string, string>;
  contractPrefill?: Record<string, string>;
  panels?: KycExtractionMapped['panels'];
  fileId?: string;
  fileName?: string;
  fileUrl?: string;
  syncedAt?: string;
};

export type ApplicationKycPrefill = {
  slots?: Partial<Record<KycUploadSlot, ApplicationKycSlotRecord>>;
};

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function parseKycPrefill(raw: unknown): ApplicationKycPrefill {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { slots: {} };
  const slots = (raw as ApplicationKycPrefill).slots;
  if (!slots || typeof slots !== 'object') return { slots: {} };
  return { slots: { ...slots } };
}

function firstFile(input: unknown): any | null {
  if (!input) return null;
  if (Array.isArray(input)) return input.find(Boolean) ?? null;
  return input;
}

export function resolveApplicationKycOwnerCount(client: {
  owners?: Array<{ firstName?: string | null; lastName?: string | null }>;
  ownerFirstName?: string | null;
  ownerLastName?: string | null;
} | null | undefined): 1 | 2 {
  const related = Array.isArray(client?.owners) ? client!.owners! : [];
  const named = related.filter((o) => str(o?.firstName) || str(o?.lastName));
  if (named.length >= 2) return 2;
  return 1;
}

async function persistKycToClientAndBank(
  applicationId: string,
  mapped: KycExtractionMapped,
  createdById?: string | null,
): Promise<void> {
  const application = await (prisma as any).application.findUnique({
    where: { id: applicationId },
    select: {
      id: true,
      clientId: true,
      createdById: true,
      client: {
        select: {
          id: true,
          owners: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            select: { id: true, sortOrder: true },
          },
        },
      },
    },
  });
  if (!application?.clientId) return;

  if (mapped.documentType === 'driverLicense' && mapped.panels?.owner) {
    const owner = mapped.panels.owner;
    const guarantor = mapped.panels.guarantor;
    const firstName = str(owner.firstName);
    const lastName = str(owner.lastName);
    const address1 = str(owner.address);
    const city = str(owner.city);
    const state = str(owner.state);
    const zipCode = str(owner.zipCode);
    const driverLicense = str(guarantor?.driverLicenseNumber);
    const ownerIndex = mapped.ownerIndex ?? 1;
    const existingOwners = Array.isArray(application.client?.owners)
      ? application.client.owners
      : [];
    const target = existingOwners[ownerIndex - 1];

    const ownerPatch: Record<string, unknown> = {};
    if (firstName) ownerPatch.firstName = firstName;
    if (lastName) ownerPatch.lastName = lastName;
    if (address1) ownerPatch.address1 = address1;
    if (city) ownerPatch.city = city;
    if (state) ownerPatch.state = state;
    if (zipCode) ownerPatch.zipCode = zipCode;
    if (driverLicense) ownerPatch.driverLicense = driverLicense;

    if (Object.keys(ownerPatch).length > 0) {
      if (target?.id) {
        await (prisma as any).clientOwner.update({
          where: { id: target.id },
          data: ownerPatch,
        });
      } else {
        await (prisma as any).clientOwner.create({
          data: {
            clientId: application.clientId,
            sortOrder: ownerIndex - 1,
            firstName: firstName || 'Owner',
            lastName: lastName || '—',
            address1: address1 || null,
            city: city || null,
            state: state || null,
            zipCode: zipCode || null,
            driverLicense: driverLicense || null,
          },
        });
      }
    }

    if (ownerIndex === 1) {
      const clientPatch: Record<string, unknown> = {};
      if (firstName) clientPatch.ownerFirstName = firstName;
      if (lastName) clientPatch.ownerLastName = lastName;
      if (address1) clientPatch.ownerAddress1 = address1;
      if (city) clientPatch.ownerCity = city;
      if (state) clientPatch.ownerState = state;
      if (zipCode) clientPatch.ownerZipCode = zipCode;
      if (driverLicense) clientPatch.driverLicense = driverLicense;
      if (Object.keys(clientPatch).length > 0) {
        await (prisma as any).client.update({
          where: { id: application.clientId },
          data: clientPatch,
        });
      }
    }
  }

  if (mapped.documentType === 'voidedCheck' && mapped.panels?.ach) {
    const ach = mapped.panels.ach;
    const bankName = str(ach.bankName);
    const accountNumber = str(ach.accountNumber);
    const routingNumber = str(ach.routingNumber);
    const actorId = str(createdById) || str(application.createdById);

    if (bankName || accountNumber || routingNumber) {
      const existingBank = await (prisma as any).bankDetail.findFirst({
        where: { applicationId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (existingBank?.id) {
        const bankPatch: Record<string, unknown> = {};
        if (bankName) bankPatch.bankName = bankName;
        if (accountNumber) bankPatch.accountNumber = accountNumber;
        if (routingNumber) bankPatch.routingNumber = routingNumber;
        await (prisma as any).bankDetail.update({
          where: { id: existingBank.id },
          data: bankPatch,
        });
      } else if (actorId && bankName && accountNumber) {
        await (prisma as any).bankDetail.create({
          data: {
            applicationId,
            createdById: actorId,
            bankName,
            accountNumber,
            routingNumber: routingNumber || null,
          },
        });
      }

      if (accountNumber && routingNumber) {
        const existingClientBank = await (prisma as any).clientBankInfo.findFirst({
          where: { OR: [{ applicationId }, { clientId: application.clientId }] },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (existingClientBank?.id) {
          await (prisma as any).clientBankInfo.update({
            where: { id: existingClientBank.id },
            data: {
              bankName: bankName || undefined,
              accountNumber,
              routingNumber,
              applicationId,
            },
          });
        } else {
          await (prisma as any).clientBankInfo.create({
            data: {
              clientId: application.clientId,
              applicationId,
              bankName: bankName || null,
              accountNumber,
              routingNumber,
            },
          });
        }
      }
    }
  }
}

async function persistSlotOnApplication(
  applicationId: string,
  mapped: KycExtractionMapped,
  fileMeta?: { fileId?: string; fileName?: string; fileUrl?: string },
): Promise<ApplicationKycPrefill> {
  const application = await (prisma as any).application.findUnique({
    where: { id: applicationId },
    select: { kycPrefill: true },
  });
  const next = parseKycPrefill(application?.kycPrefill);
  const slot = mapped.slot;
  next.slots = next.slots ?? {};
  next.slots[slot] = {
    documentType: mapped.documentType,
    ownerIndex: mapped.ownerIndex,
    slot,
    keyData: mapped.keyData,
    contractPrefill: mapped.contractPrefill,
    panels: mapped.panels,
    fileId: fileMeta?.fileId,
    fileName: fileMeta?.fileName,
    fileUrl: fileMeta?.fileUrl,
    syncedAt: new Date().toISOString(),
  };
  await (prisma as any).application.update({
    where: { id: applicationId },
    data: { kycPrefill: next },
  });
  return next;
}

async function applyMappedToExistingContract(
  applicationId: string,
  mapped: KycExtractionMapped,
): Promise<void> {
  const contract = await (prisma as any).contract.findUnique({
    where: { applicationId },
    select: { id: true },
  });
  if (!contract?.id) return;
  await contractService.persistKycExtractionToContract(contract.id, mapped);
}

export function mergeApplicationKycPrefillPatches(
  kycPrefill: unknown,
): Record<string, string> {
  const parsed = parseKycPrefill(kycPrefill);
  const merged: Record<string, string> = {};
  for (const slot of Object.values(parsed.slots ?? {})) {
    if (!slot?.contractPrefill) continue;
    for (const [key, val] of Object.entries(slot.contractPrefill)) {
      if (str(val)) merged[key] = String(val).trim();
    }
  }
  return merged;
}

class ApplicationKycDocumentService {
  parsePrefill(raw: unknown): ApplicationKycPrefill {
    return parseKycPrefill(raw);
  }

  async uploadAndExtract(
    applicationId: string,
    filesByType: Record<string, any>,
  ): Promise<{
    documents: Array<Record<string, unknown>>;
    kycExtractions: Array<Record<string, unknown>>;
  }> {
    const application = await (prisma as any).application.findUnique({
      where: { id: applicationId },
      select: { id: true, applicationId: true },
    });
    if (!application) {
      throw new Error('Application not found');
    }

    const entries = Object.entries(filesByType || {})
      .map(([documentType, input]) => ({
        documentType,
        file: firstFile(input),
        resolved: resolveKycUploadSlot(documentType),
      }))
      .filter((row) => row.file && row.resolved);

    if (!entries.length) {
      throw new Error('No driver license or voided check file found to upload');
    }

    const folder = `ih-crm/applications/${application.applicationId || application.id}`;
    const savedDocuments: Array<Record<string, unknown>> = [];
    const kycExtractions: Array<Record<string, unknown>> = [];

    for (const { file, resolved } of entries) {
      const slot = resolved!;
      const uploadResult = await uploadService.uploadFile(file, folder, file?.name);
      if (!uploadResult.success || !uploadResult.data) {
        throw new Error(uploadResult.error || `Failed to upload ${slot.slot}`);
      }

      const secureUrl = uploadResult.data.secure_url as string;
      const publicId = uploadResult.data.public_id as string;
      const originalName = file?.name || uploadResult.fileName || `${slot.slot}`;
      const created = await (prisma as any).applicationFile.create({
        data: {
          applicationId,
          url: secureUrl,
          publicId,
          originalName,
          mimeType: file?.mimetype || 'application/octet-stream',
          size: Number(file?.size || uploadResult.data.bytes || 0),
          requestedDocumentSlug: slugFromKycSlot(slot.slot),
        },
      });

      savedDocuments.push({
        _id: created.id,
        id: created.id,
        url: created.url,
        originalName: created.originalName,
        requestedDocumentSlug: created.requestedDocumentSlug,
        documentType: created.requestedDocumentSlug,
        slot: slot.slot,
      });

      try {
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
          fileId: created.id,
          fileName: originalName,
          fileUrl: secureUrl,
        });
      } catch (extractErr: unknown) {
        const msg =
          extractErr instanceof Error ? extractErr.message : 'KYC extraction failed';
        console.error(`[uploadApplicationKycDocuments] extraction failed for ${slot.slot}:`, extractErr);
        kycExtractions.push({
          documentType: slot.documentType,
          ownerIndex: slot.ownerIndex,
          slot: slot.slot,
          fileId: created.id,
          fileName: originalName,
          fileUrl: secureUrl,
          error: msg,
        });
      }
    }

    return { documents: savedDocuments, kycExtractions };
  }

  async syncKycPrefill(
    applicationId: string,
    payload: {
      documentType?: string;
      slot?: string;
      ownerIndex?: number;
      contractPrefill?: Record<string, string>;
      panels?: KycExtractionMapped['panels'];
      keyData?: Record<string, string>;
      fileId?: string;
      fileName?: string;
      fileUrl?: string;
    },
    createdById?: string | null,
  ) {
    const resolved =
      resolveKycUploadSlot(payload.slot || payload.documentType) ??
      (payload.ownerIndex === 2
        ? resolveKycUploadSlot('driverLicenseOwner2')
        : resolveKycUploadSlot(payload.documentType || 'driverLicense'));
    if (!resolved) {
      throw new Error('documentType must be driverLicense, driverLicenseOwner2, or voidedCheck');
    }

    const mapped: KycExtractionMapped = {
      documentType: resolved.documentType,
      ownerIndex: resolved.ownerIndex,
      slot: resolved.slot,
      keyData: payload.keyData ?? {},
      contractPrefill: payload.contractPrefill ?? {},
      panels: payload.panels ?? {},
    };

    const kycPrefill = await persistSlotOnApplication(applicationId, mapped, {
      fileId: payload.fileId,
      fileName: payload.fileName,
      fileUrl: payload.fileUrl,
    });
    await persistKycToClientAndBank(applicationId, mapped, createdById);
    await applyMappedToExistingContract(applicationId, mapped);

    return {
      documentType: mapped.documentType,
      ownerIndex: mapped.ownerIndex,
      slot: mapped.slot,
      keyData: mapped.keyData,
      contractPrefill: mapped.contractPrefill,
      panels: mapped.panels,
      kycPrefill,
    };
  }

  async applySavedKycToContract(applicationId: string, contractId: number): Promise<void> {
    const application = await (prisma as any).application.findUnique({
      where: { id: applicationId },
      select: { kycPrefill: true },
    });
    const slots = parseKycPrefill(application?.kycPrefill).slots ?? {};
    for (const slot of Object.values(slots)) {
      if (!slot?.documentType) continue;
      const mapped: KycExtractionMapped = {
        documentType: slot.documentType,
        ownerIndex: slot.ownerIndex ?? 1,
        slot: slot.slot,
        keyData: slot.keyData ?? {},
        contractPrefill: slot.contractPrefill ?? {},
        panels: slot.panels ?? {},
      };
      await contractService.persistKycExtractionToContract(contractId, mapped);
    }
  }
}

export default new ApplicationKycDocumentService();
