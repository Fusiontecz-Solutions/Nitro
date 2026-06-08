import type { Request, Response } from 'express';
import { DocusignService } from './docusign.service';
import { formatDocusignRouteError } from './utils/docusign-client';

const docusignService = new DocusignService();

export const getDocusignAuthStatus = async (_req: Request, res: Response) => {
  try {
    return res.json(docusignService.getConnectionStatus());
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || 'Failed to get DocuSign status' });
  }
};

/** JWT admin consent link (open in browser as impersonated DocuSign user). */
export const getDocusignConsentUrl = async (_req: Request, res: Response) => {
  try {
    const consentUrl = docusignService.getJwtConsentUrl();
    return res.json({
      consentUrl,
      redirectUriNote:
        'Add this redirect URI under Apps and Keys → Woodmere CRM → Additional settings → Redirect URIs: ' +
        'https://developers.docusign.com/platform/auth/consent',
      loginAsNote:
        'Sign in as the same user as DOCUSIGN_IMPERSONATED_USER_ID (your dev@ account) before approving.',
    });
  } catch (error: any) {
    return res.status(error.status || 500).json({ message: error?.message || 'Failed to build consent URL' });
  }
};

export const connectDocusign = async (req: Request, res: Response) => {
  try {
    const status = docusignService.getConnectionStatus();
    if (status.mode === 'jwt') {
      return res.json({
        authUrl: null,
        ...status,
        message: 'DocuSign is configured with server JWT. No user connection required.',
      });
    }
    const userId = (req as any).user.id;
    const authUrl = docusignService.getAuthUrl(userId);
    return res.json({ authUrl, ...status });
  } catch (error: any) {
    return res.status(error.status || 500).json({ message: error.message });
  }
};

export const docusignCallback = async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).json({ message: 'Missing code or state' });
    }
    const result = await docusignService.handleCallback(code as string, state as string);
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || 'DocuSign callback failed' });
  }
};

export const sendTemplate = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const {
      templateId,
      redirectUrl,
      title,
      message,
      roles,
      signerName,
      signerEmail,
      reminderSettings,
      prefillFields,
      ccEmails,
      applicationId,
      autoSend,
    } = req.body;

    if (!roles?.length && (!signerName || !signerEmail)) {
      return res.status(400).json({
        message: 'Missing required fields: provide roles array or signerName & signerEmail',
      });
    }

    const result = await docusignService.sendTemplate(userId, {
      templateId,
      redirectUrl,
      title,
      message,
      roles,
      signerName,
      signerEmail,
      reminderSettings,
      prefillFields,
      ccEmails: ccEmails || [],
      applicationId,
      autoSend: autoSend === false ? false : undefined,
    });

    return res.json(result);
  } catch (error: any) {
    return res.status(error.status || 500).json({
      message: error?.message || 'Failed to send template',
    });
  }
};

export const addRecipientsToTemplate = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { templateId, roles, title, message, ccEmails } = req.body;

    if (!templateId) {
      return res.status(400).json({ message: 'templateId is required' });
    }
    if (!roles?.length) {
      return res.status(400).json({ message: 'roles is required' });
    }

    const result = await docusignService.addRecipientsToTemplate(userId, {
      templateId,
      roles,
      title,
      message,
      ccEmails,
    });
    return res.json(result);
  } catch (error: any) {
    return res.status(error.status || 500).json({
      message: error?.message || 'Failed to add recipients to template',
    });
  }
};

export const getTemplateRecipients = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const templateId = req.query.templateId as string | undefined;
    const result = await docusignService.getTemplateRecipients(userId, templateId);
    return res.json(result);
  } catch (error: any) {
    return res.status(error.status || 500).json({
      message: error?.message || 'Failed to fetch template recipients',
    });
  }
};

export const prefillFormFields = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { documentId, fields } = req.body;

    if (!documentId) {
      return res.status(400).json({ message: 'Missing required field: documentId' });
    }
    if (!fields?.length) {
      return res.status(400).json({ message: 'fields must be a non-empty array' });
    }

    const result = await docusignService.prefillFormFields(userId, documentId, fields);
    return res.json(result);
  } catch (error: any) {
    return res.status(error.status || 500).json({
      message: error?.message || 'Failed to prefill form fields',
    });
  }
};

