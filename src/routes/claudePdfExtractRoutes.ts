import express from "express";
import multer from "multer";
import { getClaudePdfExtractionService } from "../nestjs-claude-pdf/claude-pdf-extraction.context";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const router = express.Router();

router.post("/claude", upload.any(), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[] | undefined;
    const uploaded =
      files?.find((f) => f.fieldname === "pdf" || f.fieldname === "file") ?? files?.[0];

    if (!uploaded?.buffer?.length) {
      res.status(400).json({
        message:
          'Missing PDF file. Send multipart/form-data with field "pdf" or "file" containing the PDF.',
      });
      return;
    }

    const mime = (uploaded.mimetype || "").toLowerCase();
    const pdfish =
      mime === "application/pdf" ||
      mime === "application/x-pdf" ||
      mime === "binary/octet-stream" ||
      (uploaded.originalname || "").toLowerCase().endsWith(".pdf");
    if (!pdfish) {
      res.status(400).json({ message: "Upload must be a PDF." });
      return;
    }

    const svc = getClaudePdfExtractionService();
    const { result, meta } = await svc.extractHybridFromPdfBuffer(uploaded.buffer);
    res.status(200).json({ result, meta });
    return;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Claude PDF extraction failed";
    const lower = msg.toLowerCase();
    const status =
      lower.includes("anthropic_api_key") || lower.includes("required for claude") ? 503 : 500;
    res.status(status).json({ message: msg });
    return;
  }
});

export default router;
