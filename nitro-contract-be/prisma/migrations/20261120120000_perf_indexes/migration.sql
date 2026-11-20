-- Performance indexes for the hottest list / dashboard / cron queries.
--
-- * Application: list filters (client, sales rep), "recent" ordering by updatedAt,
--   OR [{currentState}, ...] bucket filters, and the default list shape
--   `deletedAt IS NULL ORDER BY createdAt DESC`.
-- * TermsOffer: "latest offer per application" lookups (ORDER BY createdAt DESC LIMIT 1).
-- * Document: SignNow status cron (every 5s) filters on status + sentAt / completedAt.
-- * ApplicationActivityLog: had no index at all, yet ops buckets filter through it
--   with `some { actionType ... }` and detail pages list it by applicationId.
--
-- All statements are idempotent (IF NOT EXISTS). Plain CREATE INDEX briefly blocks
-- writes to each table while it builds; on very large tables consider running
-- these with CREATE INDEX CONCURRENTLY by hand before deploying, then this
-- migration becomes a no-op.

CREATE INDEX IF NOT EXISTS "Application_clientId_idx" ON "Application"("clientId");
CREATE INDEX IF NOT EXISTS "Application_salesRepresentativeId_idx" ON "Application"("salesRepresentativeId");
CREATE INDEX IF NOT EXISTS "Application_updatedAt_idx" ON "Application"("updatedAt");
CREATE INDEX IF NOT EXISTS "Application_currentState_idx" ON "Application"("currentState");
CREATE INDEX IF NOT EXISTS "Application_deletedAt_createdAt_idx" ON "Application"("deletedAt", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "TermsOffer_applicationId_createdAt_idx" ON "TermsOffer"("applicationId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Document_status_sentAt_idx" ON "Document"("status", "sentAt");
CREATE INDEX IF NOT EXISTS "Document_status_completedAt_idx" ON "Document"("status", "completedAt");

-- ApplicationActivityLog is not created by any migration in this repo (it exists in
-- deployed databases from an earlier introspection), so guard on its existence.
DO $$
BEGIN
  IF to_regclass('public."ApplicationActivityLog"') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "ApplicationActivityLog_applicationId_createdAt_idx"
      ON "ApplicationActivityLog"("applicationId", "createdAt" DESC);
    CREATE INDEX IF NOT EXISTS "ApplicationActivityLog_applicationId_actionType_idx"
      ON "ApplicationActivityLog"("applicationId", "actionType");
  END IF;
END $$;