export const getEmbeddedRequestUrl = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { documentId, redirectUrl } = req.body;
    if (!documentId || !redirectUrl) {
      return res.status(400).json({ message: 'Missing documentId and redirectUrl' });
    }
    const result = await docusignService.getEmbeddedRequestUrl(userId, documentId, redirectUrl);
    return res.json(result);
  } catch (error: any) {
    return res.status(error.status || 500).json({ message: error.message });
  }
};

export const getEmbeddedSignLink = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { documentId, signerEmail, redirectUrl } = req.body;
    if (!documentId || !signerEmail || !redirectUrl) {
      return res.status(400).json({
        message: 'Missing documentId, signerEmail, or redirectUrl',
      });
    }
    const result = await docusignService.getEmbeddedSignLink(
      userId,
      documentId,
      signerEmail,
      redirectUrl,
    );
    return res.json(result);
  } catch (error: any) {
    return res.status(error.status || 500).json({ message: error.message });
  }
};

export const voidDocument = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { documentId, reason } = req.body;
    if (!documentId) {
      return res.status(400).json({ message: 'Missing documentId' });
    }
    const result = await docusignService.voidDocument(
      userId,
      documentId,
      reason || 'Voided by user',
    );
    return res.json(result);
  } catch (error: any) {
    return res.status(error.status || 500).json({ message: error.message });
  }
};

export const getDocumentProperties = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { documentId } = req.params;
    const result = await docusignService.getDocumentProperties(userId, documentId);
    return res.json(result);
  } catch (error: any) {
    return res.status(error.status || 500).json({ message: error.message });
  }
};

export const downloadPrefilledPdfByApplication = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { applicationId } = req.params;
    if (!applicationId?.trim()) {
      return res.status(400).json({ message: 'applicationId is required' });
    }
    const pdfBuffer = await docusignService.downloadDocumentPdfForApplication(
      userId,
      String(applicationId).trim(),
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="prefilled-contract-${String(applicationId).trim()}.pdf"`,
    );
    return res.send(pdfBuffer);
  } catch (error: any) {
    return res.status(error.status || 500).json({
      message: error.message || 'Failed to fetch prefilled PDF',
    });
  }
};

export const downloadTemplatePdf = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { templateId } = req.params;
    if (!templateId?.trim()) {
      return res.status(400).json({ message: 'templateId is required' });
    }
    const pdfBuffer = await docusignService.downloadTemplatePdf(
      userId,
      String(templateId).trim(),
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="template-${String(templateId).trim()}.pdf"`,
    );
    return res.send(pdfBuffer);
  } catch (error: any) {
    return res.status(error.status || 500).json({
      message: error.message || 'Failed to fetch template PDF',
    });
  }
};

