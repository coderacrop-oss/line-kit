-- Task 14 (M3-S02 ตัวอย่าง · ส่งทดสอบ) ต้องบันทึกร่องรอยการถอดกุญแจของบัญชี LINE
-- ทุกครั้งที่ปุ่ม "ส่งการ์ดทดสอบ" ถูกกด เหมือนที่ publish (purpose='publish') ทำไว้แล้ว
--
-- 'send_reply' ที่มีอยู่แล้วใน CHECK นี้ไม่ใช่ช่องเดียวกัน — มันสงวนไว้ให้เส้นทางตอบ
-- ผู้เล่นจริงผ่าน webhook (หนี้ทางเทคนิคข้อ 1 ของ docs/HANDOFF.md ที่ replyMessage
-- ยังอ่านจาก env อยู่ ไม่ผ่าน readChannelSecret) ใช้ purpose เดียวกันจะปนสองเหตุการณ์
-- ที่ไม่เกี่ยวกันเข้าด้วยกันในตารางตรวจสอบ — คนละกิจกรรม ต้องคนละแถวที่กรองแยกได้

ALTER TABLE token_access_log DROP CONSTRAINT token_access_log_purpose_check;
ALTER TABLE token_access_log ADD CONSTRAINT token_access_log_purpose_check
  CHECK (purpose IN ('send_reply','publish','verify_signature','display_last4','test_send'));
