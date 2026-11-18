-- Idempotent SignNow email group-invite tracking (one row per document group).
CREATE TABLE IF NOT EXISTS "SignNowInviteSend" (
    "id" UUID NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "applicationId" UUID,
    "contractId" INTEGER,
    "sendStatus" TEXT NOT NULL DEFAULT 'NOT_SENT',
    "inviteId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "requestId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignNowInviteSend_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SignNowInviteSend_envelopeId_key" ON "SignNowInviteSend"("envelopeId");
CREATE INDEX IF NOT EXISTS "SignNowInviteSend_applicationId_idx" ON "SignNowInviteSend"("applicationId");
CREATE INDEX IF NOT EXISTS "SignNowInviteSend_sendStatus_idx" ON "SignNowInviteSend"("sendStatus");
