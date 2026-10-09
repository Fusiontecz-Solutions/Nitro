import type { Request, Response } from 'express';
import type { UploadedFile } from 'express-fileupload';
import {
  createDocuSignAccountProfile,
  deleteDocuSignAccountProfile,
  getDocuSignAccountProfileById,
  listDocuSignAccountProfileOptions,
  listDocuSignAccountProfiles,
  updateDocuSignAccountProfile,
} from '../services/docusignAccountProfileService';
import {
  createFunderProfile,
  deleteFunderProfile,
  getFunderProfileById,
  listFunderProfiles,
  updateFunderProfile,
  uploadFunderContractPdf,
  uploadFunderLogo,
  uploadFunderLetterLogo,
  uploadFunderSupplementalPdf,
  uploadFunderDisclosurePdf,
  uploadFunderNamedAddendumPdf,
  listFunderDocumentTemplates,
  deleteFunderDocumentTemplate,
  type FunderProfileInput,
} from '../services/funderProfileService';
import { resolveContractCcDefaultsForApi } from '../utils/contractCcDefaults';
import { getSendGridUsageSummary } from '../services/sendgridUsageService';
import prisma from '../config/prismaClient';
import { invalidateStoredTemplatePdf } from '../services/signnow/utils/signnow-template-pdf-archive';
import { extractSignNowTemplateId } from '../services/signnow/utils/signnow-client';
import type { FunderSupplementalLayoutType } from '../utils/funderContractLayout';
import { parseFunderProfileBody } from './funderProfileBodyParser';
import {
  describeShareResult,
  isFunderTemplateKind,
  shareFunderTemplates as shareFunderTemplatesService,
} from '../services/funderTemplateShareService';

function handleError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = /not found/i.test(message) ? 404 : 400;
  return res.status(status).json({ success: false, message });
}

function getUploadedContractFile(req: Request): UploadedFile | null {
  const files = (req as Request & { files?: { contract?: UploadedFile | UploadedFile[] } }).files;
  if (!files?.contract) return null;
  const file = files.contract;
  return Array.isArray(file) ? file[0] : file;
}

function getUploadedLogoFile(req: Request): UploadedFile | null {
  const files = (req as Request & { files?: { logo?: UploadedFile | UploadedFile[] } }).files;
  if (!files?.logo) return null;
  const file = files.logo;
  return Array.isArray(file) ? file[0] : file;
}

function getUploadedLetterLogoFile(req: Request): UploadedFile | null {
  const files = (req as Request & {
    files?: { letterLogo?: UploadedFile | UploadedFile[] };
  }).files;
  if (!files?.letterLogo) return null;
  const file = files.letterLogo;
  return Array.isArray(file) ? file[0] : file;
}

