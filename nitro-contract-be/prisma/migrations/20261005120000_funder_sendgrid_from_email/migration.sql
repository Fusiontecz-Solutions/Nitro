-- Per-funder verified SendGrid sender; NULL falls back to SENDGRID_FROM_EMAIL.
ALTER TABLE "FunderProfile" ADD COLUMN IF NOT EXISTS "sendgridFromEmail" TEXT;
