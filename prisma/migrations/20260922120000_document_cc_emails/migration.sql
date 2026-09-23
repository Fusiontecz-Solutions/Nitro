-- Remember who was CC'd when a contract envelope was sent.
--
-- The CC list arrived in the send request body and was used once, to email the
-- unsigned package, then discarded. When every signer finished there was no way
-- to reach those same people with the signed copy. Storing the list on the
-- envelope row makes the completion notice able to copy them.
ALTER TABLE "Document"
    ADD COLUMN IF NOT EXISTS "ccEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
