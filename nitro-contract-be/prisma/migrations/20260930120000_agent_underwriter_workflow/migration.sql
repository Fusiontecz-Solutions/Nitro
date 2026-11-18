-- Agent / Underwriter workflow.
--
-- Agents connect their own Gmail mailbox and send the ISO approval request from
-- it. Each deal keeps one Gmail thread per workflow purpose so a resend (or an
-- updated offer) replies on the same chain and ISO replies stay attached to the
-- deal.
ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "googleEmail" TEXT,
    ADD COLUMN IF NOT EXISTS "googleConnectedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ApplicationEmailThread" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "purpose" VARCHAR(32) NOT NULL,
    "ownerUserId" UUID,
    "mailboxEmail" TEXT,
    "gmailThreadId" TEXT NOT NULL,
    "lastMessageId" TEXT,
    "references" TEXT,
    "subject" TEXT,
    "counterpartEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApplicationEmailThread_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApplicationEmailThread_applicationId_purpose_key"
    ON "ApplicationEmailThread"("applicationId", "purpose");
CREATE INDEX IF NOT EXISTS "ApplicationEmailThread_gmailThreadId_idx"
    ON "ApplicationEmailThread"("gmailThreadId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ApplicationEmailThread_applicationId_fkey'
    ) THEN
        ALTER TABLE "ApplicationEmailThread"
            ADD CONSTRAINT "ApplicationEmailThread_applicationId_fkey"
            FOREIGN KEY ("applicationId") REFERENCES "Application"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ApplicationEmailThread_ownerUserId_fkey'
    ) THEN
        ALTER TABLE "ApplicationEmailThread"
            ADD CONSTRAINT "ApplicationEmailThread_ownerUserId_fkey"
            FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
