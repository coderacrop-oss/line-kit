-- ปุ่ม "ดึง Bot User ID อัตโนมัติ" ของจอแก้บัญชี LINE (app/(admin)/channels/[id]/) ต้อง
-- บันทึกร่องรอยการถอดกุญแจของบัญชี เหมือนที่ purpose อื่นๆ ทำไว้แล้ว — เกิดเฉพาะตอน
-- ช่อง Channel access token บนฟอร์มถูกเว้นว่างไว้ (แก้บัญชีเดิมโดยไม่พิมพ์โทเคนใหม่)
-- จึงต้องอ่านโทเคนที่เก็บไว้แล้วผ่าน readChannelSecret() มาเรียก LINE Get Bot Info API
--
-- คนละเหตุการณ์กับ purpose ที่มีอยู่แล้วทั้งหมด: ไม่ใช่ 'send_reply' (ตอบผู้เล่นผ่าน
-- webhook) ไม่ใช่ 'test_send' (ส่งการ์ดทดสอบออกไปหาผู้เล่น) ไม่ใช่ 'publish' (ส่งขึ้น
-- แคมเปญ) — ที่นี่แค่ "ถาม" LINE ว่าบอทตัวนี้คือ userId อะไร ไม่ได้ส่งข้อความอะไรออกไป
-- หาใครเลย คนละกิจกรรม ต้องคนละแถวที่กรองแยกได้ในตารางตรวจสอบ (เหตุผลเดียวกับที่
-- migration 0005 แยก test_send ออกจาก send_reply)

ALTER TABLE token_access_log DROP CONSTRAINT token_access_log_purpose_check;
ALTER TABLE token_access_log ADD CONSTRAINT token_access_log_purpose_check
  CHECK (purpose IN ('send_reply','publish','verify_signature','display_last4','test_send','fetch_bot_info'));
