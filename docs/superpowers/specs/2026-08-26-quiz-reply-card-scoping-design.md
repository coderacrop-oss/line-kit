# Native Quiz Engine — Reply Card Scoped to Activity — Design

## 1. เป้าหมาย

หน้า `.../quiz/replies` (จากสไลซ์ duo-match-notify ก่อนหน้า) ให้เลือกการ์ดแจ้งเตือนได้จาก **การ์ดทั้งแคมเปญ** —
ใบเดียวกับที่ keyword rule, entry/outcome/fallback ของ activity อื่น, การ์ด default ของ channel, และปุ่ม rich
menu ก็หยิบไปใช้ได้เหมือนกันหมด กลายเป็นว่าการ์ดที่ตั้งใจออกแบบไว้เฉพาะสำหรับแจ้งเตือน duo-match ของ quiz
หนึ่ง อาจถูกไปโผล่ที่อื่นโดยไม่ได้ตั้งใจ (หรือกลับกัน — แอดมินไปหยิบการ์ดที่ทำไว้ใช้ที่อื่นมาใช้ผิดจุด)

เป้าหมายของสไลซ์นี้: การ์ดที่สร้างขึ้นสำหรับ quiz replies ต้อง **เป็นของ quiz activity นั้นเพียงจุดเดียว** —
เลือกได้เฉพาะจากหน้า replies ของ activity นั้น มองไม่เห็น/เลือกไม่ได้จากอีก 5 จุดที่เหลือ

### เกณฑ์ว่าสำเร็จ (สไลซ์นี้)

แอดมินเปิดหน้า `.../quiz/replies` ของ activity ใดก็ได้ ถ้ายังไม่มีการ์ดเป็นของ activity นี้ ตัว dropdown จะว่าง
พร้อมปุ่ม "+ สร้างการ์ดใหม่สำหรับ quiz นี้" กดแล้วไปออกแบบที่หน้า Card Builder เดิม เสร็จแล้วกลับมาเลือกได้
ทันที การ์ดใบนี้จะไม่โผล่ในตัวเลือกของ keyword rule / entry-outcome-fallback ของ activity อื่น / channel
default card / rich menu button เลย แต่ยังเห็นในหน้า catalogue การ์ดทั่วไปได้ (ติดป้ายว่าเป็นของ quiz ไหน)

## 2. ขอบเขต

### อยู่ในสไลซ์นี้

- คอลัมน์ใหม่ `card.owner_activity_id` (nullable FK) — กลไกจำกัดขอบเขตเดียวสำหรับทั้งฟีเจอร์
- ปุ่ม "+ สร้างการ์ดใหม่สำหรับ quiz นี้" บนหน้า `.../quiz/replies` — สร้างการ์ดแล้วพาไปหน้า Card Builder เดิม
- Breadcrumb ของหน้า Card Builder เปลี่ยนตามเจ้าของการ์ด (การ์ดที่ owner_activity_id ตั้งไว้ → กลับไปหน้า
  replies แทนหน้า catalogue)
- แก้ query ของอีก 5 จุด picker ให้กัน `owner_activity_id IS NOT NULL` ออก
- หน้า catalogue ยังโชว์การ์ดที่เป็นของ quiz อยู่ (ไม่กรองออก) แค่ติดป้ายกำกับเพิ่ม
- เพิ่ม `used_by` tracking ให้ครอบคลุม `replies.duoMatchNotifyCardId` เพื่อความสอดคล้องกับกลไก orphan
  detection เดิม

### ไม่อยู่ในสไลซ์นี้ (เว้นไว้ตั้งใจ)

- **Editor ใหม่ /inline editor ในหน้า replies** — ตัดสินใจแล้วว่าใช้ Card Builder เดิมแบบแยกหน้า ไม่ฝัง inline
  (ดูเหตุผลใน §4)
