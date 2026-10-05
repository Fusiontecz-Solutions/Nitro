-- Display name of the funder's verified SendGrid sender identity (paired with sendgridFromEmail).
ALTER TABLE "FunderProfile" ADD COLUMN IF NOT EXISTS "sendgridFromName" TEXT;
