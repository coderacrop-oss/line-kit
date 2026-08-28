-- Schema for the Postgres-backed Store (lib/store/postgresStore.ts), used automatically
-- once DATABASE_URL is set — see lib/store/index.ts. Run this once against a fresh
-- database:
--
--   psql "$DATABASE_URL" -f db/schema.sql
--
-- Every statement is guarded (IF NOT EXISTS), so it's safe to run again against a
-- database that already has these tables.
--
-- participant_id / inviter_id / joiner_id are LINE user ids (e.g. from
-- liff.getProfile().userId) — plain opaque strings, not UUIDs — and this standalone
-- template has no separate "participant" table to foreign-key against, so they're
-- stored as plain TEXT. pair_id / group_id are the only ids this store itself mints,
-- and are real server-generated UUIDs.

-- gen_random_uuid() has been a built-in SQL function since Postgres 13; pgcrypto is
-- only needed as a fallback on older servers, and this is a no-op if it's not.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- One row per participant who has submitted answers (solo mode never touches this —
-- it resolves in a single request with nothing to persist; this table exists purely
-- for the duo/group flows that need a participant's answers again later, e.g. once
-- their partner joins).
CREATE TABLE IF NOT EXISTS quiz_answers (
  participant_id TEXT PRIMARY KEY,
  answers        JSONB NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A completed duo pairing: both participants' scores, frozen at pairing time.
CREATE TABLE IF NOT EXISTS quiz_pairs (
  pair_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id  TEXT NOT NULL,
  joiner_id   TEXT NOT NULL,
  scores_a    JSONB NOT NULL,
  scores_b    JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A group, keyed by its creator. Membership lives in quiz_group_members below —
-- createGroup() inserts the creator's own row there too, same as fileStore.
CREATE TABLE IF NOT EXISTS quiz_groups (
  group_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per member of a group. Primary key (group_id, participant_id) is what makes
-- a duplicate join a no-op (ON CONFLICT DO NOTHING in joinGroup) instead of a second
-- row — the concurrency guard against double-counting the same participant twice.
-- joined_seq gives a stable, monotonic join order even when two joins land in the same
-- transaction-commit instant and joined_at (clock time) ties.
CREATE TABLE IF NOT EXISTS quiz_group_members (
  group_id       UUID NOT NULL REFERENCES quiz_groups(group_id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL,
  top_axis       TEXT NOT NULL,
  axis_scores    JSONB NOT NULL,
  joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  joined_seq     BIGSERIAL,
  PRIMARY KEY (group_id, participant_id)
);

CREATE INDEX IF NOT EXISTS quiz_group_members_group_id_idx ON quiz_group_members (group_id);
