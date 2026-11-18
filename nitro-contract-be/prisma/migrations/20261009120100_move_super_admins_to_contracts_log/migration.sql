-- Separate migration: a new enum value can't be used in the transaction that adds it.
-- Every current SUPER_ADMIN (including contracts@nitroadvance.com) moves to
-- CONTRACTS_LOG and keeps the same flow. Their sessions carry the old role in
-- the JWT, so they are cleared to force a fresh login. Safe to run more than once.
DELETE FROM "AccessToken"
WHERE "userId" IN (SELECT id FROM "User" WHERE role::text = 'SUPER_ADMIN');

UPDATE "User"
SET role = 'CONTRACTS_LOG'::"Role"
WHERE role::text = 'SUPER_ADMIN';