- **การบังคับ/บล็อกการลบการ์ดที่กำลังถูกใช้เป็นการ์ดแจ้งเตือนอยู่** — ระบบเดิมมี fallback "หาการ์ดไม่เจอ →
  skip เงียบๆ" อยู่แล้วจากสไลซ์ก่อนหน้า ครอบคลุมกรณีนี้โดยไม่ต้องทำอะไรเพิ่ม (ดู §6)
- **การจำกัดขอบเขตแบบเดียวกันให้กับ asset/selector/counter หรือเนื้อหาประเภทอื่น** — สไลซ์นี้ทำแค่ `card`
  เท่านั้น ตามที่พบว่าเป็นปัญหาจริงตอนนี้
- **การย้ายการ์ดที่มีอยู่แล้ว (เดิมเป็นการ์ดทั่วไป) มาเป็นของ quiz ย้อนหลัง** — เฉพาะการ์ดที่สร้างใหม่ผ่านปุ่มนี้
  เท่านั้นที่จะมี owner_activity_id ตั้งไว้ ไม่มี migration ย้อนหลังให้การ์ดเดิม

## 3. Data model

```sql
ALTER TABLE card
  ADD COLUMN owner_activity_id UUID REFERENCES activity(id) ON DELETE CASCADE;
```

- `NULL` (ค่าเดิมของการ์ดทุกใบที่มีอยู่แล้ว และการ์ดใหม่ที่สร้างจากหน้า catalogue ทั่วไป) = การ์ดทั่วไป
  พฤติกรรมเดิมทุกอย่าง เห็นได้จากทุก picker
- มีค่า = การ์ดนี้เป็นของ activity นั้นโดยเฉพาะ — เห็นได้เฉพาะจากหน้า `.../quiz/replies` ของ activity นั้น
  เท่านั้น

เลือกใช้ FK column เดี่ยวบน `card` แทนการสร้างตารางใหม่แยกต่างหาก (เช่น `quiz_reply_card` ที่มี schema ซ้ำ)
เพราะความสัมพันธ์เป็น "การ์ดหนึ่งใบเป็นของ activity เดียวได้สูงสุด" (ไม่ใช่ many-to-many) — column ธรรมดา
พอ ไม่ต้องมีตาราง join และยังใช้ renderer/editor/schema เดิมได้ทั้งหมดโดยไม่ต้อง duplicate โค้ด

`ON DELETE CASCADE`: ลบ activity ทั้งอัน → การ์ดที่เป็นของมันถูกลบตามไปด้วยอัตโนมัติ ไม่มีการ์ดกำพร้าค้าง (การ์ด
ทั่วไป `owner_activity_id IS NULL` ไม่ได้รับผลกระทบตรงนี้เพราะไม่มี FK นี้ผูกอยู่)

## 4. การสร้าง/แก้ไขการ์ดจากหน้า replies

ไม่สร้าง editor ใหม่ — ใช้ Card Builder เดิม (`app/(admin)/campaigns/[id]/cards/[cardId]`, BlockList/
BlockForm/PreviewPanel) เปลี่ยนแค่ทางเข้า-ออก:

1. หน้า `.../quiz/replies` — dropdown เดิม (จาก slice ก่อนหน้า) เปลี่ยนจาก `listCards(campaignId)` มาเป็น
   `listCardsForActivity(activityId)` ใหม่ (กรอง `owner_activity_id = activityId`) พร้อมปุ่มใหม่
   **"+ สร้างการ์ดใหม่สำหรับ quiz นี้"**
2. กดปุ่ม → server action สร้างแถว `card` ใหม่ (`owner_activity_id = activityId`, `campaign_id` จาก context)
   → redirect ไปหน้า editor เดิม `.../campaigns/[id]/cards/[cardId]`
