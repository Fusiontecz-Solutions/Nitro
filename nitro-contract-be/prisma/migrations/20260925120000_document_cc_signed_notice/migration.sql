-- Record when the signed-contract notice reached the CC list.
--
-- The completion notice emails the signed PDF to everyone CC'd at send time,
-- but nothing recorded whether that happened, so the application could not show
-- it. These columns back the "Signed copy sent to CC" checkbox.
ALTER TABLE "Document"
    ADD COLUMN IF NOT EXISTS "ccSignedNoticeSentAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "ccSignedNoticeEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
