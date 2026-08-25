-- supabase/migrations/0015_quiz_group.sql

CREATE TABLE quiz_group (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id            UUID NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
  created_by             UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  locked_archetype_code  TEXT,
  locked_at              TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE quiz_group_member (
  group_id       UUID NOT NULL REFERENCES quiz_group(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  top_axis       TEXT NOT NULL,
  axis_scores    JSONB NOT NULL,
  joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, participant_id)
);
CREATE INDEX quiz_group_activity_idx ON quiz_group(activity_id);
CREATE INDEX quiz_group_member_participant_idx ON quiz_group_member(participant_id);
