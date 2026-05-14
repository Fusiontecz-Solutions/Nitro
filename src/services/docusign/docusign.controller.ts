import type { Request, Response } from "express";
import { DocusignService } from "./docusign.service";
import prisma from "../../config/prismaClient";

export const connectDocusign = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    const state = userId.toString();
    const authUrl = new DocusignService().getAuthUrl(state);

    return res.json({ authUrl });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

export const docusignCallback = async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).json({ message: "Missing code or state" });
    }

    const userId = state as string;

    const result = await new DocusignService().handleCallback(
      code as string,
      userId
    );

    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({
      message: error?.message || "DocuSign callback failed",
    });
  }
};


export const createDraftEnvelope = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    const {
      documentBase64,
      recipientEmail,
      applicationId,
      termsOffer,
      ccEmails,
      isResend
    } = req.body;

    console.log("documentBase64", documentBase64);
    console.log("recipientEmail", recipientEmail);
    console.log("applicationId", applicationId);
    console.log("termsOffer", termsOffer);
    console.log("ccEmails", ccEmails);
    console.log("isResend", isResend);

    if (!documentBase64 || !recipientEmail || !applicationId) {
      return res.status(400).json({
        message:
          "Missing required fields: documentBase64, recipientEmail, applicationId",
      });
    }

    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        client: true,
        termsOffers: true,
        OfferDecision: true,
        positions: true,
        FundingInfo: true,
      },
    });
    console.log("application", application);

    if (!application) {
      return res.status(404).json({
        message: "Application not found"
      });
    }

    let finalTermsOffer = termsOffer;

    if (!finalTermsOffer && application?.termsOffers?.length) {
      finalTermsOffer = application.termsOffers.at(-1);
    }

    if (!finalTermsOffer) {
      return res.status(400).json({
        message: "TermsOffer not found for this application",
      });
    }

    const state =
      application.client?.businessState ??
      application.client?.ownerState ??
      "";

    const result = await new DocusignService().createDraftEnvelope(
      userId,
      documentBase64,
      recipientEmail,
      state,
      application,
      finalTermsOffer,
      ccEmails || [],
      isResend || false
    );

    return res.json(result);
  } catch (error: any) {
    console.error("DocuSign createDraftEnvelope error:", error);

    return res.status(500).json({
      message: error?.message || "Failed to create draft envelope",
    });
  }
};

export const getSenderView = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    const { envelopeId, returnUrl } = req.body;

    if (!envelopeId || !returnUrl) {
      return res.status(400).json({
        message: "Missing required fields: envelopeId and returnUrl",
      });
    }

    const result = await new DocusignService().getSenderViewUrl(
      userId,
      envelopeId,
      returnUrl
    );

    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

export const sendEnvelope = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { envelopeId } = req.body;

    if (!envelopeId) {
      return res.status(400).json({
        message: "Missing required field: envelopeId",
      });
    }

    const result = await new DocusignService().sendEnvelope(userId, envelopeId);

    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

export const docusignWebhook = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;

    const expectedUsername = "info";
    const expectedPassword = "Test@#123";

    const expectedToken = Buffer.from(
      `${expectedUsername}:${expectedPassword}`
    ).toString("base64");

    if (!authHeader || !authHeader.startsWith("Basic ")) {
      return res.status(401).json({ message: "Missing basic auth header" });
    }

    const token = authHeader.split(" ")[1];

    if (token !== expectedToken) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    await new DocusignService().updateDocumentStatusFromWebhook(req.body);

    return res.send("OK");
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

export const getSignedPdf = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { envelopeId } = req.params;

    const pdfBuffer = await new DocusignService().fetchSignedDocumentPdf(
      userId,
      envelopeId
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="signed-document-${envelopeId}.pdf"`
    );

    return res.send(pdfBuffer);
  } catch (error: any) {
    return res.status(500).json({
      message: error.message || "Failed to fetch PDF",
    });
  }
};