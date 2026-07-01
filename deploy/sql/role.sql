-- Least-privilege Postgres role for the MailHub portal (plan §3 invariant 4 /
-- §5.4). Run once, as a superuser/admin, against the *existing* shared
-- Postgres cluster the portal reuses. Creates a dedicated, non-superuser role
-- scoped to a single `mailhub` database — no access to any other database on
-- the cluster, no CREATEDB/CREATEROLE/replication/superuser.
--
-- Ownership of the `mailhub` database (rather than bare DML grants) is
-- deliberate: the portal runs Drizzle migrations itself at boot (see
-- portal/server/src/db/migrate.ts), including `CREATE TABLE`/`CREATE INDEX`
-- and `CREATE EXTENSION IF NOT EXISTS pg_trgm` — pg_trgm is a "trusted"
-- extension (PostgreSQL 13+), so a non-superuser with CREATE on the schema
-- can install it without any elevated privilege. Ownership is still scoped to
-- this one database only, so it satisfies "privileges only on the mailhub
-- database/public schema".
--
-- Replace the password below before running; this file ships with a
-- placeholder and must not be committed with a real one.

-- 1. Role: LOGIN only. Explicitly deny everything else a role can have.
CREATE ROLE mailhub WITH
  LOGIN
  PASSWORD 'CHANGE_ME'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS;

-- 2. Dedicated database, owned by the role. Ownership grants full DDL/DML
--    within this one database only — it does not grant access to any other
--    database on the cluster, nor the ability to create new databases/roles.
CREATE DATABASE mailhub OWNER mailhub;

-- 3. PostgreSQL grants CONNECT on every database to PUBLIC by default; revoke
--    it so only `mailhub` (and admins) can reach this database.
REVOKE ALL ON DATABASE mailhub FROM PUBLIC;
GRANT CONNECT, TEMP ON DATABASE mailhub TO mailhub;

-- 4. Explicit schema/table grants — redundant with ownership above (the
--    owner already has all of these), kept so this stays correct if this
--    database is ever repointed at a role that doesn't own it (e.g. a future
--    split between a migration role and a DML-only runtime role). Run while
--    connected to the `mailhub` database itself.
\connect mailhub
GRANT USAGE, CREATE ON SCHEMA public TO mailhub;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mailhub;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mailhub;
