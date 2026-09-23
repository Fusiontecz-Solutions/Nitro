/**
 * Request-body coercion for the funder profile endpoints.
 *
 * Lives apart from the controller so it can be unit tested: importing the
 * controller drags in the PDF services (and puppeteer) that jest cannot load.
 *
 * The contract here is that PATCH is a genuine partial update. Every key the
 * caller did not send must come back `undefined`, because `updateFunderProfile`
 * writes any field that is not `undefined`. `name` and `docusignAccountProfileId`
 * used to be emitted unconditionally, so a patch that only rewrote a funder's
 * SignNow template list also blanked its name and unlinked its DocuSign account.
 */
import type { FunderProfileInput } from '../services/funderProfileService';

export function parseAllowedStates(raw: unknown): string[] | undefined {
  if (raw == null || raw === '') return undefined;
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s).trim()).filter(Boolean);
  }
  const text = String(raw).trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((s) => String(s).trim()).filter(Boolean);
    }
  } catch {
    // fall through to comma-separated
  }
  return text
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseFunderProfileBody(
  body: Record<string, unknown>,
): Partial<FunderProfileInput> {
  const allowedStates = parseAllowedStates(body.allowedStates);
  const excludedStates = parseAllowedStates(body.excludedStates);
  const isActiveRaw = body.isActive;
  const isActive =
    isActiveRaw === undefined || isActiveRaw === null || isActiveRaw === ''
      ? undefined
      : isActiveRaw === true || isActiveRaw === 'true';

  const assignsDealIdRaw = body.assignsDealId;
  const assignsDealId =
    assignsDealIdRaw === undefined || assignsDealIdRaw === null || assignsDealIdRaw === ''
      ? undefined
      : assignsDealIdRaw === true || assignsDealIdRaw === 'true';

  const payload: Partial<FunderProfileInput> = {
    // `name` and `docusignAccountProfileId` must stay absent when the caller did
    // not send them: PATCH is a partial update, and emitting '' / null here made
    // every partial patch blank the funder name and unlink its DocuSign account.
    name: body.name !== undefined ? String(body.name ?? '').trim() : undefined,
    displayName: body.displayName ? String(body.displayName).trim() : undefined,
    dealIdPrefix: body.dealIdPrefix ? String(body.dealIdPrefix).trim() : undefined,
    assignsDealId,
    mainContractLayoutKey: body.mainContractLayoutKey
      ? String(body.mainContractLayoutKey).trim()
      : undefined,
    contractPdfFileName: body.contractPdfFileName
      ? String(body.contractPdfFileName).trim()
      : undefined,
    organization: body.organization ? String(body.organization).trim() : undefined,
    legalName: body.legalName ? String(body.legalName).trim() : undefined,
    contactEmail:
      body.contactEmail !== undefined && body.contactEmail !== null
        ? String(body.contactEmail).trim() || null
        : undefined,
    contactPhone:
      body.contactPhone !== undefined && body.contactPhone !== null
        ? String(body.contactPhone).trim() || null
        : undefined,
    defaultCcEmail:
      body.defaultCcEmail !== undefined && body.defaultCcEmail !== null
        ? String(body.defaultCcEmail).trim() || null
        : undefined,
    addressLine1:
      body.addressLine1 !== undefined && body.addressLine1 !== null
        ? String(body.addressLine1).trim() || null
        : undefined,
    addressCity:
      body.addressCity !== undefined && body.addressCity !== null
        ? String(body.addressCity).trim() || null
        : undefined,
    addressState:
      body.addressState !== undefined && body.addressState !== null
        ? String(body.addressState).trim() || null
        : undefined,
    addressZip:
      body.addressZip !== undefined && body.addressZip !== null
        ? String(body.addressZip).trim() || null
        : undefined,
    docusignAccountProfileId:
      body.docusignAccountProfileId === undefined ? undefined
      : body.docusignAccountProfileId === '' || body.docusignAccountProfileId === null ? null
      : String(body.docusignAccountProfileId),
    sortOrder:
      body.sortOrder != null && body.sortOrder !== ''
        ? Number(body.sortOrder)
        : undefined,
    isActive,
  };

  if (body.documentsSource !== undefined && body.documentsSource !== null && body.documentsSource !== '') {
    payload.documentsSource = String(body.documentsSource).trim();
  }
  if (body.sharedDocumentsFunderId !== undefined) {
    payload.sharedDocumentsFunderId =
      body.sharedDocumentsFunderId === '' || body.sharedDocumentsFunderId == null
        ? null
        : String(body.sharedDocumentsFunderId);
  }
  if (
    body.addendumDocumentsSource !== undefined &&
    body.addendumDocumentsSource !== null &&
    body.addendumDocumentsSource !== ''
  ) {
    payload.addendumDocumentsSource = String(body.addendumDocumentsSource).trim();
  }
  if (
    body.disclosureDocumentsSource !== undefined &&
    body.disclosureDocumentsSource !== null &&
    body.disclosureDocumentsSource !== ''
  ) {
    payload.disclosureDocumentsSource = String(body.disclosureDocumentsSource).trim();
  }
  if (body.sharedAddendumFunderId !== undefined) {
    payload.sharedAddendumFunderId =
      body.sharedAddendumFunderId === '' || body.sharedAddendumFunderId == null
        ? null
        : String(body.sharedAddendumFunderId);
  }
  if (body.sharedDisclosureFunderId !== undefined) {
    payload.sharedDisclosureFunderId =
      body.sharedDisclosureFunderId === '' || body.sharedDisclosureFunderId == null
        ? null
        : String(body.sharedDisclosureFunderId);
  }

  const optionalTrimmed = (
    key:
      | 'letterCompanyName'
      | 'letterLogoUrl'
      | 'letterWatermarkUrl'
      | 'letterAccentStripLight'
      | 'letterAccentStripDark'
      | 'letterInfoTableIconBg'
      | 'letterWireBankName'
      | 'letterWireAddressLine1'
      | 'letterWireCityStateZip'
      | 'letterWireRoutingNumber'
      | 'letterWireAccountNumber',
  ) => {
    if (body[key] === undefined) return;
    payload[key] =
      body[key] === null || body[key] === ''
        ? null
        : String(body[key]).trim() || null;
  };
  optionalTrimmed('letterCompanyName');
  optionalTrimmed('letterLogoUrl');
  optionalTrimmed('letterWatermarkUrl');
  optionalTrimmed('letterAccentStripLight');
  optionalTrimmed('letterAccentStripDark');
  optionalTrimmed('letterInfoTableIconBg');
  optionalTrimmed('letterWireBankName');
  optionalTrimmed('letterWireAddressLine1');
  optionalTrimmed('letterWireCityStateZip');
  optionalTrimmed('letterWireRoutingNumber');
  optionalTrimmed('letterWireAccountNumber');

  if (body.signnowContractTemplateLink !== undefined) {
    payload.signnowContractTemplateLink =
      body.signnowContractTemplateLink === null || body.signnowContractTemplateLink === ''
        ? null
        : String(body.signnowContractTemplateLink).trim() || null;
  }

  const parseTemplateLinkList = (raw: unknown) => {
    if (raw == null || raw === '') return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  if (body.signnowAddendumTemplates !== undefined) {
    payload.signnowAddendumTemplates = parseTemplateLinkList(
      body.signnowAddendumTemplates,
    ).map((item) => {
      const row = (item || {}) as Record<string, unknown>;
      return {
        name: String(row.name ?? '').trim(),
        link: String(row.link ?? row.url ?? '').trim(),
      };
    });
  }
  if (body.signnowDisclosureTemplates !== undefined) {
    payload.signnowDisclosureTemplates = parseTemplateLinkList(
      body.signnowDisclosureTemplates,
    ).map((item) => {
      const row = (item || {}) as Record<string, unknown>;
      return {
        name: String(row.name ?? '').trim(),
        link: String(row.link ?? row.url ?? '').trim(),
      };
    });
  }

  if (allowedStates !== undefined) {
    payload.allowedStates = allowedStates;
  }
  if (excludedStates !== undefined) {
    payload.excludedStates = excludedStates;
  }

  return payload;
}
