-- Local-dev only: 002_collab_visibility.sql calls gen_random_bytes(), which
-- lives in pgcrypto, but no migration file enables it. Not part of the
-- numbered migration sequence — this just unblocks a fresh local Postgres
-- init; it does not modify or replace any existing migration.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
