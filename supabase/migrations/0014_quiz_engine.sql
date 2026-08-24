-- supabase/migrations/0014_quiz_engine.sql

ALTER TABLE activity DROP CONSTRAINT activity_input_type_check;
ALTER TABLE activity ADD CONSTRAINT activity_input_type_check
  CHECK (input_type IN ('none','pick_one','quiz','text','personality_quiz'));

ALTER TABLE activity ALTER COLUMN resolve_method DROP NOT NULL;
ALTER TABLE activity DROP CONSTRAINT activity_resolve_method_check;
ALTER TABLE activity ADD CONSTRAINT activity_resolve_method_check
  CHECK (
    (input_type = 'personality_quiz' AND resolve_method IS NULL)
    OR (input_type <> 'personality_quiz' AND resolve_method IN ('fixed','weighted','quota','score','lookup'))
  );

CREATE TABLE quiz_answer (
  activity_id    UUID NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  question_id    TEXT NOT NULL,
  option_id      TEXT NOT NULL,
  answered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, participant_id, question_id)
);

CREATE TABLE quiz_pair (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id    UUID NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
  participant_a  UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  participant_b  UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  result_code    TEXT NOT NULL,
  scores         JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT no_self_pair CHECK (participant_a <> participant_b),
  UNIQUE (activity_id, participant_a, participant_b)
);
CREATE INDEX quiz_pair_participant_a_idx ON quiz_pair(participant_a);
CREATE INDEX quiz_pair_participant_b_idx ON quiz_pair(participant_b);
