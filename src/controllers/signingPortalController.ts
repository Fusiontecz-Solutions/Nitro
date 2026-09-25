import { Request, Response } from 'express';
import prisma from '../config/prismaClient';
import {
  advancePortalSigningQueue,
  mintPortalSigningLink,
  resolvePortalRecipients,
  sendContractViaPortal,
  syncPortalEnvelopeAfterSignerFinished,
  verifyPortalAccess,
} from '../services/signnow/signnow-portal-send.service';

function fail(res: Response, error: any) {
  const status = Number(error?.status) || 500;
  return res.status(status).json({
    success: false,
    message: error?.message || 'Signing portal request failed.',
  });
}

class SigningPortalController {
  /**
   * POST /docusign/send-contract-portal  (authenticated)
   * Emails each merchant signer a portal link via SendGrid instead of letting
   * SignNow send the invite.
   */
  async sendContractPortal(req: Request, res: Response) {
    try {
      const {
        envelopeId,
        roles,
        contractLabel,
        funderName,
        preparerEmail,
        replyToEmail,
        prefillFields,
        ccEmails,
        includeWireFee,
      } = req.body ?? {};
      const id = String(envelopeId ?? '').trim();
      if (!id) {
        return res.status(400).json({ success: false, message: 'envelopeId is required.' });
      }
      if (!Array.isArray(roles) || roles.length === 0) {
        return res.status(400).json({ success: false, message: 'roles is required.' });
      }
      const recipients = resolvePortalRecipients(roles, preparerEmail);
      if (!recipients.length) {
        return res.status(400).json({
          success: false,
          message: 'No merchant signer email to send to (the preparer is excluded).',
        });
      }
      const result = await sendContractViaPortal({
        envelopeId: id,
        recipients,
        contractLabel: String(contractLabel ?? '').trim() || 'Your funding agreement',
        funderName: typeof funderName === 'string' ? funderName.trim() : null,
        replyToEmail: typeof replyToEmail === 'string' ? replyToEmail.trim() : null,
        // Same payload `/send-envelope` receives, so the portal bakes the values
        // the CRM holds right now instead of whatever Owner review left behind.
        prefillFields: Array.isArray(prefillFields) ? prefillFields : undefined,
        roles,
        ccEmails: Array.isArray(ccEmails)
          ? ccEmails.map((v: unknown) => String(v ?? '').trim()).filter(Boolean)
          : undefined,
        // Live "$25 wire fee" checkbox; see `withRequestWireFeePreference`.
        includeWireFee,
      });
      return res.json({ success: true, data: result });
    } catch (error: any) {
      return fail(res, error);
    }
  }

  /**
   * GET /public/signing-portal/:envelopeId/summary?token=&email=
   * Minimal, non-sensitive context so the portal can render before signing.
   */
  async getSummary(req: Request, res: Response) {
    try {
      const envelopeId = String(req.params.envelopeId ?? '').trim();
      const email = String(req.query.email ?? '').trim();
      const token = String(req.query.token ?? '').trim();
      await verifyPortalAccess({ envelopeId, email, token });

      // Safety net for sequential signing: if the signer ahead of this one has
      // finished but the completion callback never arrived, hand the contract on.
      try {
        await advancePortalSigningQueue(envelopeId);
      } catch (queueError) {
        console.warn('[SignNow] portal queue advance on summary failed', queueError);
      }

      const document = await prisma.document.findUnique({
        where: { envelopeId },
        select: { status: true, sentAt: true, portalSentAt: true, applicationId: true },
      });
      const contract = document?.applicationId
        ? await prisma.contract.findFirst({
            where: { applicationId: document.applicationId },
            select: { customerName: true, legalName: true, funderName: true },
            orderBy: { updatedAt: 'desc' },
          })
        : null;

      return res.json({
        success: true,
        data: {
          envelopeId,
          email: email.toLowerCase(),
          status: document?.status ?? null,
          sentAt: document?.portalSentAt ?? document?.sentAt ?? null,
          merchantName: contract?.legalName || contract?.customerName || null,
          funderName: contract?.funderName || null,
        },
      });
    } catch (error: any) {
      return fail(res, error);
    }
  }

  /**
   * POST /public/signing-portal/:envelopeId/link
   * Body: { token, email } → a fresh SignNow embedded signing URL.
   * Minted on open, not at send time, so the session cannot expire in the inbox.
   */
  async createSigningLink(req: Request, res: Response) {
    try {
      const envelopeId = String(req.params.envelopeId ?? '').trim();
      const email = String(req.body?.email ?? '').trim();
      const token = String(req.body?.token ?? '').trim();
      const verified = await verifyPortalAccess({ envelopeId, email, token });
      const url = await mintPortalSigningLink({
        envelopeId: verified.envelopeId,
        signerEmail: verified.email,
      });
      return res.json({ success: true, data: { url } });
    } catch (error: any) {
      return fail(res, error);
    }
  }

  /**
   * POST /public/signing-portal/:envelopeId/completed
   * Called by the portal page when the signer finishes in the SignNow iframe.
   * Emails the next signer in order — SignNow is asked to confirm the current
   * signer really finished, so a spoofed call cannot skip anyone ahead. When
   * the last signer is done the CRM moves to Contract Signed right away.
   * Answered immediately: the sync waits out SignNow's settling delay in the
   * background and the portal page does not read the result.
   */
  async markCompleted(req: Request, res: Response) {
    try {
      const envelopeId = String(req.params.envelopeId ?? '').trim();
      const email = String(req.body?.email ?? '').trim();
      const token = String(req.body?.token ?? '').trim();
      const verified = await verifyPortalAccess({ envelopeId, email, token });
      void syncPortalEnvelopeAfterSignerFinished(verified.envelopeId)
        .then(({ queue, status }) =>
          console.info('[SignNow] portal finish synced', {
            envelopeId: verified.envelopeId,
            ...queue,
            status,
          }),
        )
        .catch((err) =>
          console.warn('[SignNow] portal finish sync failed', {
            envelopeId: verified.envelopeId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      return res.json({ success: true, data: { accepted: true } });
    } catch (error: any) {
      return fail(res, error);
    }
  }
}

export default new SigningPortalController();
