-- What each SignNow widget showed when Review opened; Send keeps values edited in SignNow.
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "reviewWidgetValues" JSONB;
