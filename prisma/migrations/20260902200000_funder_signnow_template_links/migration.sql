-- SignNow template links on funder profiles (contract + addendums + disclosures)
ALTER TABLE "FunderProfile"
ADD COLUMN IF NOT EXISTS "signnowContractTemplateLink" TEXT,
ADD COLUMN IF NOT EXISTS "signnowAddendumTemplates" JSONB,
ADD COLUMN IF NOT EXISTS "signnowDisclosureTemplates" JSONB;
