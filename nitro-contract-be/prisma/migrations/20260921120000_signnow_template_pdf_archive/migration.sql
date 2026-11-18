-- Permanent Cloudinary archive for blank SignNow template PDFs.
--
-- Template previews ("Contract template" modal, addendum/disclosure picker) used
-- to download the PDF from SignNow on every in-process cache miss, which is cold
-- after each deploy and on every extra instance. One row per SignNow template id
-- makes the DB + Cloudinary the permanent source, so preview never calls SignNow
-- once the PDF has been archived.
CREATE TABLE IF NOT EXISTS "SignNowTemplatePdf" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "signnowTemplateId" TEXT NOT NULL,
    "originDocumentId" TEXT,
    "layoutKey" TEXT,
    "name" TEXT,
    "type" TEXT,
    "pdfUrl" TEXT NOT NULL,
    "pdfPublicId" TEXT,
    "byteSize" INTEGER,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignNowTemplatePdf_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SignNowTemplatePdf_signnowTemplateId_key"
    ON "SignNowTemplatePdf"("signnowTemplateId");

CREATE INDEX IF NOT EXISTS "SignNowTemplatePdf_layoutKey_idx"
    ON "SignNowTemplatePdf"("layoutKey");

CREATE INDEX IF NOT EXISTS "SignNowTemplatePdf_fetchedAt_idx"
    ON "SignNowTemplatePdf"("fetchedAt");
