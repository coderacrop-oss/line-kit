-- ─────────────────────────────────────────────────────────────────────────────
-- เทมเพลตการ์ดสิบตัว · ข้อมูลจริง ไม่ใช่โครงเปล่า
--
-- `card_template` ถูกสร้างไว้ตั้งแต่ 0001 แล้วไม่มีแถวไหนอยู่ในนั้นเลย และไม่มีโค้ด
-- ไหนอ้างถึง — อาการเดียวกับ `activity_template` ที่จอ M7-S01 ต้องเขียนบนหน้าจอว่า
-- "ยังไม่มีเทมเพลตให้เลือก" ทางเลือกที่ซื่อสัตย์แต่ทำให้ฟีเจอร์ตายอยู่อย่างนั้น
--
-- ที่นี่เลือกอีกทาง เพราะเทมเพลตของการ์ดไม่ใช่แค่ความสะดวก: `card.has_sample_text`
-- กับด่าน BR-37 บนจอส่งขึ้น LINE รอข้อมูลชุดนี้อยู่ ไม่มีเทมเพลตแปลว่าไม่มีการ์ดใบไหน
-- ที่ถือข้อความตัวอย่าง แปลว่าด่านนั้นไม่มีวันติด และไม่มีใครรู้ว่ามันต่อสายไว้ถูกไหม
--
-- ⚠️ กลุ่มของเทมเพลตอยู่ในรหัส ไม่ได้อยู่ในคอลัมน์
--   `blank`     → เริ่มจากศูนย์ · อยู่ในชุดเดียวกับอีกเก้าตัวเสมอ (BR-63)
--   `line_*`    → กลุ่ม "ลอกจาก LINE"
--   `beyond_*`  → กลุ่ม "LINE ไม่มี"
-- เพราะการเพิ่มคอลัมน์ `group` จะทำให้ schema เกินจากที่ L2 §5.2 เขียนไว้ แล้ว
-- `npm run db:check` จะแดงทันที · ตัวอ่านคือ `templateGroupOf` ใน lib/cards/create.ts
--
-- ⚠️ ใช้ได้เฉพาะแปดชนิดที่ตัววาดรู้จัก — image · title · body · caption ·
-- progress_bar · divider · spacer · button (`BlockType` ใน lib/render/groups.ts)
-- CHECK ของ `card_block.block_type` รับสิบสามชนิด แต่อีกห้าตัวไม่มีสาขาใน
-- lib/render/flex.ts เลย เทมเพลตที่ใช้มันจะได้บล็อกที่ผู้เล่นไม่มีวันเห็น
--
-- ⚠️ ทุกเทมเพลตต้องมีบล็อกที่พาข้อความอย่างน้อยหนึ่งอัน (title · body · caption ·
-- button ที่มีข้อความจริง) ไม่งั้นคู่ของมันกับชนิด "ข้อความล้วน" จะไม่เหลือบล็อก
-- สักอัน · tests/cards.integration.test.ts บังคับข้อนี้กับทุกแถวในตาราง
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO card_template (code, name, description, blocks, is_builtin, sort_order) VALUES

-- ── เริ่มจากศูนย์ ────────────────────────────────────────────────────────────
('blank', 'เริ่มจากศูนย์',
 'หัวข้อกับข้อความเปล่าให้เขียนทับ ไม่มีปุ่มและไม่มีภาพ',
 '[{"blockType":"title","content":"หัวข้อการ์ด"},
    {"blockType":"body","content":"ข้อความบนการ์ด"}]'::jsonb,
 true, 0),

-- ── ลอกจาก LINE · รูปแบบที่ LINE มีให้อยู่แล้ว ───────────────────────────────
('line_buttons', 'ภาพ ข้อความ แล้วปุ่ม',
 'รูปแบบที่พบบ่อยที่สุดใน LINE — ภาพหัวการ์ด หัวข้อ ข้อความ แล้วปุ่มเดียว',
 '[{"blockType":"image","content":"","options":{"placement":"full_top"}},
    {"blockType":"title","content":"หัวข้อตัวอย่าง"},
    {"blockType":"body","content":"ข้อความตัวอย่างจากเทมเพลต — แก้ให้เป็นของจริงก่อนส่งขึ้น"},
    {"blockType":"button","content":"กดเลย","options":{"action":{"type":"postback","data":""}}}]'::jsonb,
 true, 10),

('line_confirm', 'ถามให้เลือกสองทาง',
 'คำถามหนึ่งบรรทัดกับปุ่มสองปุ่ม — ใช้ตอนต้องให้ผู้เล่นตัดสินใจก่อนไปต่อ',
 '[{"blockType":"title","content":"ยืนยันหรือไม่"},
    {"blockType":"body","content":"ข้อความตัวอย่างอธิบายสิ่งที่กำลังจะเกิดขึ้น"},
    {"blockType":"button","content":"ตกลง","options":{"action":{"type":"postback","data":""}}},
    {"blockType":"button","content":"ไว้ก่อน","options":{"action":{"type":"postback","data":""}}}]'::jsonb,
 true, 11),