3. หน้า editor เดิม (ปกติมีลิงก์ "← กลับไปรายการการ์ด" ไปหน้า catalogue) — ถ้าการ์ดนั้นมี `owner_activity_id`
   ตั้งไว้ ลิงก์กลับจะเปลี่ยนเป็น **"← กลับไป Replies"** ชี้ไปหน้า `.../quiz/replies` ของ activity เจ้าของแทน
   ตัว editor เองไม่เปลี่ยนพฤติกรรมอะไรเลย เปลี่ยนแค่ breadcrumb
4. ออกแบบบล็อก/สี/รูปเสร็จ กดกลับ → มาที่หน้า replies การ์ดที่เพิ่งสร้างโผล่ใน dropdown ให้เลือกได้ทันที

**ทำไมไม่ฝัง inline ในหน้า replies เอง (พิจารณาแล้วตัดออก):** จะทำให้หน้า replies มีปุ่ม "บันทึก" สองความหมาย
ปนกัน (บันทึกเนื้อหาการ์ด vs. บันทึกว่าจะส่งการ์ดไหน) ต้องแยก UI ให้ชัดเจนขึ้นมาก และขัดกับ pattern ที่ตกลง
กันไว้ตอนออกแบบหน้า replies เอง (แยกหน้าเป็นหลัก) — เก็บไว้เป็นตัวเลือกถ้าในอนาคตพบว่าคลิกไปมาบ่อยเกินไป

## 5. ผลกระทบต่อ picker/catalogue เดิม (6 จุด)

**กลุ่ม A — ต้องกันการ์ดที่เป็นของ quiz ออก (5 จุด):**

| จุด | ไฟล์ | วิธีแก้ |
|---|---|---|
| Keyword rule target card | `lib/db/keywords.ts` | เติม `AND owner_activity_id IS NULL` ใน SQL ตรง |
| Activity entry/outcome/fallback card | `lib/db/activities.ts` (`screen.cards`) | เติม `AND owner_activity_id IS NULL` ใน SQL ตรง |
| Channel default/greeting card | `app/(admin)/channels/[id]/page.tsx` (ใช้ `listCards`) | สลับไปเรียก `listUnownedCards` ใหม่แทน |
| Rich menu button target | `lib/db/richmenu.ts` (ใช้ `listCards`) | สลับไปเรียก `listUnownedCards` ใหม่แทน |

`listUnownedCards(sql, campaignId)` (ใหม่ ใน `lib/db/cards.ts`) = query เดียวกับ `listCards` บวก
`AND owner_activity_id IS NULL` — ใช้แทนที่ 2 จุดที่เรียก `listCards` อยู่แล้ว (channel, rich menu)

