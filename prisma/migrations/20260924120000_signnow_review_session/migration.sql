-- Persist SignNow Owner review state per document group.
--
-- "Review finished" lived only in the contract modal's memory, so refreshing
-- the CRM, closing its tab or losing the session sent the user back to
-- "Review in SignNow" for a package they had already finished reviewing.
CREATE TABLE IF NOT EXISTS "SignNowReviewSession" (
    "id" UUID NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "fulfilledRoles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignNowReviewSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SignNowReviewSession_envelopeId_key" ON "SignNowReviewSession"("envelopeId");
CREATE INDEX IF NOT EXISTS "SignNowReviewSession_completedAt_idx" ON "SignNowReviewSession"("completedAt");
