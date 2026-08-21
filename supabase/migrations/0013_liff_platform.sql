-- 0013_liff_platform.sql
-- ทะเบียน LIFF ที่ต่อกับ LineKit + ที่เก็บข้อมูลทั่วไปของแต่ละ LIFF
-- ดู docs/superpowers/specs/2026-08-21-liff-platform-design.md §4 สำหรับเหตุผลของทุกคอลัมน์

CREATE TABLE liff_app (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT NOT NULL,
  liff_id                TEXT NOT NULL UNIQUE,
  line_login_channel_id  TEXT NOT NULL,
  channel_id             UUID NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  encrypted_api_key      BYTEA NOT NULL,
  api_key_last4          TEXT NOT NULL,
  key_version            INTEGER NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by             UUID REFERENCES app_user(id)
);

CREATE TABLE liff_session (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  liff_app_id    UUID NOT NULL REFERENCES liff_app(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  external_key   TEXT,
  data           JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX liff_session_app_participant_idx ON liff_session(liff_app_id, participant_id);
CREATE UNIQUE INDEX liff_session_app_external_key_key
  ON liff_session(liff_app_id, external_key) WHERE external_key IS NOT NULL;