('line_product', 'การ์ดสินค้า',
 'ภาพสินค้า ชื่อ ราคา แล้วปุ่มไปหน้าสั่งซื้อ',
 '[{"blockType":"image","content":"","options":{"placement":"full_top"}},
    {"blockType":"title","content":"ชื่อสินค้าตัวอย่าง"},
    {"blockType":"body","content":"คำอธิบายสั้นๆ ของสินค้าชิ้นนี้"},
    {"blockType":"caption","content":"฿0"},
    {"blockType":"button","content":"ดูรายละเอียด","options":{"action":{"type":"uri","uri":""}}}]'::jsonb,
 true, 12),

('line_receipt', 'สรุปรายการ',
 'หัวข้อ รายการ เส้นคั่น แล้วยอดรวม — ไม่มีปุ่ม ใช้เป็นใบยืนยันหลังทำรายการเสร็จ',
 '[{"blockType":"title","content":"สรุปรายการ"},
    {"blockType":"body","content":"รายการตัวอย่าง 1 ชิ้น"},
    {"blockType":"divider"},
    {"blockType":"caption","content":"รวมทั้งสิ้น ฿0"}]'::jsonb,
 true, 13),

('line_ticket', 'บัตรเข้างาน',
 'ภาพงาน ชื่องาน วันเวลา แล้วปุ่มแสดงบัตร',
 '[{"blockType":"image","content":"","options":{"placement":"full_top"}},
    {"blockType":"title","content":"ชื่องานตัวอย่าง"},
    {"blockType":"caption","content":"วันที่และเวลาของงาน"},
    {"blockType":"body","content":"สถานที่จัดงานและรายละเอียดที่ผู้ร่วมงานต้องรู้"},
    {"blockType":"button","content":"แสดงบัตร","options":{"action":{"type":"postback","data":""}}}]'::jsonb,
 true, 14),

-- ── LINE ไม่มี · รูปแบบที่ต้องประกอบเอง ──────────────────────────────────────
('beyond_stamp', 'บัตรแสตมป์',
 'แถบความคืบหน้าของค่าสะสม กับปุ่มไปสะสมต่อ — LINE ไม่มีรูปแบบนี้ให้',
 '[{"blockType":"title","content":"บัตรสะสมแสตมป์"},
    {"blockType":"progress_bar","options":{"counter":"stamp","target":10}},
    {"blockType":"body","content":"สะสมครบแล้วรับของรางวัลได้เลย"},
    {"blockType":"button","content":"สะสมต่อ","options":{"action":{"type":"postback","data":""}}}]'::jsonb,
 true, 20),

('beyond_progress', 'ความคืบหน้าภารกิจ',
 'บอกว่าทำไปได้เท่าไหร่แล้ว โดยไม่ต้องมีปุ่ม',
 '[{"blockType":"title","content":"ความคืบหน้าของคุณ"},
    {"blockType":"progress_bar","options":{"counter":"progress","target":5}},
    {"blockType":"caption","content":"ข้อความตัวอย่างบอกว่าเหลืออีกเท่าไหร่"}]'::jsonb,
 true, 21),

('beyond_reward', 'สิทธิ์รางวัลที่ได้รับ',
 'ภาพรางวัล ชื่อรางวัล เงื่อนไขการใช้ แล้วปุ่มไปขึ้นรางวัล',
 '[{"blockType":"image","content":"","options":{"placement":"full_top"}},
    {"blockType":"title","content":"ยินดีด้วย คุณได้รับรางวัล"},
    {"blockType":"body","content":"ชื่อรางวัลตัวอย่าง"},
    {"blockType":"caption","content":"เงื่อนไขการใช้สิทธิ์ตัวอย่าง"},
    {"blockType":"button","content":"ใช้สิทธิ์","options":{"action":{"type":"postback","data":""}}}]'::jsonb,
 true, 22),

('beyond_locked', 'ยังไม่ผ่านเงื่อนไข',
 'การ์ดที่ตอบคนที่เข้าเล่นไม่ได้ — BR-26 บังคับให้ทุกเงื่อนไขมีการ์ดแบบนี้',
 '[{"blockType":"title","content":"ยังเล่นรอบนี้ไม่ได้"},
    {"blockType":"body","content":"ข้อความตัวอย่างอธิบายว่าทำไมถึงยังเล่นไม่ได้ และต้องทำอะไรก่อน"},
    {"blockType":"button","content":"ดูวิธีเข้าร่วม","options":{"action":{"type":"postback","data":""}}}]'::jsonb,
 true, 23)

-- รันซ้ำได้ · migration ถูกรันใหม่ทุกครั้งที่ใครกด db:reset และแถวที่ชนกันเองไม่ควร
-- ทำให้ทั้งไฟล์ล้ม · ชื่อกับบล็อกถูกเขียนทับ เพราะแหล่งจริงคือไฟล์นี้ ไม่ใช่ฐานข้อมูล
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  blocks = EXCLUDED.blocks,
  is_builtin = EXCLUDED.is_builtin,
  sort_order = EXCLUDED.sort_order;
