-- CONTRACTS_LOG takes over the existing Super Admin contract flow. SUPER_ADMIN
-- stays in the enum for the new Super Admin features, so nothing is dropped.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'CONTRACTS_LOG';
