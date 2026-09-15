import prisma from '../config/prismaClient';
import uploadService from './uploadService';
import contractKycDocumentExtractService from './contractKycDocumentExtractService';
import contractService from './contractService';
import {
  type KycDocumentType,
  type KycExtractionMapped,
  type KycOwnerIndex,
  type KycUploadSlot,
  mapKycKeyDataToPrefill,
  resolveKycUploadSlot,
  slugFromKycSlot,
} from './contractKycPrefillMapper';
import {
  assignDriverLicenseOwnerSlots,
  scoreOwnerNameMatch,
  type OwnerNameHint,
  type UploadedFileLike,
} from './autoCreateBatchClassifyService';

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

/** OCR-only KYC result used to overlap Document AI with application PDF extraction. */
export type KycPreExtraction = {
  kind: 'driverLicense' | 'voidedCheck';
  file: UploadedFileLike;
  mapped: KycExtractionMapped | null;
  error: string | null;
};

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

/** Keep application-PDF value when present; otherwise take DL/incoming. */
function mergePreferExisting(existing: unknown, incoming: unknown): string {
  const e = str(existing);
  if (e) return e;
  return str(incoming);
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
          ownerFirstName: true,
          ownerMiddleName: true,
          ownerLastName: true,
          ownerEmail: true,
          ownerMobileNumber: true,
          ownerDateOfBirth: true,
          ownerSsn: true,
          ownerFicoScore: true,
          ownerOwnershipStartDate: true,
          ownerOwnershipPercentage: true,
          ownerAddress1: true,
          ownerAddress2: true,
          ownerCity: true,
          ownerState: true,
          ownerZipCode: true,
          driverLicense: true,
          owners: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              sortOrder: true,
              firstName: true,
              middleName: true,
              lastName: true,
              email: true,
              mobileNumber: true,
              dateOfBirth: true,
              ssn: true,
              ficoScore: true,
              ownershipStartDate: true,
              ownershipPercentage: true,
              address1: true,
              address2: true,
              city: true,
              state: true,
              zipCode: true,
              driverLicense: true,
            },
          },
        },
      },
    },
  });
  if (!application?.clientId) return;

  if (mapped.documentType === 'driverLicense' && mapped.panels?.owner) {
    const owner = mapped.panels.owner;
    const guarantor = mapped.panels.guarantor;
    const dlFirstName = str(owner.firstName);
    const dlLastName = str(owner.lastName);
    const dlAddress1 = str(owner.address);
    const dlCity = str(owner.city);
    const dlState = str(owner.state);
    const dlZipCode = str(owner.zipCode);
    const driverLicense = str(guarantor?.driverLicenseNumber);
    const ownerIndex = mapped.ownerIndex ?? 1;
    const existingOwners = Array.isArray(application.client?.owners)
      ? application.client.owners
      : [];
    const client = application.client;

    // Prefer matching ClientOwner by DL name when possible (owner 1 especially).
    let target =
      existingOwners.find((row: any) => {
        const score = scoreOwnerNameMatch(
          { firstName: dlFirstName, lastName: dlLastName },
          { firstName: str(row.firstName), lastName: str(row.lastName) },
        );
        return score >= 40;
      }) || existingOwners[ownerIndex - 1];

    // Seed from application-PDF flat client fields for owner 1 when no ClientOwner row yet.
    const appSeed =
      ownerIndex === 1
        ? {
            firstName: str(client?.ownerFirstName),
            middleName: str(client?.ownerMiddleName),
            lastName: str(client?.ownerLastName),
            email: str(client?.ownerEmail),
            mobileNumber: str(client?.ownerMobileNumber),
            dateOfBirth: client?.ownerDateOfBirth ?? null,
            ssn: str(client?.ownerSsn),
            ficoScore: client?.ownerFicoScore ?? null,
            ownershipStartDate: client?.ownerOwnershipStartDate ?? null,
            ownershipPercentage: client?.ownerOwnershipPercentage ?? null,
            address1: str(client?.ownerAddress1),
            address2: str(client?.ownerAddress2),
            city: str(client?.ownerCity),
            state: str(client?.ownerState),
            zipCode: str(client?.ownerZipCode),
            driverLicense: str(client?.driverLicense),
          }
        : null;

    const existing = {
      firstName: str(target?.firstName) || str(appSeed?.firstName),
      middleName: str(target?.middleName) || str(appSeed?.middleName),
      lastName: str(target?.lastName) || str(appSeed?.lastName),
      email: str(target?.email) || str(appSeed?.email),
      mobileNumber: str(target?.mobileNumber) || str(appSeed?.mobileNumber),
      dateOfBirth: target?.dateOfBirth ?? appSeed?.dateOfBirth ?? null,
      ssn: str(target?.ssn) || str(appSeed?.ssn),
      ficoScore: target?.ficoScore ?? appSeed?.ficoScore ?? null,
      ownershipStartDate:
        target?.ownershipStartDate ?? appSeed?.ownershipStartDate ?? null,
      ownershipPercentage:
        target?.ownershipPercentage ?? appSeed?.ownershipPercentage ?? null,
      address1: str(target?.address1) || str(appSeed?.address1),
      address2: str(target?.address2) || str(appSeed?.address2),
      city: str(target?.city) || str(appSeed?.city),
      state: str(target?.state) || str(appSeed?.state),
      zipCode: str(target?.zipCode) || str(appSeed?.zipCode),
      driverLicense: str(target?.driverLicense) || str(appSeed?.driverLicense),
    };

    // Merge: keep application-PDF values; only fill blanks from DL; DL# always from license when present.
    const merged = {
      firstName: mergePreferExisting(existing.firstName, dlFirstName) || 'Owner',
      middleName: mergePreferExisting(existing.middleName, '') || null,
      lastName: mergePreferExisting(existing.lastName, dlLastName) || '—',
      email: mergePreferExisting(existing.email, '') || null,
      mobileNumber: mergePreferExisting(existing.mobileNumber, '') || null,
      dateOfBirth: existing.dateOfBirth ?? null,
      ssn: mergePreferExisting(existing.ssn, '') || null,
      ficoScore: existing.ficoScore ?? null,
      ownershipStartDate: existing.ownershipStartDate ?? null,
      ownershipPercentage: existing.ownershipPercentage ?? null,
      address1: mergePreferExisting(existing.address1, dlAddress1) || null,
      address2: mergePreferExisting(existing.address2, '') || null,
      city: mergePreferExisting(existing.city, dlCity) || null,
      state: mergePreferExisting(existing.state, dlState) || null,
      zipCode: mergePreferExisting(existing.zipCode, dlZipCode) || null,
      driverLicense: driverLicense || mergePreferExisting(existing.driverLicense, '') || null,
    };

    if (target?.id) {
      const ownerPatch: Record<string, unknown> = {};
      // Fill gaps only — never wipe application-PDF fields with DL values.
      if (!str(target.firstName) && merged.firstName) ownerPatch.firstName = merged.firstName;
      if (!str(target.middleName) && merged.middleName) ownerPatch.middleName = merged.middleName;
      if (!str(target.lastName) && merged.lastName) ownerPatch.lastName = merged.lastName;
      if (!str(target.email) && merged.email) ownerPatch.email = merged.email;
      if (!str(target.mobileNumber) && merged.mobileNumber) {
        ownerPatch.mobileNumber = merged.mobileNumber;
      }
      if (!target.dateOfBirth && merged.dateOfBirth) ownerPatch.dateOfBirth = merged.dateOfBirth;
      if (!str(target.ssn) && merged.ssn) ownerPatch.ssn = merged.ssn;
      if (target.ficoScore == null && merged.ficoScore != null) {
        ownerPatch.ficoScore = merged.ficoScore;
      }
      if (!target.ownershipStartDate && merged.ownershipStartDate) {
        ownerPatch.ownershipStartDate = merged.ownershipStartDate;
      }
      if (target.ownershipPercentage == null && merged.ownershipPercentage != null) {
        ownerPatch.ownershipPercentage = merged.ownershipPercentage;
      }
      if (!str(target.address1) && merged.address1) ownerPatch.address1 = merged.address1;
      if (!str(target.address2) && merged.address2) ownerPatch.address2 = merged.address2;
      if (!str(target.city) && merged.city) ownerPatch.city = merged.city;
      if (!str(target.state) && merged.state) ownerPatch.state = merged.state;
      if (!str(target.zipCode) && merged.zipCode) ownerPatch.zipCode = merged.zipCode;
      if (driverLicense) ownerPatch.driverLicense = driverLicense;
      if (Object.keys(ownerPatch).length > 0) {
        await (prisma as any).clientOwner.update({
          where: { id: target.id },
          data: ownerPatch,
        });
      }
    } else {
      await (prisma as any).clientOwner.create({
        data: {
          clientId: application.clientId,
          sortOrder: ownerIndex - 1,
          firstName: merged.firstName,
          middleName: merged.middleName,
          lastName: merged.lastName,
          email: merged.email,
          mobileNumber: merged.mobileNumber,
          dateOfBirth: merged.dateOfBirth,
          ssn: merged.ssn,
          ficoScore: merged.ficoScore,
          ownershipStartDate: merged.ownershipStartDate,
          ownershipPercentage: merged.ownershipPercentage,
          address1: merged.address1,
          address2: merged.address2,
          city: merged.city,
          state: merged.state,
          zipCode: merged.zipCode,
          driverLicense: merged.driverLicense,
        },
      });
    }

    if (ownerIndex === 1) {
      const clientPatch: Record<string, unknown> = {};
      // Fill blanks only — keep application-PDF owner email/phone/ssn/dob/fico/name/address.
      if (!str(client?.ownerFirstName) && merged.firstName) {
        clientPatch.ownerFirstName = merged.firstName;
      }
      if (!str(client?.ownerLastName) && merged.lastName) {
        clientPatch.ownerLastName = merged.lastName;
      }
      if (!str(client?.ownerAddress1) && merged.address1) {
        clientPatch.ownerAddress1 = merged.address1;
      }
      if (!str(client?.ownerCity) && merged.city) clientPatch.ownerCity = merged.city;
      if (!str(client?.ownerState) && merged.state) clientPatch.ownerState = merged.state;
      if (!str(client?.ownerZipCode) && merged.zipCode) {
        clientPatch.ownerZipCode = merged.zipCode;
      }
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

    // Cloudinary + Document AI in parallel per file; all files in one pass.
    const results = await Promise.all(
      entries.map(async ({ file, resolved }) => {
        const slot = resolved!;
        const [uploadResult, extractOutcome] = await Promise.all([
          uploadService.uploadFile(file, folder, file?.name),
          contractKycDocumentExtractService
            .extractFromUploadedFile(file, slot.documentType, slot.ownerIndex)
            .then((mapped) => ({ mapped, error: null as string | null }))
            .catch((extractErr: unknown) => {
              const msg =
                extractErr instanceof Error ? extractErr.message : 'KYC extraction failed';
              console.error(
                `[uploadApplicationKycDocuments] extraction failed for ${slot.slot}:`,
                extractErr,
              );
              return { mapped: null, error: msg };
            }),
        ]);

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

        const document = {
          _id: created.id,
          id: created.id,
          url: created.url,
          originalName: created.originalName,
          requestedDocumentSlug: created.requestedDocumentSlug,
          documentType: created.requestedDocumentSlug,
          slot: slot.slot,
        };

        if (extractOutcome.error || !extractOutcome.mapped) {
          return {
            document,
            extraction: {
              documentType: slot.documentType,
              ownerIndex: slot.ownerIndex,
              slot: slot.slot,
              fileId: created.id,
              fileName: originalName,
              fileUrl: secureUrl,
              error: extractOutcome.error || 'KYC extraction failed',
            } as Record<string, unknown>,
          };
        }

        const mapped = extractOutcome.mapped;
        return {
          document,
          extraction: {
            documentType: mapped.documentType,
            ownerIndex: mapped.ownerIndex,
            slot: mapped.slot,
            keyData: mapped.keyData,
            contractPrefill: mapped.contractPrefill,
            panels: mapped.panels,
            fileId: created.id,
            fileName: originalName,
            fileUrl: secureUrl,
          } as Record<string, unknown>,
        };
      }),
    );

    return {
      documents: results.map((row) => row.document),
      kycExtractions: results.map((row) => row.extraction),
    };
  }

  /**
   * Upload + extract KYC docs in parallel, then auto-sync successful extractions into
   * application.kycPrefill / client / bank (used by auto-create-from-pdf).
   */
  async uploadExtractAndAutoSync(
    applicationId: string,
    filesByType: Record<string, any>,
    createdById?: string | null,
  ): Promise<{
    documents: Array<Record<string, unknown>>;
    kycExtractions: Array<Record<string, unknown>>;
  }> {
    const { documents, kycExtractions } = await this.uploadAndExtract(
      applicationId,
      filesByType,
    );

    const syncedExtractions = await Promise.all(
      kycExtractions.map(async (ext) => {
        if (ext.error) return { ...ext, synced: false };
        try {
          const synced = await this.syncKycPrefill(
            applicationId,
            {
              documentType: String(ext.documentType || ''),
              slot: String(ext.slot || ''),
              ownerIndex: Number(ext.ownerIndex) === 2 ? 2 : 1,
              contractPrefill: (ext.contractPrefill as Record<string, string>) || {},
              panels: (ext.panels as KycExtractionMapped['panels']) || {},
              keyData: (ext.keyData as Record<string, string>) || {},
              fileId: ext.fileId ? String(ext.fileId) : undefined,
              fileName: ext.fileName ? String(ext.fileName) : undefined,
              fileUrl: ext.fileUrl ? String(ext.fileUrl) : undefined,
            },
            createdById,
          );
          return {
            ...ext,
            synced: true,
            kycPrefill: synced.kycPrefill,
          };
        } catch (syncErr: unknown) {
          const msg =
            syncErr instanceof Error ? syncErr.message : 'KYC sync failed';
          console.error('[uploadExtractAndAutoSync] sync failed:', syncErr);
          return { ...ext, synced: false, syncError: msg };
        }
      }),
    );

    return { documents, kycExtractions: syncedExtractions };
  }

  /**
   * Document AI only (no Cloudinary / DB). Used to overlap KYC OCR with application PDF OCR.
   */
  async extractKycFilesOnly(input: {
    driverLicenseFiles: UploadedFileLike[];
    voidedCheckFile?: UploadedFileLike | null;
  }): Promise<KycPreExtraction[]> {
    const licenseFiles = Array.isArray(input.driverLicenseFiles)
      ? input.driverLicenseFiles.filter(Boolean)
      : [];
    const voidFile = input.voidedCheckFile || null;
    const work: Array<{ kind: 'driverLicense' | 'voidedCheck'; file: UploadedFileLike }> = [
      ...licenseFiles.map((file) => ({ kind: 'driverLicense' as const, file })),
      ...(voidFile ? [{ kind: 'voidedCheck' as const, file: voidFile }] : []),
    ];
    if (!work.length) return [];

    return Promise.all(
      work.map(async (row) => {
        try {
          const mapped = await contractKycDocumentExtractService.extractFromUploadedFile(
            row.file as any,
            row.kind,
            1,
          );
          return { kind: row.kind, file: row.file, mapped, error: null };
        } catch (extractErr: unknown) {
          const msg =
            extractErr instanceof Error ? extractErr.message : 'KYC extraction failed';
          console.error(
            `[extractKycFilesOnly] extraction failed for ${row.file?.name || row.kind}:`,
            extractErr,
          );
          return { kind: row.kind, file: row.file, mapped: null, error: msg };
        }
      }),
    );
  }

  /**
   * Batch path for multi-PDF auto-create: upload + extract DL/void check files in parallel,
   * map each driver's license to owner 1 or 2 by name match, then auto-sync.
   * When `preExtractions` is provided (OCR already done), only Cloudinary upload + sync run.
   */
  async uploadExtractAssignOwnersAndSync(
    applicationId: string,
    input: {
      driverLicenseFiles: UploadedFileLike[];
      voidedCheckFile?: UploadedFileLike | null;
      ownerHints?: OwnerNameHint[];
      /** Optional OCR results from extractKycFilesOnly (overlap with app PDF OCR). */
      preExtractions?: KycPreExtraction[];
    },
    createdById?: string | null,
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

    const folder = `ih-crm/applications/${application.applicationId || application.id}`;
    const licenseFiles = Array.isArray(input.driverLicenseFiles)
      ? input.driverLicenseFiles.filter(Boolean)
      : [];
    const voidFile = input.voidedCheckFile || null;

    type WorkRow = {
      kind: 'driverLicense' | 'voidedCheck';
      file: UploadedFileLike;
      preMapped?: KycExtractionMapped | null;
      preError?: string | null;
    };
    const preByFile = new Map<UploadedFileLike, KycPreExtraction>();
    for (const row of input.preExtractions || []) {
      if (row?.file) preByFile.set(row.file, row);
    }

    const work: WorkRow[] = [
      ...licenseFiles.map((file) => {
        const pre = preByFile.get(file);
        return {
          kind: 'driverLicense' as const,
          file,
          preMapped: pre?.mapped,
          preError: pre?.error,
        };
      }),
      ...(voidFile
        ? [
            (() => {
              const pre = preByFile.get(voidFile);
              return {
                kind: 'voidedCheck' as const,
                file: voidFile,
                preMapped: pre?.mapped,
                preError: pre?.error,
              };
            })(),
          ]
        : []),
    ];

    if (!work.length) {
      return { documents: [], kycExtractions: [] };
    }

    // Sequential Cloudinary uploads (with service-level 429 retries) — parallel uploads
    // were rate-limited and aborted the whole KYC batch, leaving only the application PDF.
    const rawResults: Array<{
      kind: 'driverLicense' | 'voidedCheck';
      file: UploadedFileLike;
      document: Record<string, unknown>;
      mapped: KycExtractionMapped | null;
      fileMeta: { fileId?: string; fileName: string; fileUrl?: string };
      error: string | null;
    }> = [];

    for (const row of work) {
      const originalName = row.file?.name || String(row.kind);
      const tempSlug =
        row.kind === 'voidedCheck' ? 'voided-check' : 'driver-license';

      let mapped: KycExtractionMapped | null = null;
      let extractError: string | null = null;

      if (row.preMapped !== undefined || row.preError) {
        mapped = row.preMapped ?? null;
        extractError = row.preError ?? null;
      } else {
        try {
          mapped = await contractKycDocumentExtractService.extractFromUploadedFile(
            row.file as any,
            row.kind,
            1,
          );
        } catch (extractErr: unknown) {
          extractError =
            extractErr instanceof Error ? extractErr.message : 'KYC extraction failed';
          console.error(
            `[uploadExtractAssignOwnersAndSync] extraction failed for ${originalName}:`,
            extractErr,
          );
        }
      }

      const uploadResult = await uploadService.uploadFile(
        row.file as any,
        folder,
        row.file?.name,
      );

      if (!uploadResult.success || !uploadResult.data) {
        const uploadErr =
          uploadResult.error || `Failed to upload ${row.file?.name || row.kind}`;
        console.error(
          `[uploadExtractAssignOwnersAndSync] upload failed for ${originalName}:`,
          uploadErr,
        );
        // Still sync owner/bank data from OCR even when Cloudinary fails — file row omitted.
        rawResults.push({
          kind: row.kind,
          file: row.file,
          document: {
            originalName,
            requestedDocumentSlug: tempSlug,
            documentType: tempSlug,
            uploadError: uploadErr,
          },
          mapped,
          fileMeta: {
            fileName: originalName,
          },
          error: mapped ? null : extractError || uploadErr,
        });
        continue;
      }

      const secureUrl = uploadResult.data.secure_url as string;
      const publicId = uploadResult.data.public_id as string;
      const created = await (prisma as any).applicationFile.create({
        data: {
          applicationId,
          url: secureUrl,
          publicId,
          originalName:
            row.file?.name || uploadResult.fileName || String(row.kind),
          mimeType: (row.file as any)?.mimetype || 'application/octet-stream',
          size: Number((row.file as any)?.size || uploadResult.data.bytes || 0),
          requestedDocumentSlug: tempSlug,
        },
      });

      rawResults.push({
        kind: row.kind,
        file: row.file,
        document: {
          _id: created.id,
          id: created.id,
          url: created.url,
          originalName: created.originalName,
          requestedDocumentSlug: created.requestedDocumentSlug,
          documentType: created.requestedDocumentSlug,
        },
        mapped,
        fileMeta: {
          fileId: created.id,
          fileName: created.originalName,
          fileUrl: secureUrl,
        },
        error: extractError,
      });

      // Stagger uploads so Cloudinary free-tier rate limits are less likely.
      await new Promise((r) => setTimeout(r, 600));
    }

    const licenseRows = rawResults.filter((r) => r.kind === 'driverLicense' && r.mapped);
    const assignments = assignDriverLicenseOwnerSlots(
      licenseRows.map((r) => ({
        file: r.file,
        firstName: r.mapped?.panels?.owner?.firstName,
        lastName: r.mapped?.panels?.owner?.lastName,
      })),
      input.ownerHints || [],
    );

    const assignmentByFile = new Map(
      assignments.map((a) => [a.file, a] as const),
    );

    const finalized: Array<{
      document: Record<string, unknown>;
      extraction: Record<string, unknown>;
    }> = [];

    for (const row of rawResults) {
      if (row.error || !row.mapped) {
        finalized.push({
          document: row.document,
          extraction: {
            documentType: row.kind,
            ownerIndex: 1,
            slot: row.kind === 'voidedCheck' ? 'voidedCheck' : 'driverLicense',
            fileId: row.fileMeta.fileId,
            fileName: row.fileMeta.fileName,
            fileUrl: row.fileMeta.fileUrl,
            error: row.error || 'KYC extraction failed',
            synced: false,
          },
        });
        continue;
      }

      let mapped = row.mapped;
      if (row.kind === 'driverLicense') {
        const assignment = assignmentByFile.get(row.file);
        const ownerIndex = assignment?.ownerIndex ?? 1;
        const slot = assignment?.slot ?? 'driverLicense';
        mapped = mapKycKeyDataToPrefill(
          'driverLicense',
          mapped.keyData || {},
          ownerIndex,
        );
        // Keep slot explicit when mapper defaults by ownerIndex.
        mapped = { ...mapped, slot, ownerIndex };

        if (row.fileMeta.fileId) {
          await (prisma as any).applicationFile.update({
            where: { id: row.fileMeta.fileId },
            data: { requestedDocumentSlug: slugFromKycSlot(slot) },
          });
          row.document.requestedDocumentSlug = slugFromKycSlot(slot);
          row.document.documentType = slugFromKycSlot(slot);
          row.document.slot = slot;
        }
      } else {
        row.document.slot = 'voidedCheck';
      }

      try {
        const synced = await this.syncKycPrefill(
          applicationId,
          {
            documentType: mapped.documentType,
            slot: mapped.slot,
            ownerIndex: mapped.ownerIndex,
            contractPrefill: mapped.contractPrefill,
            panels: mapped.panels,
            keyData: mapped.keyData,
            fileId: row.fileMeta.fileId,
            fileName: row.fileMeta.fileName,
            fileUrl: row.fileMeta.fileUrl,
          },
          createdById,
        );
        finalized.push({
          document: row.document,
          extraction: {
            documentType: mapped.documentType,
            ownerIndex: mapped.ownerIndex,
            slot: mapped.slot,
            keyData: mapped.keyData,
            contractPrefill: mapped.contractPrefill,
            panels: mapped.panels,
            fileId: row.fileMeta.fileId,
            fileName: row.fileMeta.fileName,
            fileUrl: row.fileMeta.fileUrl,
            synced: true,
            kycPrefill: synced.kycPrefill,
          },
        });
      } catch (syncErr: unknown) {
        const msg =
          syncErr instanceof Error ? syncErr.message : 'KYC sync failed';
        console.error('[uploadExtractAssignOwnersAndSync] sync failed:', syncErr);
        finalized.push({
          document: row.document,
          extraction: {
            documentType: mapped.documentType,
            ownerIndex: mapped.ownerIndex,
            slot: mapped.slot,
            keyData: mapped.keyData,
            contractPrefill: mapped.contractPrefill,
            panels: mapped.panels,
            fileId: row.fileMeta.fileId,
            fileName: row.fileMeta.fileName,
            fileUrl: row.fileMeta.fileUrl,
            synced: false,
            syncError: msg,
          },
        });
      }
    }

    return {
      documents: finalized.map((r) => r.document),
      kycExtractions: finalized.map((r) => r.extraction),
    };
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
