-- reward_code.assigned_to ถูกตั้งเป็น UNIQUE ทั้งตาราง ซึ่งไม่ใช่สิ่งที่ตั้งใจ
--
-- เจตนาตามหมายเหตุใน §5.2 คือ "กันการจ่ายรหัสเดียวกันสองคน" — แต่เรื่องนั้น
-- เป็นไปไม่ได้อยู่แล้ว เพราะ assigned_to เป็นคอลัมน์เดียวบนแถวเดียว
--
-- สิ่งที่มันทำจริงคือกันไม่ให้ผู้เล่นคนหนึ่งปรากฏสองครั้งในตารางนี้ แปลว่า
-- คนหนึ่งถือรหัสได้ใบเดียวตลอดทั้งระบบ ข้ามรางวัล ข้ามแคมเปญ · และเพราะ
-- play_and_apply จ่ายรหัสอยู่ในธุรกรรมเดียวกับการออกสิทธิ์ รางวัลชนิดรหัส
-- ตัวที่สองที่คนคนนั้นชนะจะทำให้ทั้งการเล่นล้ม ไม่ใช่แค่ไม่ได้รหัส
--
-- ขอบเขตที่ถูกคือหนึ่งคนต่อหนึ่งรางวัล ซึ่งตรงกับ BR-07 ที่ entitlement
-- บังคับไว้แล้วด้วย UNIQUE (participant_id, reward_id)

ALTER TABLE reward_code DROP CONSTRAINT reward_code_assigned_to_key;

CREATE UNIQUE INDEX reward_code_one_per_participant_per_reward
  ON reward_code (reward_id, assigned_to)
  WHERE assigned_to IS NOT NULL;
