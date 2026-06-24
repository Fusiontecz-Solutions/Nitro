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
  type FunderProfileInput,
} from '../services/funderProfileService';

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

function parseAllowedStates(raw: unknown): string[] | undefined {
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

function parseFunderProfileBody(body: Record<string, unknown>): FunderProfileInput {
  const allowedStates = parseAllowedStates(body.allowedStates);
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

  const payload: FunderProfileInput = {
    name: String(body.name || '').trim(),
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
    contactEmail: body.contactEmail ? String(body.contactEmail).trim() : undefined,
    contactPhone: body.contactPhone ? String(body.contactPhone).trim() : undefined,
    addressLine1: body.addressLine1 ? String(body.addressLine1).trim() : undefined,
    addressCity: body.addressCity ? String(body.addressCity).trim() : undefined,
    addressState: body.addressState ? String(body.addressState).trim() : undefined,
    addressZip: body.addressZip ? String(body.addressZip).trim() : undefined,
    docusignAccountProfileId:
      body.docusignAccountProfileId === '' || body.docusignAccountProfileId == null
        ? null
        : String(body.docusignAccountProfileId),
    sortOrder:
      body.sortOrder != null && body.sortOrder !== ''
        ? Number(body.sortOrder)
        : undefined,
    isActive,
  };

  if (allowedStates !== undefined) {
    payload.allowedStates = allowedStates;
  }

  return payload;
}

async function saveFunderWithOptionalContract(
  req: Request,
  save: () => Promise<Awaited<ReturnType<typeof createFunderProfile>>>,
) {
  const contractFile = getUploadedContractFile(req);
  let data = await save();

  if (contractFile) {
    const funderId = String(data.id || '').trim();
    const funderName = String(data.name || '').trim();
    if (!funderId || !funderName) {
      throw new Error('Funder id and name are required to upload a contract.');
    }
    data = await uploadFunderContractPdf(funderId, funderName, contractFile);
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
    if (!input.name) {
      return res.status(400).json({ success: false, message: 'Funder name is required.' });
    }
    const data = await saveFunderWithOptionalContract(req, () => createFunderProfile(input));
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return handleError(res, error);
  }
};

export const updateFunder = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const input = parseFunderProfileBody((req.body || {}) as Record<string, unknown>);
    const data = await saveFunderWithOptionalContract(req, () =>
      updateFunderProfile(id, input),
    );
    return res.json({ success: true, data });
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
