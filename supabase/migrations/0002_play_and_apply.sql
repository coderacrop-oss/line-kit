-- ธุรกรรมเดียวที่ปิดงานของการเล่นหนึ่งครั้ง
--
-- TypeScript ตัดสินมาแล้วว่าอยากได้ผลลัพธ์ไหนเรียงตามลำดับความชอบ พร้อม effect
-- ของแต่ละตัว · หน้าที่ของฟังก์ชันนี้คือ "หยิบตัวแรกที่โควตายังเหลือจริง" ซึ่งเป็น
-- งานที่ต้องกันการแข่งกัน · ไม่มีตรรกะธุรกิจอยู่ที่นี่เลย
--
-- p_ranked: [{ "id": "...", "card_id": "uuid", "effects": [ ... ] }, ...]
--   effect รูปแบบ { "type": "set_attribute", "key": ..., "value": ... }
--                 { "type": "add_units", "counter_code": ..., "amount": n }
--                 { "type": "grant_reward", "reward_code": ... }

CREATE OR REPLACE FUNCTION play_and_apply(
  p_participant        UUID,
  p_activity           UUID,
  p_campaign           UUID,
  p_period_key         TEXT,
  p_play_token         TEXT,
  p_config_version     UUID,
  p_ranked             JSONB,
  p_completes_activity BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  v_existing     JSONB;
  v_candidate    JSONB;
  v_effect       JSONB;
  v_reward       reward;
  v_reward_code  reward_code;
  v_counter      counter;
  v_new_value    INTEGER;
  v_milestone    counter_milestone;
  v_chosen       JSONB := NULL;
  v_granted      JSONB := '[]'::JSONB;
  v_result       JSONB;
BEGIN
  -- ── จองสิทธิ์ตัดสิน ────────────────────────────────────────────────
  -- ชนะการจองคือได้สิทธิ์ · แพ้คือมีคนตัดสินไปแล้ว ต้องคืนผลเดิม (BR-32)
  INSERT INTO play_lock (participant_id, activity_id, period_key, play_token, result)
  VALUES (p_participant, p_activity, p_period_key, p_play_token, '{}'::JSONB)
  ON CONFLICT (participant_id, activity_id, period_key) DO NOTHING;

  IF NOT FOUND THEN
    SELECT result INTO v_existing
      FROM play_lock
     WHERE participant_id = p_participant
       AND activity_id = p_activity
       AND period_key = p_period_key;
    RETURN jsonb_build_object('replayed', true, 'result', v_existing);
  END IF;

  -- ── หยิบผลลัพธ์ตัวแรกที่โควตายังเหลือ ──────────────────────────────
  FOR v_candidate IN SELECT * FROM jsonb_array_elements(p_ranked) LOOP
    v_chosen := v_candidate;

    FOR v_effect IN SELECT * FROM jsonb_array_elements(v_candidate->'effects') LOOP
      CONTINUE WHEN v_effect->>'type' <> 'grant_reward';

      -- FOR UPDATE คือสิ่งที่กันการแจกเกินโควตาเมื่อคนกดพร้อมกัน
      SELECT * INTO v_reward FROM reward
       WHERE campaign_id = p_campaign AND code = v_effect->>'reward_code'
       FOR UPDATE;

      IF NOT FOUND OR (v_reward.quota IS NOT NULL AND v_reward.issued_count >= v_reward.quota) THEN
        v_chosen := NULL;
        EXIT;
      END IF;
    END LOOP;

    EXIT WHEN v_chosen IS NOT NULL;
  END LOOP;

  IF v_chosen IS NULL THEN
    -- ทุกตัวหมด · ผู้เรียกใช้การ์ดสำรองตาม BR-31
    DELETE FROM play_lock
     WHERE participant_id = p_participant AND activity_id = p_activity AND period_key = p_period_key;
    RETURN jsonb_build_object('replayed', false, 'exhausted', true);
  END IF;

  -- ── ลง effect ของตัวที่หยิบได้ ──────────────────────────────────────
  FOR v_effect IN SELECT * FROM jsonb_array_elements(v_chosen->'effects') LOOP

    IF v_effect->>'type' = 'set_attribute' THEN
      INSERT INTO participant_attribute (participant_id, campaign_id, key, value)
      VALUES (p_participant, p_campaign, v_effect->>'key', v_effect->>'value')
      ON CONFLICT (participant_id, campaign_id, key) DO UPDATE SET value = EXCLUDED.value;

    ELSIF v_effect->>'type' = 'add_units' THEN
      SELECT * INTO v_counter FROM counter
       WHERE campaign_id = p_campaign AND code = v_effect->>'counter_code';
      CONTINUE WHEN NOT FOUND;

      -- คำสั่งเดียว ห้ามอ่านแล้วเขียนกลับ
      INSERT INTO counter_value (participant_id, counter_id, value)
      VALUES (p_participant, v_counter.id, (v_effect->>'amount')::INTEGER)
      ON CONFLICT (participant_id, counter_id)
        DO UPDATE SET value = counter_value.value + (v_effect->>'amount')::INTEGER
      RETURNING value INTO v_new_value;

      -- จุดปลดล็อกตรวจทันทีในรอบเดียวกับการตอบ ไม่ใช่เข้าคิว
      FOR v_milestone IN
        SELECT * FROM counter_milestone
         WHERE counter_id = v_counter.id
           AND at_value <= v_new_value
           AND at_value > v_new_value - (v_effect->>'amount')::INTEGER
         ORDER BY at_value
      LOOP
        v_granted := v_granted || jsonb_build_object(
          'milestone', v_milestone.at_value, 'effects', v_milestone.effects);
      END LOOP;

    ELSIF v_effect->>'type' = 'grant_reward' THEN
      SELECT * INTO v_reward FROM reward
       WHERE campaign_id = p_campaign AND code = v_effect->>'reward_code'
       FOR UPDATE;

      v_reward_code := NULL;
      IF v_reward.reward_type = 'code' THEN
        SELECT * INTO v_reward_code FROM reward_code
         WHERE reward_id = v_reward.id AND assigned_to IS NULL
         ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED;
      END IF;

      INSERT INTO entitlement (
        participant_id, reward_id, config_version_id, reward_code_id, expires_at)
      VALUES (
        p_participant, v_reward.id, p_config_version, v_reward_code.id,
        CASE WHEN v_reward.valid_days IS NULL THEN NULL
             ELSE now() + (v_reward.valid_days || ' days')::INTERVAL END)
      ON CONFLICT (participant_id, reward_id) DO NOTHING;

      -- ตัดโควตาเฉพาะเมื่อออกสิทธิ์ใหม่จริง · BR-07 ให้คนหนึ่งได้รางวัลหนึ่งครั้ง
      IF FOUND THEN
        UPDATE reward SET issued_count = issued_count + 1 WHERE id = v_reward.id;
        IF v_reward_code.id IS NOT NULL THEN
          UPDATE reward_code SET assigned_to = p_participant, assigned_at = now()
           WHERE id = v_reward_code.id;
        END IF;
        v_granted := v_granted || jsonb_build_object('reward_code', v_reward.code);
      END IF;
    END IF;
  END LOOP;

  -- ── บันทึกผลและสถานะกิจกรรม ────────────────────────────────────────
  v_result := jsonb_build_object(
    'outcome_id', v_chosen->>'id',
    'card_id',    v_chosen->>'card_id',
    'granted',    v_granted);

  UPDATE play_lock SET result = v_result
   WHERE participant_id = p_participant AND activity_id = p_activity AND period_key = p_period_key;

  INSERT INTO participant_activity (
    participant_id, activity_id, status, play_count, last_played_at, completed_at, last_result)
  VALUES (
    p_participant, p_activity,
    CASE WHEN p_completes_activity THEN 'completed' ELSE 'in_progress' END,
    1, now(),
    CASE WHEN p_completes_activity THEN now() ELSE NULL END,
    v_result)
  ON CONFLICT (participant_id, activity_id) DO UPDATE SET
    play_count     = participant_activity.play_count + 1,
    last_played_at = now(),
    status         = CASE WHEN p_completes_activity THEN 'completed' ELSE participant_activity.status END,
    completed_at   = COALESCE(participant_activity.completed_at,
                              CASE WHEN p_completes_activity THEN now() ELSE NULL END),
    last_result    = v_result;

  RETURN jsonb_build_object('replayed', false, 'result', v_result);
END;
$$;