**กลุ่ม B — หน้า catalogue การ์ดทั่วไป (`.../campaigns/[id]/cards`):** ยังใช้ `listCards()` เดิม (ไม่กรอง)
เหมือนเดิมทุกอย่าง — การ์ดที่เป็นของ quiz ยังเห็นในลิสต์ ตรวจสอบ/ลบได้ตามปกติ แค่เพิ่ม label
**"เป็นของ quiz: [ชื่อ activity]"** ต่อท้ายชื่อการ์ด (join `activity.name` ผ่าน `owner_activity_id` ใน
`listCards`'s query) กันความสับสนว่าทำไมการ์ดนี้ไม่โผล่ใน picker อื่น

**used_by tracking เพิ่มเติม:** กลไก `used_by` เดิม (ใช้คำนวณ `isOrphan`) เพิ่ม branch ใหม่ตรวจ
`activity.input_config->'replies'->>'duoMatchNotifyCardId'` เทียบกับ `card.id` — CardRef kind ใหม่
`'quiz-reply'` (เทียบเคียงกับ kind เดิมที่มีอยู่แล้ว: `activity/keyword/channel/carousel/stamp/richmenu`)
เพื่อให้การ์ดที่ถูกเลือกใช้งานจริงไม่ถูกนับเป็น orphan ผิดๆ — สร้างไว้แต่ยังไม่เลือกใช้ยังคงนับเป็น orphan
ถูกต้องตามความหมายเดิมของระบบ (ownership ≠ การถูกใช้งานจริง)

## 6. การลบ/edge cases

- **ลบ activity ทั้งอัน** → การ์ดที่เป็นของมันถูกลบตาม (CASCADE, ดู §3) — `card_block` ของการ์ดนั้นก็ถูกลบตาม
  ไปอีกทอด (cascade ที่มีอยู่แล้วจาก `card` → `card_block`)
- **ลบการ์ดที่เป็นของ quiz โดยตรง** แม้กำลังถูกเลือกเป็นการ์ดแจ้งเตือนอยู่ — ไม่ต้องมี guard ป้องกันเพิ่ม เพราะ
  `sendDuoMatchNotify` (สไลซ์ก่อนหน้า) มี fallback "หาการ์ดไม่เจอ → log แล้ว skip เงียบๆ ไม่ throw" อยู่แล้ว
  ระบบเดิมก็มีความเสี่ยงแบบเดียวกันกับการ์ดที่ผูกใน `entry_rules`/`outcomes` (เป็น JSONB ไม่มี FK บังคับ
  ความมีอยู่จริง) อยู่แล้วเป็นทุนเดิม — ไม่ใช่ปัญหาใหม่ที่สไลซ์นี้ต้องแก้
- **สลับโหมดควิซออกจาก duo แล้วกลับมา** → `replies.duoMatchNotifyCardId` ไม่ถูกล้าง (ยืนยันแล้วจากสไลซ์ก่อน
  หน้าว่า `sanitizeForSubmit` ไม่แตะฟิลด์นี้) ไม่ต้องแก้อะไรเพิ่ม
- **Migration ใหม่** ต้องต่อเข้า `db:reset` chain ใน `package.json` ด้วย (จุดที่เคยพลาดมาแล้ว 2 ครั้งใน
  โปรเจกต์นี้ — Global Constraint สำหรับแผนถัดไป)

## 7. ขอบเขตการทดสอบ

- Migration: cascade delete ใช้งานได้จริง (ลบ activity → การ์ดของมันหายไปด้วย, ยืนยันด้วย integration test)
- `listCardsForActivity`/`listUnownedCards` — กรองถูกต้องตาม `owner_activity_id`
- 2 จุดที่แก้ SQL ตรง (`keywords.ts`, `activities.ts`) — extend test เดิมให้ยืนยันว่าการ์ดที่เป็นของ quiz
  ไม่โผล่ในตัวเลือก
- Breadcrumb ของ Card Builder เปลี่ยนตาม `owner_activity_id`
- ปุ่ม "+ สร้างการ์ดใหม่" บนหน้า replies — สร้างการ์ดจริง พร้อม `owner_activity_id` ถูกต้อง แล้ว redirect ถูก
  ปลายทาง
- `used_by`/`isOrphan` ครอบคลุม `replies.duoMatchNotifyCardId` กรณีใหม่
- Regression: การ์ดทั่วไป (owner_activity_id เป็น NULL) ยังทำงานทุกจุดเหมือนเดิมทุกประการ (6 picker เดิม +
  catalogue) — ห้ามมีพฤติกรรมเปลี่ยนสำหรับการ์ดที่ไม่ได้เป็นของใคร

## Global Constraints (สำหรับแผน implementation)

- **NEVER modify anything under `~/Desktop/Codera/KimLIFF`** — reference-only, ห้ามแก้เด็ดขาด
- Migration ใหม่ต้องต่อเข้า `db:reset` chain ใน `package.json` (ดู §6)
- ห้ามแก้พฤติกรรมของการ์ดทั่วไป (`owner_activity_id IS NULL`) แม้แต่นิดเดียว — ทุกจุดที่มีอยู่แล้วต้องทำงาน
  เหมือนเดิมทุกประการสำหรับการ์ดที่ไม่มีเจ้าของ
