-- Agent email entered in the contract send panel. The agent gets the contract
-- package when it is sent and the signed copy when every signer has finished.
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "agentEmail" TEXT;
