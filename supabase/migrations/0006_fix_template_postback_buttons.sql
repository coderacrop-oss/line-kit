-- ─────────────────────────────────────────────────────────────────────────────
-- เจ็ดปุ่มในเทมเพลตของ 0004 ทิ้ง {"action":{"type":"postback","data":""}} ไว้
--
-- lib/cards/blocks.ts (BUTTON_ACTION_OPTIONS) ปิดตัวเลือก "ไปกิจกรรมอื่น (postback)"
-- ในเอดิเตอร์ไว้แล้ว ด้วยเหตุผลเดียวกัน — lib/render/flex.ts ไม่เคยฉีดวันที่/รหัส
-- แคมเปญเข้าไปใน action เลย มีแต่กระจาย options.action ที่บันทึกไว้ตรงๆ ออกไปเป็น
-- action ของ LINE (component() ใน flex.ts) แต่เทมเพลตของ 0004 สร้างมาก่อนที่เอดิเตอร์
-- จะปิดทางนี้ จึงเหลือ action ที่ประกาศชนิดเป็น postback ไว้พร้อม data ว่างเปล่า —
-- LINE ปฏิเสธข้อความทั้งใบด้วย 400 "must be non-empty text" ทันทีที่การ์ดถูกส่งจริง
-- ไม่ใช่ตอนกดปุ่ม (ปุ่มไม่มีวันถูกกด เพราะข้อความไม่เคยถึงมือผู้เล่นเลยด้วยซ้ำ)
--
-- lib/cards/blocks.ts:readButtonAction() เองก็อ่านรูปนี้เป็น "ยังไม่ได้ตั้งปลายทาง"
-- อยู่แล้ว (ไม่ใช่ postback ที่ใช้งานได้) ดังนั้นการแทนที่ด้วย action ชนิด "message"
-- ที่ใช้ข้อความบนปุ่มเองเป็นเนื้อหา จึงเป็นการแก้ให้ตรงกับสิ่งที่เอดิเตอร์อ่านออก
-- อยู่แล้ว ไม่ใช่การเปลี่ยนพฤติกรรมที่เอดิเตอร์เคยสัญญาไว้ — กดปุ่มแล้วเหมือนพิมพ์
-- ข้อความบนปุ่มเอง เป็นชนิดที่ตัวเรนเดอร์รองรับจริงอยู่แล้ว (kind: 'message')
--
-- แก้สองตาราง เพราะ card_block.options ถูกก็อปมาจาก card_template.blocks ตรงๆ
-- ตอนสร้างการ์ด (createCardFromTemplate) — แก้แค่เทมเพลตจะกันเฉพาะการ์ดที่ยังไม่
-- เกิด ส่วนการ์ดที่สร้างไปแล้วก่อนหน้านี้ (รวมถึงบน production) ยังพัง action เดิม
-- ค้างอยู่ในแถวของตัวเอง ต้องไล่แก้ตรงนั้นด้วย
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE card_template
   SET blocks = (
     SELECT jsonb_agg(
              CASE
                WHEN elem->'options'->'action'->>'type' = 'postback'
                 AND coalesce(elem->'options'->'action'->>'data', '') = ''
                THEN jsonb_set(
                       elem, '{options,action}',
                       jsonb_build_object('type', 'message', 'text', elem->>'content')
                     )
                ELSE elem
              END
              ORDER BY ord
            )
       FROM jsonb_array_elements(blocks) WITH ORDINALITY AS t(elem, ord)
   );

UPDATE card_block
   SET options = jsonb_set(
         options, '{action}',
         jsonb_build_object('type', 'message', 'text', content)
       )
 WHERE options->'action'->>'type' = 'postback'
   AND coalesce(options->'action'->>'data', '') = '';
