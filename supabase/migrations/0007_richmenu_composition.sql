-- ─────────────────────────────────────────────────────────────────────────────
-- ตัวจัดวางภาพหลายชั้น (M4-S02) — สถานะการแต่งภาพก่อนกด "ใช้" ให้กลายเป็นภาพจริง
--
-- เก็บแยกออกจาก `rich_menu` เป็นคนละตารางโดยตั้งใจ ไม่ใช่คอลัมน์ JSONB เพิ่มบนแถว
-- เดิม — `rich_menu` เป็นตารางที่ผูกกับสเปกโดยตรง (L2 §5.2) และถูกอ่าน/เขียนบ่อย
-- จากโค้ดที่ไม่เกี่ยวกับการแต่งภาพเลย (identifyLayout, changeLayout, publishRichMenus)
-- การแปะสถานะแก้ไขที่เปลี่ยนบ่อยไว้บนแถวเดียวกันจะทำให้ทุกคำสั่งเขียนที่ไม่เกี่ยวข้อง
-- (เช่น "แขวนเมนูนี้ตอนเข้าร่วม") ลาก JSON ก้อนใหญ่ไปเขียนทับด้วยเปล่าๆ (MVCC ของ
-- Postgres เขียนทั้งแถวใหม่ทุกครั้งที่ UPDATE ไม่ว่าจะแก้กี่คอลัมน์) — เหตุผลเดียวกับ
-- ที่ asset.used_in ในไฟล์ 0001 กลายเป็นคอลัมน์ตายที่ไม่มีใครใช้เพราะความหมายของมัน
-- คลุมเครือกับคอลัมน์อื่นในตารางเดียวกัน
--
-- ไม่มีแถวในตารางนี้ = เมนูนั้นยังไม่เคยใช้ตัวจัดวาง (อัปโหลดภาพเดียวตรงๆ ตามทางเดิม
-- ยังทำงานเหมือนเดิมทุกอย่าง ไม่แตะตารางนี้เลย)
--
-- canvas_width/height ถูกก็อปมาจาก canvasFor(layout) ตอนสร้างแถวนี้ ไม่ใช่คำนวณสด
-- จากผังปัจจุบันของเมนู — กันไม่ให้การสลับผัง (เปลี่ยน rich_menu.areas) ไปทำให้
-- งานแต่งภาพที่ทำค้างอยู่ผิดขนาดไปเงียบๆ โดยไม่มีใครรู้ตัว
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE rich_menu_composition (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rich_menu_id  UUID NOT NULL UNIQUE REFERENCES rich_menu(id) ON DELETE CASCADE,
  canvas_width  INTEGER NOT NULL,
  canvas_height INTEGER NOT NULL,
  background    JSONB NOT NULL DEFAULT '{"type":"color","color":"#FFFFFF"}',
  layers        JSONB NOT NULL DEFAULT '[]',
  updated_by    UUID NOT NULL REFERENCES app_user(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
