-- Gate SignNow draft-group reuse on the values behind it, so an edited contract
-- rebuilds its documents instead of re-prefilling a group that still carries
-- previously baked page text.
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "prefillFingerprint" TEXT;

-- Persistent cache for SignNow template documents.
CREATE TABLE IF NOT EXISTS "SignNowTemplateCache" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "templateId" TEXT NOT NULL,
    "documentName" TEXT,
    "document" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignNowTemplateCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SignNowTemplateCache_templateId_key"
    ON "SignNowTemplateCache"("templateId");

CREATE INDEX IF NOT EXISTS "SignNowTemplateCache_fetchedAt_idx"
    ON "SignNowTemplateCache"("fetchedAt");

-- Distinguishes a CRM signing-portal (SendGrid) send from an in-progress owner review.
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "portalSentAt" TIMESTAMP(3);