function getUploadedSupplementalFile(
  req: Request,
  field: string,
): UploadedFile | null {
  const files = (req as Request & { files?: Record<string, UploadedFile | UploadedFile[]> }).files;
  const raw = files?.[field];
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Platform supplemental layout uploads removed — use funder named-addendum upload instead. */
const SUPPLEMENTAL_UPLOAD_FIELDS: Record<string, FunderSupplementalLayoutType> = {};


async function saveFunderWithOptionalAssets(
  req: Request,
  save: () => Promise<Awaited<ReturnType<typeof createFunderProfile>>>,
) {
  const contractFile = getUploadedContractFile(req);
  const logoFile = getUploadedLogoFile(req);
  const letterLogoFile = getUploadedLetterLogoFile(req);
  let data = await save();

  if (contractFile) {
    const funderId = String(data.id || '').trim();
    const funderName = String(data.name || '').trim();
    if (!funderId || !funderName) {
      throw new Error('Funder id and name are required to upload a contract.');
    }
    data = await uploadFunderContractPdf(funderId, funderName, contractFile);
  }

  if (logoFile) {
    const funderId = String(data.id || '').trim();
    if (!funderId) {
      throw new Error('Funder id is required to upload a logo.');
    }
    data = await uploadFunderLogo(funderId, logoFile);
  }

  if (letterLogoFile) {
    const funderId = String(data.id || '').trim();
    if (!funderId) {
      throw new Error('Funder id is required to upload a letter logo.');
    }
    data = await uploadFunderLetterLogo(funderId, letterLogoFile);
  }

  for (const [field, supplementalType] of Object.entries(SUPPLEMENTAL_UPLOAD_FIELDS)) {
    const supplementalFile = getUploadedSupplementalFile(req, field);
    if (!supplementalFile) continue;
    const funderId = String(data.id || '').trim();
    const funderName = String(data.name || '').trim();
    if (!funderId || !funderName) {
      throw new Error('Funder id and name are required to upload supplemental PDFs.');
    }
    await uploadFunderSupplementalPdf(
      funderId,
      funderName,
      supplementalType,
      supplementalFile,
    );
  }

  const disclosureFile = getUploadedSupplementalFile(req, 'disclosure');
  if (disclosureFile) {
    const funderId = String(data.id || '').trim();
    const disclosureState = String((req.body as Record<string, unknown>)?.disclosureState || 'texas').trim();
    const disclosureFrequency = String(
      (req.body as Record<string, unknown>)?.disclosureFrequency || 'daily',
    ).trim();
    if (!funderId) {
      throw new Error('Funder id is required to upload disclosure PDFs.');
    }
    await uploadFunderDisclosurePdf(
      funderId,
      disclosureState,
      disclosureFrequency,
      disclosureFile,
    );
  }

  return data;
}

export const listDocuSignProfiles = async (_req: Request, res: Response) => {
  try {
    const data = await listDocuSignAccountProfiles();
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

export const listDocuSignProfileOptions = async (_req: Request, res: Response) => {
  try {
    const data = await listDocuSignAccountProfileOptions();
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getDocuSignProfile = async (req: Request, res: Response) => {
  try {
    const data = await getDocuSignAccountProfileById(String(req.params.id));
    if (!data) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

export const createDocuSignProfile = async (req: Request, res: Response) => {
  try {
    const data = await createDocuSignAccountProfile(req.body || {});
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

export const updateDocuSignProfile = async (req: Request, res: Response) => {
  try {
    const data = await updateDocuSignAccountProfile(String(req.params.id), req.body || {});
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

export const removeDocuSignProfile = async (req: Request, res: Response) => {
  try {
    const data = await deleteDocuSignAccountProfile(String(req.params.id));
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

export const listFunders = async (req: Request, res: Response) => {
  try {
    const state = req.query.state ? String(req.query.state) : undefined;
    const activeOnly = req.query.activeOnly !== 'false';
    const data = await listFunderProfiles({ state, activeOnly });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * Tenant platform default CC + optional funder override (resolved).
 * Used by CRM + Super Admin tenant-proxy Contract/ACH send UI.
 */
/** SendGrid plan, remaining credits and today's send volume. `?refresh=1` skips the 60s cache. */
export const getSendGridUsage = async (req: Request, res: Response) => {
  try {
    const force = String(req.query?.refresh ?? '') === '1';
    const data = await getSendGridUsageSummary({ force });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getContractCcDefaults = async (req: Request, res: Response) => {
  try {
    const q = req.query || {};
    const funderName = q.funderName != null ? String(q.funderName) : undefined;
    const state =
      q.state != null
        ? String(q.state)
        : q.contractState != null
          ? String(q.contractState)
          : undefined;
    const funderProfileId =
      q.funderProfileId != null ? String(q.funderProfileId) : undefined;
    const contractIdRaw = q.contractId != null ? String(q.contractId).trim() : '';
    const contractIdNum = contractIdRaw ? Number(contractIdRaw) : NaN;
    const contractId =
      Number.isFinite(contractIdNum) && contractIdNum > 0 ? contractIdNum : undefined;

    const data = await resolveContractCcDefaultsForApi({
      funderName,
      state,
      funderProfileId,
      contractId,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getFunder = async (req: Request, res: Response) => {
  try {
    const data = await getFunderProfileById(String(req.params.id));
    if (!data) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

export const createFunder = async (req: Request, res: Response) => {
  try {
    const input = parseFunderProfileBody((req.body || {}) as Record<string, unknown>);
    const name = String(input.name ?? '').trim();
    if (!name) {
      return res.status(400).json({ success: false, message: 'Funder name is required.' });
    }
    const data = await saveFunderWithOptionalAssets(req, () =>
      createFunderProfile({ ...input, name }),
    );
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

/** SignNow template ids referenced by a funder's contract / addendum / disclosure links. */
function signNowTemplateIdsOnFunder(row: {
  signnowContractTemplateLink?: unknown;
  signnowAddendumTemplates?: unknown;
  signnowDisclosureTemplates?: unknown;
} | null): Set<string> {
  const out = new Set<string>();
  if (!row) return out;
  const add = (value: unknown) => {
    const id = extractSignNowTemplateId(String(value ?? ''));
    if (id) out.add(id);
  };
  add(row.signnowContractTemplateLink);
  for (const bucket of [row.signnowAddendumTemplates, row.signnowDisclosureTemplates]) {
    if (!Array.isArray(bucket)) continue;
    for (const item of bucket) {
      add((item as { link?: unknown })?.link);
    }
  }
  return out;
}

export const updateFunder = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const input = parseFunderProfileBody((req.body || {}) as Record<string, unknown>);
    const before = await prisma.funderProfile.findUnique({
      where: { id },
      select: {
        signnowContractTemplateLink: true,
        signnowAddendumTemplates: true,
        signnowDisclosureTemplates: true,
      },
    });
    const data = await saveFunderWithOptionalAssets(req, () =>
      updateFunderProfile(id, input),
    );
    // A repointed template link must not keep serving the previous template's
    // archived PDF, so drop the archive for ids this funder no longer uses.
    const previous = signNowTemplateIdsOnFunder(before);
    const current = signNowTemplateIdsOnFunder(data as never);
    for (const templateId of previous) {
      if (current.has(templateId)) continue;
      await invalidateStoredTemplatePdf(templateId);
    }
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * POST /integration-settings/funders/:id/share-templates
 *
 * Copies selected SignNow addendum / disclosure templates from this funder onto
 * other funders. Deliberately not routed through PATCH /funders/:id: that path
 * replaces a funder's whole template list from the client's view of it, which
 * would drop anything another admin added in the meantime. Here the server
 * merges against each target's live row instead.
 */
export const shareFunderTemplates = async (req: Request, res: Response) => {
  try {
    const sourceFunderId = String(req.params.id);
    const body = (req.body || {}) as Record<string, unknown>;

    const kind = body.kind;
    if (!isFunderTemplateKind(kind)) {
      return res
        .status(400)
        .json({ success: false, message: "kind must be 'addendum' or 'disclosure'." });
    }

    const templates = Array.isArray(body.templates) ? body.templates : [];
    const targetFunderIds = Array.isArray(body.targetFunderIds) ? body.targetFunderIds : [];
    if (!templates.length) {
      return res
        .status(400)
        .json({ success: false, message: `Select at least one ${kind} to share.` });
    }
    if (!targetFunderIds.length) {
      return res
        .status(400)
        .json({ success: false, message: 'Select at least one funder to share with.' });
    }

    const result = await shareFunderTemplatesService({
      sourceFunderId,
      kind,
      templates: templates as never,
      targetFunderIds: targetFunderIds.map((id) => String(id)),
    });

    return res.json({
      success: true,
      data: result,
      message: describeShareResult(result),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const removeFunder = async (req: Request, res: Response) => {
  try {
    const data = await deleteFunderProfile(String(req.params.id));
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

export const listFunderDocuments = async (req: Request, res: Response) => {
  try {
    const data = await listFunderDocumentTemplates(String(req.params.id));
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

export const uploadFunderDisclosure = async (req: Request, res: Response) => {
  try {
    const funderId = String(req.params.id || '').trim();
    const funder = await getFunderProfileById(funderId);
    if (!funder) return res.status(404).json({ success: false, message: 'Funder not found.' });

    const file = getUploadedSupplementalFile(req, 'file');
    if (!file) {
      return res.status(400).json({ success: false, message: 'PDF file is required (field: file).' });
    }

    const state = String((req.body as Record<string, unknown>)?.state || '').trim();
    const frequency = String((req.body as Record<string, unknown>)?.frequency || 'daily').trim();
    const dealTypeRaw = String((req.body as Record<string, unknown>)?.dealType || '')
      .trim()
      .toLowerCase();
    const dealType =
      dealTypeRaw === 'refi' || dealTypeRaw === 'norefi'
        ? (dealTypeRaw as 'refi' | 'norefi')
        : null;
    if (!state) {
      return res.status(400).json({ success: false, message: 'State is required.' });
    }

    const data = await uploadFunderDisclosurePdf(
      funderId,
      state,
      frequency,
      file,
      dealType,
    );
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

export const uploadFunderAddendum = async (req: Request, res: Response) => {
  try {
    const funderId = String(req.params.id || '').trim();
    const funder = await getFunderProfileById(funderId);
    if (!funder) return res.status(404).json({ success: false, message: 'Funder not found.' });

    const file = getUploadedSupplementalFile(req, 'file');
    if (!file) {
      return res.status(400).json({ success: false, message: 'PDF file is required (field: file).' });
    }

    const name = String((req.body as Record<string, unknown>)?.name || '').trim();
    const coordinateLayoutKey = String(
      (req.body as Record<string, unknown>)?.coordinateLayoutKey || '',
    ).trim();
    if (!name) {
      return res.status(400).json({ success: false, message: 'Addendum name is required.' });
    }
    if (!coordinateLayoutKey) {
      return res.status(400).json({
        success: false,
        message:
          'coordinateLayoutKey is required (addendum_p, addendum_ca, addendum_ny, addendum_va, ach_authorization).',
      });
    }

    const data = await uploadFunderNamedAddendumPdf(
      funderId,
      funder.name,
      name,
      coordinateLayoutKey,
      file,
    );
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

export const removeFunderDocument = async (req: Request, res: Response) => {
  try {
    const data = await deleteFunderDocumentTemplate(
      String(req.params.id),
      String(req.params.templateId),
    );
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};
