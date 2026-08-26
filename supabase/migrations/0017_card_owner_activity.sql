-- supabase/migrations/0017_card_owner_activity.sql
--
-- การ์ดที่สร้างจากหน้า quiz replies ต้องเป็นของ activity นั้นเพียงจุดเดียว — ไม่โผล่ใน
-- ตัวเลือกของ keyword rule, entry/outcome/fallback card ของ activity อื่น, การ์ด default/
-- greeting ของ channel, หรือปุ่ม rich menu (docs/superpowers/specs/2026-08-26-quiz-reply-
-- card-scoping-design.md §3) NULL คือการ์ดทั่วไปของแคมเปญเหมือนเดิมทุกประการ — คอลัมน์นี้
-- ไม่เปลี่ยนพฤติกรรมของการ์ดที่มีอยู่แล้วสักใบ
--
-- ON DELETE CASCADE: ลบ activity ทั้งอัน → การ์ดที่เป็นของมันถูกลบตามไปด้วยอัตโนมัติ
-- (card_block ของการ์ดนั้นก็ตามไปอีกทอด ผ่าน card_block.card_id ON DELETE CASCADE ที่มีอยู่
-- แล้วจาก 0001_init.sql)

ALTER TABLE card
  ADD COLUMN owner_activity_id UUID REFERENCES activity(id) ON DELETE CASCADE;