export const downloadSignedPdf = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { documentId } = req.params;
    const pdfBuffer = await docusignService.downloadSignedPdf(userId, documentId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="signed-document-${documentId}.pdf"`,
    );
    return res.send(pdfBuffer);
  } catch (error: any) {
    return res.status(error.status || 500).json({
      message: error.message || 'Failed to fetch PDF',
    });
  }
};

export const getSignedPdf = downloadSignedPdf;

export const listDocuments = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    const result = await docusignService.listDocuments(userId, page, pageSize);
    return res.json(result);
  } catch (error: any) {
    return res.status(error.status || 500).json({ message: error.message });
  }
};

export const mergeAndSendTemplates = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const {
      templates,
      templateIds,
      contractTemplateFilters,
      roles,
      prefillFields,
      redirectUrl,
      applicationId,
      ccEmails,
      title,
      message,
      autoSend,
    } = req.body;

    const hasTemplates = Array.isArray(templates) && templates.length > 0;
    const hasTemplateIds = Array.isArray(templateIds) && templateIds.length > 0;
    const hasFilters =
      contractTemplateFilters &&
      typeof contractTemplateFilters === 'object' &&
      ['state', 'frequency', 'type'].some((k) => {
        const v = (contractTemplateFilters as Record<string, unknown>)[k];
        return v != null && String(v).trim() !== '';
      });

    if (!hasTemplates && !hasTemplateIds && !hasFilters) {
      return res.status(400).json({
        message:
          'Provide templateIds, templates, or contractTemplateFilters (state/frequency/type).',
      });
    }
    if (!roles?.length) {
      return res.status(400).json({ message: 'roles is required' });
    }

    const result = await docusignService.mergeAndSendTemplates(userId, {
      templates,
      templateIds,
      contractTemplateFilters,
      roles,
      prefillFields,
      redirectUrl,
      applicationId,
      ccEmails: ccEmails || [],
      title,
      message,
      autoSend: autoSend === false ? false : autoSend === true ? true : undefined,
    });

    return res.json(result);
  } catch (error: any) {
    return res.status(error.status || 500).json({
      message: error?.message || 'Failed to merge and send templates',
    });
  }
};

export const docusignWebhook = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization as string | undefined;
    if (!docusignService.verifyWebhookBasicAuth(authHeader)) {
      return res.status(401).json({ message: 'Invalid webhook credentials' });
    }

    res.send('OK');
    const rawBody =
      typeof req.body === 'string'
        ? req.body
        : req.body && typeof req.body === 'object'
          ? req.body
          : '';
    docusignService.processWebhookEvent(rawBody).catch((error) => {
      console.error('DocuSign webhook background error:', error);
    });
    return;
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

/** POST /docusign/sync-envelope-status — poll DocuSign when Connect did not fire. */
export const syncDocusignEnvelopeStatus = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { applicationId, envelopeId, ccEmails } = req.body || {};
    if (!applicationId && !envelopeId) {
      return res.status(400).json({
        message: 'applicationId or envelopeId is required',
      });
    }
    const result = await docusignService.syncEnvelopeStatusFromDocusign(userId, {
      applicationId,
      envelopeId,
      ccEmails: Array.isArray(ccEmails) ? ccEmails : undefined,
    });
    return res.json(result);
  } catch (error: any) {
    return res.status(error.status || 500).json({
      message: error?.message || 'Failed to sync envelope status',
    });
  }
};

/** Legacy endpoints */
export const createDraftEnvelope = async (req: Request, res: Response) => {
  return sendTemplate(req, res);
};

export const getSenderView = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { envelopeId, returnUrl, ccEmails, applicationId, signerEmail, signerName, roles } =
      req.body;
    if (!envelopeId || !returnUrl) {
      return res.status(400).json({ message: 'Missing envelopeId and returnUrl' });
    }
    const result = await docusignService.getSenderViewUrl(userId, envelopeId, returnUrl, {
      ccEmails: Array.isArray(ccEmails) ? ccEmails : undefined,
      applicationId: applicationId ? String(applicationId) : undefined,
      signerEmail: signerEmail ? String(signerEmail) : undefined,
      signerName: signerName ? String(signerName) : undefined,
      roles: Array.isArray(roles) ? roles : undefined,
    });
    return res.json(result);
  } catch (error: unknown) {
    const { status, message } = formatDocusignRouteError(error);
    console.error('[DocuSign] sender-view failed:', message);
    return res.status(status).json({ message });
  }
};

export const sendEnvelope = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { envelopeId, applicationId, ccEmails, title } = req.body;
    if (!envelopeId) {
      return res.status(400).json({ message: 'Missing envelopeId' });
    }
    const result = await docusignService.sendEnvelope(userId, String(envelopeId), {
      applicationId: applicationId ? String(applicationId) : undefined,
      ccEmails: Array.isArray(ccEmails) ? ccEmails : undefined,
      title: title ? String(title) : undefined,
    });
    return res.json(result);
  } catch (error: any) {
    return res.status(error.status || 500).json({ message: error.message });
  }
};

export const syncEnvelopeCc = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { envelopeId, ccEmails, applicationId, signerEmail, signerName, roles } =
      req.body;
    if (!envelopeId) {
      return res.status(400).json({ message: 'Missing envelopeId' });
    }
    const result = await docusignService.syncEnvelopeCcEmails(
      userId,
      String(envelopeId),
      Array.isArray(ccEmails) ? ccEmails : [],
      applicationId ? String(applicationId) : undefined,
      signerEmail ? String(signerEmail) : undefined,
      signerName ? String(signerName) : undefined,
      Array.isArray(roles) ? roles : undefined,
    );
    return res.json(result);
  } catch (error: any) {
    return res.status(error.status || 500).json({ message: error.message });
  }
};
