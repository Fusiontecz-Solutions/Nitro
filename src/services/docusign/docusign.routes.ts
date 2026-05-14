import { Router } from "express";
import {
  connectDocusign,
  docusignCallback,
  createDraftEnvelope,
  getSenderView,
  sendEnvelope,
  docusignWebhook,
  getSignedPdf,
} from "./docusign.controller";

import { authenticateToken } from "../../middleware/authMiddleware";

const router = Router();

/**
 * OAuth connect
 */
router.get("/connect", authenticateToken, connectDocusign);

/**
 * OAuth callback (DocuSign redirects here)
 */
router.get("/callback", docusignCallback);

/**
 * Create draft envelope
 */
router.post("/create-draft-envelope", authenticateToken, createDraftEnvelope);

/**
 * Open DocuSign sender editor
 */
router.post("/sender-view", authenticateToken, getSenderView);

/**
 * Send envelope
 */
router.post("/send-envelope", authenticateToken, sendEnvelope);

/**
 * DocuSign webhook
 */
router.post("/webhook", docusignWebhook);

/**
 * Download signed PDF
 */
router.get("/signed-pdf/:envelopeId", authenticateToken, getSignedPdf);

export default router;