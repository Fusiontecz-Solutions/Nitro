-- Persist reviewed KYC extractions on the application so DL / voided-check
-- values auto-fill owners, bank details, and later contract prefill.
ALTER TABLE "Application"
ADD COLUMN IF NOT EXISTS "kycPrefill" JSONB;

ALTER TABLE "ClientOwner"
ADD COLUMN IF NOT EXISTS "driverLicense" TEXT;
