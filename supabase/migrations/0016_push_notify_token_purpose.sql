-- supabase/migrations/0016_push_notify_token_purpose.sql

ALTER TABLE token_access_log DROP CONSTRAINT token_access_log_purpose_check;
ALTER TABLE token_access_log ADD CONSTRAINT token_access_log_purpose_check
  CHECK (purpose IN ('send_reply','publish','verify_signature','display_last4','test_send','fetch_bot_info','push_notify'));
