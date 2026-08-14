-- Flex System Builder · schema ตาม FLEX_AD_L2 v0.31 §5.2
-- ทั้ง 37 ตารางถูกสร้างพร้อมกันตั้งแต่ migration แรก (DEV-1) เพราะเพิ่มตารางทีหลังง่าย
-- แต่แก้ตารางที่มีข้อมูลแล้วยาก · constraint ที่บังคับได้ที่นี่ต้องบังคับที่นี่ (§5.5)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ══ กลุ่ม 5 · SYSTEM ══ (มาก่อนเพราะกลุ่มอื่นชี้มาหา)

CREATE TABLE app_user (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  google_sub    TEXT UNIQUE,
  test_line_uid TEXT,
  role          TEXT NOT NULL CHECK (role IN ('configurator','content_editor','reporter')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  invited_by    UUID REFERENCES app_user(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX app_user_is_active_idx ON app_user(is_active);

CREATE TABLE job_queue (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       TEXT NOT NULL,
  payload    JSONB NOT NULL DEFAULT '{}',
  run_after  TIMESTAMPTZ NOT NULL DEFAULT now(),
  status     TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','working','done','failed')),
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX job_queue_pickup_idx ON job_queue(status, run_after);
CREATE INDEX job_queue_kind_idx ON job_queue(kind);

-- ══ กลุ่ม 1 · CONFIG ══

CREATE TABLE campaign (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID,
  name                  TEXT NOT NULL,
  code                  TEXT NOT NULL UNIQUE
                          CHECK (code ~ '^[a-z0-9_]{1,20}$'),
  timezone              TEXT NOT NULL DEFAULT 'Asia/Bangkok',
  day_length_sec        INTEGER NOT NULL DEFAULT 86400 CHECK (day_length_sec >= 0),
  start_at              TIMESTAMPTZ NOT NULL,
  -- บังคับมี (BR-29) — เป็นจุดเริ่มนับของ campaign_stat และการลบข้อมูล
  end_at                TIMESTAMPTZ NOT NULL,
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed')),
  theme                 JSONB NOT NULL DEFAULT '{}',
  scheduled_publish_at  TIMESTAMPTZ,
  scheduled_channel_id  UUID,
  created_by            UUID NOT NULL REFERENCES app_user(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);
CREATE INDEX campaign_tenant_idx ON campaign(tenant_id);
CREATE INDEX campaign_status_idx ON campaign(status);
CREATE INDEX campaign_scheduled_idx ON campaign(scheduled_publish_at);

CREATE TABLE channel (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  default_card_id   UUID,
  greeting_card_id  UUID,
  greeting_enabled  BOOLEAN NOT NULL DEFAULT false,
  base_richmenu_id  UUID,
  set_default_menu  BOOLEAN NOT NULL DEFAULT false,
  channel_type      TEXT NOT NULL CHECK (channel_type IN ('preview','test','production')),
  -- UNIQUE เต็ม ไม่ใช่ partial (BR-68) — บัญชี LINE หนึ่งบัญชีมีได้แถวเดียวในระบบ
  line_channel_id   TEXT UNIQUE,
  encrypted_token   TEXT,
  encrypted_secret  TEXT,
  token_last4       TEXT,
  key_version       INTEGER,
  last_used_at      TIMESTAMPTZ,
  existing_keywords TEXT[] NOT NULL DEFAULT '{}',
  created_by        UUID NOT NULL REFERENCES app_user(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- ชั้น preview ไม่มีกุญแจ ชั้นอื่นต้องมี
  CHECK (
    (channel_type = 'preview' AND encrypted_token IS NULL AND encrypted_secret IS NULL)
    OR (channel_type <> 'preview' AND encrypted_token IS NOT NULL AND encrypted_secret IS NOT NULL)
  )
);
CREATE INDEX channel_type_idx ON channel(channel_type);

CREATE TABLE config_version (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  version_no    INTEGER NOT NULL,
  snapshot      JSONB NOT NULL,
  channel_id    UUID NOT NULL REFERENCES channel(id),
  published_by  UUID NOT NULL REFERENCES app_user(id),
  published_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, version_no)
);
CREATE INDEX config_version_published_idx ON config_version(published_at);

CREATE TABLE card (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  code             TEXT NOT NULL,
  render_as        TEXT NOT NULL DEFAULT 'flex_bubble'
                     CHECK (render_as IN ('flex_bubble','flex_carousel','imagemap','imagemap_video','text')),
  parent_card_id   UUID REFERENCES card(id) ON DELETE CASCADE,
  sort_in_parent   INTEGER,
  tap_areas        JSONB,
  video_asset_id   UUID,
  video_end_uri    TEXT,
  video_end_label  TEXT,
  template_code    TEXT,
  has_sample_text  BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, code)
);

CREATE TABLE activity (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       UUID NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  code              TEXT NOT NULL,
  name              TEXT NOT NULL,
  input_type        TEXT NOT NULL CHECK (input_type IN ('none','pick_one','quiz','text')),
  resolve_method    TEXT NOT NULL CHECK (resolve_method IN ('fixed','weighted','quota','score','lookup')),
  input_config      JSONB NOT NULL DEFAULT '{}',
  resolve_config    JSONB NOT NULL DEFAULT '{}',
  entry_rules       JSONB NOT NULL DEFAULT '[]',
  effects           JSONB NOT NULL DEFAULT '[]',
  fallback_card_id  UUID REFERENCES card(id),
  trigger           TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual','follow')),
  is_enabled        BOOLEAN NOT NULL DEFAULT true,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, code)
);
-- BR-90 · หนึ่งแคมเปญมีกิจกรรมทักทายได้ตัวเดียว
CREATE UNIQUE INDEX activity_one_follow_per_campaign
  ON activity(campaign_id) WHERE trigger = 'follow';

CREATE TABLE card_selector (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    UUID NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  returns        TEXT NOT NULL DEFAULT 'card' CHECK (returns IN ('card','asset','text')),
  source_type    TEXT NOT NULL
                   CHECK (source_type IN ('result','attribute','counter_level','campaign_day','campaign_round')),
  source_key     TEXT,
  -- บังคับมี (BR-27) — ค่าไม่ตรงทางเลือกใดต้องไม่หยุดทำงาน
  fallback_value TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE card_selector_option (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  selector_id  UUID NOT NULL REFERENCES card_selector(id) ON DELETE CASCADE,
  match_value  TEXT,
  range_min    INTEGER,
  range_max    INTEGER,
  result_value TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  -- จับคู่ตรงตัว หรือจับคู่ตามช่วง อย่างใดอย่างหนึ่ง
  CHECK (match_value IS NOT NULL OR range_min IS NOT NULL OR range_max IS NOT NULL)
);
CREATE INDEX card_selector_option_selector_idx ON card_selector_option(selector_id, sort_order);

CREATE TABLE card_block (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id     UUID NOT NULL REFERENCES card(id) ON DELETE CASCADE,
  block_type  TEXT NOT NULL CHECK (block_type IN (
                'image','title','body','caption','progress_bar','status_row',
                'stamp_grid','divider','spacer','button','video',
                'stamp_card','progress','reward_button')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  content     TEXT,
  selector_id UUID REFERENCES card_selector(id),
  show_when   JSONB,
  options     JSONB,
  -- ค่าคงที่ หรือเลือกจากสถานะ มีได้อย่างมากอย่างเดียว
  CHECK (NOT (content IS NOT NULL AND selector_id IS NOT NULL))
);
CREATE INDEX card_block_card_idx ON card_block(card_id, sort_order);

CREATE TABLE card_template (
  code             TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT,
  preview_asset_id UUID,
  blocks           JSONB NOT NULL,
  is_builtin       BOOLEAN NOT NULL DEFAULT false,
  sort_order       INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE card ADD CONSTRAINT card_template_code_fkey
  FOREIGN KEY (template_code) REFERENCES card_template(code);

CREATE TABLE activity_template (
  code            TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  -- เซ็ตแกน 1 และ 2 ให้ล่วงหน้า
  input_type      TEXT NOT NULL CHECK (input_type IN ('none','pick_one','quiz','text')),
  resolve_method  TEXT NOT NULL CHECK (resolve_method IN ('fixed','weighted','quota','score','lookup')),
  -- ตัวเลือก ผลลัพธ์ การ์ด และข้อความตัวอย่างพร้อมใช้
  payload         JSONB NOT NULL,
  is_builtin      BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE asset (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id        UUID NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  storage_path       TEXT NOT NULL UNIQUE,
  public_url         TEXT NOT NULL,
  media_type         TEXT NOT NULL DEFAULT 'image' CHECK (media_type IN ('image','video')),
  mime_type          TEXT NOT NULL,
  imagemap_base_url  TEXT,
  duration_sec       INTEGER CHECK (duration_sec IS NULL OR duration_sec <= 60),
  bytes              INTEGER NOT NULL,
  width              INTEGER NOT NULL,
  height             INTEGER NOT NULL,
  used_in            JSONB NOT NULL DEFAULT '[]',
  replaces_asset_id  UUID REFERENCES asset(id),
  uploaded_by        UUID NOT NULL REFERENCES app_user(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX asset_media_type_idx ON asset(media_type);
ALTER TABLE card ADD CONSTRAINT card_video_asset_fkey
  FOREIGN KEY (video_asset_id) REFERENCES asset(id);
ALTER TABLE card_template ADD CONSTRAINT card_template_preview_fkey
  FOREIGN KEY (preview_asset_id) REFERENCES asset(id);

CREATE TABLE counter (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id          UUID NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  code                 TEXT NOT NULL,
  name                 TEXT NOT NULL,
  mode                 TEXT NOT NULL CHECK (mode IN ('accumulate','daily_unique','distinct')),
  -- ย้ายมาจาก stamp_card ใน v0.22 — กติกาการนับไม่ควรอยู่ในชั้นแสดงผล
  require_consecutive  BOOLEAN NOT NULL DEFAULT false,
  target               INTEGER NOT NULL CHECK (target > 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, code)
);

CREATE TABLE counter_milestone (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  counter_id UUID NOT NULL REFERENCES counter(id) ON DELETE CASCADE,
  at_value   INTEGER NOT NULL CHECK (at_value > 0),
  effects    JSONB NOT NULL DEFAULT '[]',
  UNIQUE (counter_id, at_value)
);

CREATE TABLE reward (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  reward_type   TEXT NOT NULL CHECK (reward_type IN ('link','image','code','text')),
  value         TEXT,
  quota         INTEGER CHECK (quota IS NULL OR quota >= 0),
  -- เพิ่มในธุรกรรมเดียวกับการสร้าง entitlement · ห้ามอ่านแล้วเขียนกลับ
  issued_count  INTEGER NOT NULL DEFAULT 0 CHECK (issued_count >= 0),
  valid_days    INTEGER CHECK (valid_days IS NULL OR valid_days > 0),
  use_limit     INTEGER DEFAULT 1 CHECK (use_limit IS NULL OR use_limit > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, code),
  -- โควตาห้ามถูกแจกเกิน · บังคับที่ฐานข้อมูล ไม่ฝากไว้กับโค้ด
  CHECK (quota IS NULL OR issued_count <= quota)
);

CREATE TABLE coupon (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_id          UUID NOT NULL UNIQUE REFERENCES reward(id) ON DELETE CASCADE,
  discount_kind      TEXT NOT NULL CHECK (discount_kind IN ('percent','amount','free_item')),
  value_min          INTEGER NOT NULL,
  value_max          INTEGER NOT NULL,
  value_step         INTEGER NOT NULL DEFAULT 1 CHECK (value_step > 0),
  terms              TEXT,
  needs_shop_confirm BOOLEAN NOT NULL DEFAULT false,
  CHECK (value_max >= value_min)
);

CREATE TABLE stamp_card (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  counter_id       UUID NOT NULL UNIQUE REFERENCES counter(id) ON DELETE CASCADE,
  -- เพดานของการวาดช่อง ไม่ใช่ของการนับ (v0.22)
  slots            INTEGER NOT NULL CHECK (slots BETWEEN 1 AND 30),
  empty_asset_id   UUID NOT NULL REFERENCES asset(id),
  filled_asset_id  UUID NOT NULL REFERENCES asset(id),
  card_id          UUID NOT NULL REFERENCES card(id)
);

CREATE TABLE keyword_rule (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         UUID NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  -- เก็บในรูปที่ทำเป็นมาตรฐานแล้ว (BR-48)
  keyword             TEXT NOT NULL,
  match_mode          TEXT NOT NULL DEFAULT 'exact' CHECK (match_mode IN ('exact','contains')),
  target_activity_id  UUID REFERENCES activity(id) ON DELETE CASCADE,
  target_card_id      UUID REFERENCES card(id) ON DELETE CASCADE,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  UNIQUE (campaign_id, keyword),
  -- ต้องพาไปที่ใดที่หนึ่ง ไม่ใช่ตั้งไว้แล้วไม่ทำอะไร
  CHECK (target_activity_id IS NOT NULL OR target_card_id IS NOT NULL)
);
CREATE INDEX keyword_rule_campaign_idx ON keyword_rule(campaign_id, sort_order);

CREATE TABLE rich_menu (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id        UUID NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  alias              TEXT NOT NULL,
  image_asset_id     UUID NOT NULL REFERENCES asset(id),
  areas              JSONB NOT NULL DEFAULT '[]',
  is_entry           BOOLEAN NOT NULL DEFAULT false,
  line_rich_menu_id  TEXT,
  chat_bar_text      TEXT NOT NULL DEFAULT 'เมนู' CHECK (char_length(chat_bar_text) <= 14),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, alias)
);
-- BR-78 · แคมเปญที่ใช้เมนูต้องมีเมนูตัวเข้าพอดีหนึ่งอัน
CREATE UNIQUE INDEX rich_menu_one_entry_per_campaign
  ON rich_menu(campaign_id) WHERE is_entry = true;
ALTER TABLE channel ADD CONSTRAINT channel_base_richmenu_fkey
  FOREIGN KEY (base_richmenu_id) REFERENCES rich_menu(id);
ALTER TABLE channel ADD CONSTRAINT channel_default_card_fkey
  FOREIGN KEY (default_card_id) REFERENCES card(id);
ALTER TABLE channel ADD CONSTRAINT channel_greeting_card_fkey
  FOREIGN KEY (greeting_card_id) REFERENCES card(id);
ALTER TABLE campaign ADD CONSTRAINT campaign_scheduled_channel_fkey
  FOREIGN KEY (scheduled_channel_id) REFERENCES channel(id);

-- ══ กลุ่ม 2 · CONNECTION ══

CREATE TABLE campaign_channel (
  campaign_id        UUID NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  channel_id         UUID NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  is_published       BOOLEAN NOT NULL DEFAULT false,
  day_length_sec     INTEGER CHECK (day_length_sec IS NULL OR day_length_sec >= 0),
  uses_personal_menu BOOLEAN NOT NULL DEFAULT false,
  published_at       TIMESTAMPTZ,
  PRIMARY KEY (campaign_id, channel_id)
);
CREATE INDEX campaign_channel_published_idx ON campaign_channel(is_published);
-- BR-68 · OA หนึ่งบัญชีรันแคมเปญทีละหนึ่ง
CREATE UNIQUE INDEX campaign_channel_one_live_per_channel
  ON campaign_channel(channel_id) WHERE is_published = true;

CREATE TABLE campaign_channel_counter_target (
  campaign_id UUID NOT NULL,
  channel_id  UUID NOT NULL,
  counter_id  UUID NOT NULL REFERENCES counter(id) ON DELETE CASCADE,
  target      INTEGER NOT NULL CHECK (target > 0),
  PRIMARY KEY (campaign_id, channel_id, counter_id),
  FOREIGN KEY (campaign_id, channel_id) REFERENCES campaign_channel(campaign_id, channel_id) ON DELETE CASCADE
);

-- ══ กลุ่ม 3 · STATE ══

CREATE TABLE participant (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id     UUID NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  line_uid       TEXT NOT NULL,
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  anonymized_at  TIMESTAMPTZ,
  UNIQUE (channel_id, line_uid)
);
CREATE INDEX participant_last_seen_idx ON participant(last_seen_at);

CREATE TABLE participant_attribute (
  participant_id UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  campaign_id    UUID NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  key            TEXT NOT NULL,
  value          TEXT NOT NULL,
  PRIMARY KEY (participant_id, campaign_id, key)
);

CREATE TABLE counter_value (
  participant_id UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  counter_id     UUID NOT NULL REFERENCES counter(id) ON DELETE CASCADE,
  value          INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0),
  PRIMARY KEY (participant_id, counter_id)
);

CREATE TABLE entitlement (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id     UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  reward_id          UUID NOT NULL REFERENCES reward(id) ON DELETE CASCADE,
  config_version_id  UUID NOT NULL REFERENCES config_version(id),
  reward_code_id     UUID,
  status             TEXT NOT NULL DEFAULT 'granted' CHECK (status IN ('granted','redeemed')),
  granted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  redeemed_at        TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ,
  use_count          INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  awarded_value      JSONB,
  -- BR-07 · หนึ่งคนได้รางวัลหนึ่งตัวครั้งเดียว · บังคับที่ระดับ DB
  UNIQUE (participant_id, reward_id)
);
CREATE INDEX entitlement_status_idx ON entitlement(status);
CREATE INDEX entitlement_expires_idx ON entitlement(expires_at);

CREATE TABLE reward_code (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_id   UUID NOT NULL REFERENCES reward(id) ON DELETE CASCADE,
  code_value  TEXT NOT NULL,
  -- UNIQUE กันการจ่ายรหัสเดียวกันสองคน
  assigned_to UUID UNIQUE REFERENCES participant(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,
  UNIQUE (reward_id, code_value)
);
CREATE INDEX reward_code_free_idx ON reward_code(reward_id) WHERE assigned_to IS NULL;
ALTER TABLE entitlement ADD CONSTRAINT entitlement_reward_code_fkey
  FOREIGN KEY (reward_code_id) REFERENCES reward_code(id);

CREATE TABLE participant_activity (
  participant_id   UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  activity_id      UUID NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  play_count       INTEGER NOT NULL DEFAULT 1 CHECK (play_count >= 1),
  first_played_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_played_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  last_result      JSONB,
  PRIMARY KEY (participant_id, activity_id)
);
CREATE INDEX participant_activity_status_idx ON participant_activity(status);
CREATE INDEX participant_activity_last_played_idx ON participant_activity(last_played_at);

CREATE TABLE play_lock (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  activity_id    UUID NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
  period_key     TEXT NOT NULL,
  play_token     TEXT NOT NULL UNIQUE,
  result         JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- หัวใจของ idempotency (BR-32) — จองแถวนี้ได้คือได้สิทธิ์ตัดสิน
  UNIQUE (participant_id, activity_id, period_key)
);

CREATE TABLE quiz_round (
  participant_id UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  activity_id    UUID NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
  round_token    TEXT NOT NULL,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- คำตอบระหว่างทาง (BR-84) — ปลดเพดาน 6 ข้อของโหมดแชท
  answers        JSONB NOT NULL DEFAULT '[]',
  expires_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (participant_id, activity_id)
);
CREATE INDEX quiz_round_expires_idx ON quiz_round(expires_at);

CREATE TABLE pending_input (
  -- PK เป็น participant_id ตัวเดียว — โครงสร้างบังคับว่าซ้อนกันไม่ได้
  participant_id UUID PRIMARY KEY REFERENCES participant(id) ON DELETE CASCADE,
  activity_id    UUID NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
  expires_at     TIMESTAMPTZ NOT NULL
);
CREATE INDEX pending_input_expires_idx ON pending_input(expires_at);

-- ══ กลุ่ม 4 · LOG ══

CREATE TABLE event_log (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id     UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  activity_id        UUID REFERENCES activity(id) ON DELETE SET NULL,
  config_version_id  UUID NOT NULL REFERENCES config_version(id),
  event_type         TEXT NOT NULL,
  postback_data      TEXT CHECK (postback_data IS NULL OR char_length(postback_data) <= 300),
  answers            JSONB,
  result             JSONB,
  -- ตัวเดียวที่ใช้ตรวจ P95 ได้ · เก็บย้อนหลังไม่ได้
  duration_ms        INTEGER NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX event_log_participant_idx ON event_log(participant_id);
CREATE INDEX event_log_type_idx ON event_log(event_type);
CREATE INDEX event_log_created_idx ON event_log(created_at);

CREATE TABLE api_key (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  -- เก็บ hash ไม่เก็บค่าจริง · แสดงเต็มครั้งเดียวตอนสร้าง
  key_hash     TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL,
  revoked_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE effect_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id      UUID NOT NULL REFERENCES api_key(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  participant_id  UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  payload         JSONB NOT NULL,
  result          JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- เรียกซ้ำได้ผลเดิมโดยไม่ทำงานซ้ำ
  UNIQUE (api_key_id, idempotency_key)
);

CREATE TABLE token_access_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  UUID NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  actor_type  TEXT NOT NULL CHECK (actor_type IN ('user','system')),
  app_user_id UUID REFERENCES app_user(id),
  purpose     TEXT NOT NULL
                CHECK (purpose IN ('send_reply','publish','verify_signature','display_last4')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (actor_type = 'system' OR app_user_id IS NOT NULL)
);
CREATE INDEX token_access_log_channel_idx ON token_access_log(channel_id);

CREATE TABLE campaign_stat (
  campaign_id   UUID NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  channel_id    UUID NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  snapshot      JSONB NOT NULL,
  line_insight  JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, channel_id)
);

CREATE TABLE export_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  channel_id  UUID NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  app_user_id UUID NOT NULL REFERENCES app_user(id),
  dataset     TEXT NOT NULL,
  row_count   INTEGER NOT NULL CHECK (row_count >= 0),
  -- เพิ่มตอนลงมือ · ไฟล์ที่ออกไปแล้วต้องรู้ว่าออกไปเพราะอะไร และเติมทีหลังไม่ได้
  reason      TEXT NOT NULL CHECK (reason IN ('send_brand','audit','pdpa_request')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
