-- Email / letter / contract templates for the Gmail workspace (same shape as Katan's PaymentTemplate).
DO $$ BEGIN
  CREATE TYPE "PaymentTemplateType" AS ENUM ('contract', 'email', 'letter');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PaymentTemplate" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" "PaymentTemplateType" NOT NULL,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PaymentTemplate_category_idx" ON "PaymentTemplate"("category");
CREATE INDEX IF NOT EXISTS "PaymentTemplate_createdById_idx" ON "PaymentTemplate"("createdById");
CREATE INDEX IF NOT EXISTS "PaymentTemplate_updatedAt_idx" ON "PaymentTemplate"("updatedAt");

DO $$ BEGIN
  ALTER TABLE "PaymentTemplate"
    ADD CONSTRAINT "PaymentTemplate_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
