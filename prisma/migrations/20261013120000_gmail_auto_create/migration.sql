-- Gmail PDF auto-create (ported from Katam).
--
-- * GmailAutoCreateLedger: durable idempotency ledger, one row per (user, Gmail
--   message) the cron has handled — success, skip or terminal failure — so a
--   message is never sent through Document AI twice.
-- * User.gmailAutoCreateEnabled / gmailAutoCreateEnabledAt: per-mailbox switch.
--   The cron only scans mail received after gmailAutoCreateEnabledAt.
--
-- Mailboxes already connected when this ships get gmailAutoCreateEnabledAt = now,
-- so deploying does not turn weeks of old inbox mail into deals in one sweep.

CREATE TABLE IF NOT EXISTS "GmailAutoCreateLedger" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "messageKey" TEXT NOT NULL,
    "pdfContentHash" TEXT,
    "applicationId" UUID,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmailAutoCreateLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GmailAutoCreateLedger_messageKey_key"
    ON "GmailAutoCreateLedger"("messageKey");

CREATE UNIQUE INDEX IF NOT EXISTS "GmailAutoCreateLedger_userId_gmailMessageId_key"
    ON "GmailAutoCreateLedger"("userId", "gmailMessageId");

CREATE INDEX IF NOT EXISTS "GmailAutoCreateLedger_userId_idx"
    ON "GmailAutoCreateLedger"("userId");

CREATE INDEX IF NOT EXISTS "GmailAutoCreateLedger_pdfContentHash_idx"
    ON "GmailAutoCreateLedger"("pdfContentHash");

CREATE INDEX IF NOT EXISTS "GmailAutoCreateLedger_createdAt_idx"
    ON "GmailAutoCreateLedger"("createdAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'GmailAutoCreateLedger_userId_fkey'
    ) THEN
        ALTER TABLE "GmailAutoCreateLedger"
            ADD CONSTRAINT "GmailAutoCreateLedger_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'GmailAutoCreateLedger_applicationId_fkey'
    ) THEN
        ALTER TABLE "GmailAutoCreateLedger"
            ADD CONSTRAINT "GmailAutoCreateLedger_applicationId_fkey"
            FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "gmailAutoCreateEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "gmailAutoCreateEnabledAt" TIMESTAMP(3);

UPDATE "User"
SET "gmailAutoCreateEnabledAt" = CURRENT_TIMESTAMP
WHERE "googleRefreshToken" IS NOT NULL
  AND "gmailAutoCreateEnabledAt" IS NULL;
