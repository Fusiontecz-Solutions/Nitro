-- Funder-wise Gmail sending.
--
-- * FunderMailbox: one Google mailbox per funder, connected through the shared
--   Google OAuth client. The refresh token is stored AES-256-GCM encrypted
--   (`enc:v1:` prefix, src/utils/fieldEncryption.ts) — never in plain text.
-- * FunderProfile.mailProvider: 'sendgrid' (default, unchanged behaviour) or
--   'gmail'. Every existing funder stays on SendGrid; Gmail is opted into per
--   funder from Settings → Funders once its mailbox is verified.
-- * ApplicationEmailThread: a deal thread can now be owned by a funder mailbox,
--   and a chain can continue over SendGrid (headers only, no Gmail thread id).
-- * MailSendClaim: durable idempotency ledger, one row per physical email.
--   outbound_communications rows are per user action (one approval row covers
--   several recipients), so the unique key lives here and links back to it.
-- * User.googleOAuthClientId: which OAuth client minted the user's refresh token,
--   so a client switch is detected as "reconnect needed" instead of failing sends.
--
-- Additive only: no column is dropped or rewritten. Existing User refresh
-- tokens are encrypted by `npm run encrypt:gmail-tokens` (not by this SQL — the
-- key lives in the app environment) and are also re-encrypted lazily on read.

ALTER TABLE "FunderProfile"
    ADD COLUMN IF NOT EXISTS "mailProvider" TEXT NOT NULL DEFAULT 'sendgrid';

ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "googleOAuthClientId" TEXT;

CREATE TABLE IF NOT EXISTS "FunderMailbox" (
    "id" UUID NOT NULL,
    "funderProfileId" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'gmail',
    "email" TEXT,
    "sendAsEmail" TEXT,
    "refreshTokenEnc" TEXT,
    "oauthClientId" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "verifiedAt" TIMESTAMP(3),
    "connectedById" UUID,
    "connectedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FunderMailbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FunderMailbox_funderProfileId_key"
    ON "FunderMailbox"("funderProfileId");
CREATE INDEX IF NOT EXISTS "FunderMailbox_email_idx" ON "FunderMailbox"("email");
CREATE INDEX IF NOT EXISTS "FunderMailbox_status_idx" ON "FunderMailbox"("status");

ALTER TABLE "ApplicationEmailThread"
    ADD COLUMN IF NOT EXISTS "ownerFunderMailboxId" UUID,
    ADD COLUMN IF NOT EXISTS "lastProvider" TEXT;
-- A chain started over SendGrid has Message-IDs but no Gmail thread id.
ALTER TABLE "ApplicationEmailThread" ALTER COLUMN "gmailThreadId" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "ApplicationEmailThread_ownerFunderMailboxId_idx"
    ON "ApplicationEmailThread"("ownerFunderMailboxId");

CREATE TABLE IF NOT EXISTS "MailSendClaim" (
    "id" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'sending',
    "provider" TEXT,
    "applicationId" UUID,
    "outboundCommunicationId" UUID,
    "funderProfileId" UUID,
    "mailboxEmail" TEXT,
    "recipient" TEXT,
    "subject" TEXT,
    "providerMessageId" TEXT,
    "gmailThreadId" TEXT,
    "rfcMessageId" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MailSendClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MailSendClaim_idempotencyKey_key"
    ON "MailSendClaim"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "MailSendClaim_applicationId_idx" ON "MailSendClaim"("applicationId");
CREATE INDEX IF NOT EXISTS "MailSendClaim_outboundCommunicationId_idx"
    ON "MailSendClaim"("outboundCommunicationId");
CREATE INDEX IF NOT EXISTS "MailSendClaim_state_createdAt_idx" ON "MailSendClaim"("state", "createdAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FunderMailbox_funderProfileId_fkey') THEN
        ALTER TABLE "FunderMailbox"
            ADD CONSTRAINT "FunderMailbox_funderProfileId_fkey"
            FOREIGN KEY ("funderProfileId") REFERENCES "FunderProfile"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FunderMailbox_connectedById_fkey') THEN
        ALTER TABLE "FunderMailbox"
            ADD CONSTRAINT "FunderMailbox_connectedById_fkey"
            FOREIGN KEY ("connectedById") REFERENCES "User"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ApplicationEmailThread_ownerFunderMailboxId_fkey'
    ) THEN
        ALTER TABLE "ApplicationEmailThread"
            ADD CONSTRAINT "ApplicationEmailThread_ownerFunderMailboxId_fkey"
            FOREIGN KEY ("ownerFunderMailboxId") REFERENCES "FunderMailbox"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MailSendClaim_applicationId_fkey') THEN
        ALTER TABLE "MailSendClaim"
            ADD CONSTRAINT "MailSendClaim_applicationId_fkey"
            FOREIGN KEY ("applicationId") REFERENCES "Application"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
