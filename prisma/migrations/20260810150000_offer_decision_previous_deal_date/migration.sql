-- AlterTable
ALTER TABLE "OfferDecision" ADD COLUMN IF NOT EXISTS "PreviousDealDate" TIMESTAMPTZ(6);
