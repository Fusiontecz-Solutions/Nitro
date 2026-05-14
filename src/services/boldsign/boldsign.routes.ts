import { Router } from 'express';
import { authenticateToken } from '../../middleware/authMiddleware';
import {
  connectBoldSign,
  boldSignCallback,
  // sendDocument,
  sendDocumentForSigning,
  sendTemplate,
  addRecipientsToTemplate,
  prefillFormFields,
  getEmbeddedRequestUrl,
  getEmbeddedSignLink,
  voidDocument,
  getDocumentProperties,
  downloadSignedPdf,
  downloadPrefilledPdfByApplication,
  downloadTemplatePdf,
  listDocuments,
  boldSignWebhook,
  mergeAndSendTemplates,
  getTemplateRecipients,

} from './boldsign.controller';

const router = Router();

// ─── OAuth ────────────────────────────────────────────────────────────────────
/** Initiate BoldSign OAuth flow */
router.get('/connect', authenticateToken, connectBoldSign);

/** BoldSign OAuth callback (BoldSign redirects here after consent) */
router.get('/callback', boldSignCallback);

// ─── Document operations ──────────────────────────────────────────────────────
/** Send a document for e-signing */
// router.post('/send-document', authenticateToken, sendDocument);

/** Send a document for signing with signer form-fields & API-key auth */
router.post('/send-document', authenticateToken, sendDocumentForSigning);

/** Send a document using a BoldSign template */
router.post('/send-template', authenticateToken, sendTemplate);
/** Add recipients (role/name/email) to a template and send */
router.post('/add-template-recipients', authenticateToken, addRecipientsToTemplate);
/** Get recipients configured on a template */
router.get('/template/recipients', authenticateToken, getTemplateRecipients);

/** Prefill form fields on an in-progress document */
router.patch('/prefill-fields', authenticateToken, prefillFormFields);

/** Merge multiple templates and send (optional prefill) then create embedded URL */
router.post('/merge-and-send', authenticateToken, mergeAndSendTemplates);

/** Get embedded sender-review URL (to preview before sending) */
router.post('/embedded-request-url', authenticateToken, getEmbeddedRequestUrl);

/** Get embedded signing link for a signer */
router.post('/embedded-sign-link', authenticateToken, getEmbeddedSignLink);

/** Void / revoke a document */
router.post('/void-document', authenticateToken, voidDocument);

/** Get document status / properties */
router.get('/document-properties/:documentId', authenticateToken, getDocumentProperties);

/** Prefilled / draft BoldSign PDF for an application (resolves linked `Document.envelopeId`) */
router.get(
  '/prefilled-pdf/application/:applicationId',
  authenticateToken,
  downloadPrefilledPdfByApplication,
);

/** Download a BoldSign template PDF (for preview in the contract UI) */
router.get('/template/:templateId/download', authenticateToken, downloadTemplatePdf);

/** Download the signed PDF */
router.get('/download/:documentId', authenticateToken, downloadSignedPdf);

/** List all documents (paginated) */
router.get('/list', authenticateToken, listDocuments);

// ─── Webhook (no auth middleware – BoldSign calls this) ───────────────────────
router.post('/webhook', boldSignWebhook);

export default router;
