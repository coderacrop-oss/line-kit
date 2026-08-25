# Native Quiz Engine — Duo Match Notification (Reply) — Design

## 1. เป้าหมาย

ตอนนี้เมื่อ B ตอบ duo ควิซครบและจับคู่กับ A สำเร็จ (`POST .../duo/match`) **ฝั่ง A ไม่ได้รับอะไรเลย** — ต้อง
เปิด LIFF แล้วเรียก `GET .../duo/my-pairs` เองถึงจะรู้ว่ามีคนมาต่อแล้ว สเปก LIFF platform เดิม (§12) เคย
ตั้งใจไว้ว่าจะทำเป็น push endpoint แบบเสียโควตาให้ LIFF เรียก แต่ยังไม่เคยออกแบบจริง

อ้างอิงแนวคิดจาก `~/Desktop/Codera/KimLIFF/laan-kijjakam` ที่มีระบบ "Reply Designer" คุมข้อความหลายจุดสัมผัส
ของ flow ควิซคู่ — **อ่านเป็น reference เท่านั้น ห้ามแก้ไขโค้ดใน KimLIFF โดยเด็ดขาด**

เป้าหมายของสไลซ์นี้: ให้ LineKit เป็นฝ่ายส่งข้อความแจ้งเตือน A **เองทั้งหมดฝั่งเซิร์ฟเวอร์** ทันทีที่ B จับคู่สำเร็จ
โดยไม่ต้องพึ่ง LIFF client ทำอะไรเพิ่มเติมเลย — ต่างจาก trick `#ref:`/`liff.sendMessages()` ของ KimLIFF ที่ต้อง
ให้ LIFF client เรียก LINE SDK ตรงๆ (ข้าม LineKit ไปเลยตอนส่ง) สไลซ์นี้ **ทุกอย่างต้องวิ่งผ่าน LineKit เอง
100%** ตรงกับสถาปัตยกรรมของระบบ card render + push ที่มีอยู่แล้ว (ใช้ทำ greeting message/keyword-reply)

### เกณฑ์ว่าสำเร็จ (สไลซ์นี้)

ผู้ตั้งค่าเข้าหน้า "Replies" ของกิจกรรมควิซโหมด duo เลือกการ์ดที่จะใช้แจ้งเตือน A ตอนมีคนจับคู่สำเร็จ (การ์ด
ต้องมีปุ่มเปิด LIFF อยู่ในตัวเองอยู่แล้ว แอดมินเป็นคนใส่เอง) พอ B เรียก `POST .../duo/match` สำเร็จ A ได้รับ
ข้อความ LINE ทันทีในแชท OA โดยที่ LIFF client ไม่ต้องรู้เรื่องนี้เลยแม้แต่นิดเดียว — ถ้าส่งไม่สำเร็จ (A บล็อก OA,
LINE API error) B ต้องยังคงได้ผลลัพธ์การจับคู่ตามปกติ ไม่มีอะไรพังตามไปด้วย

## 2. ขอบเขต

### อยู่ในสไลซ์นี้

- จุดแจ้งเตือนเดียว: **duo match สำเร็จ** — ยิงตอน `POST .../duo/match` ของ B สำเร็จเท่านั้น
- `replies` เป็น field เสริมใหม่ใน `QuizConfig` (`lib/quiz/schema.ts`) — flat object ไม่ใช่ array ของ rule
  (มี trigger เดียวตอนนี้ ขยายทีหลังด้วยการเพิ่ม field ใหม่ใน object เดียวกัน ไม่ต้อง restructure)
- หน้าแอดมินใหม่แยกจากหน้าควิซหลัก: `.../quiz/replies` — ผูกกับ **activity** (ไม่ใช่ campaign แบบ KimLIFF)
  มีปุ่มลิงก์ไปกลับกับหน้าควิซหลัก
- กลไกส่ง: reuse ระบบ render card + push ที่มีอยู่แล้วในระบบ (`renderCard`/`pushMessage`) ไม่สร้าง
  ระบบ render/substitution ใหม่ — การ์ดที่เลือกส่งไปตามที่แอดมินสร้างไว้ตรงๆ **ไม่มีการแทรกเนื้อหาผลลัพธ์ควิซ
  แบบไดนามิก** (ไม่มี `{{resultTitle}}` หรือคล้ายกัน) — ถ้าต้องการให้ A เห็นผลจริง การ์ดต้องมีปุ่มเปิด LIFF
  ที่ตัว LIFF จะดึงผลจริงจาก `GET .../duo/my-pairs` เอง

### ไม่อยู่ในสไลซ์นี้ (เว้นไว้ตั้งใจ)

- **`#ref:`/`liff.sendMessages()` free-reply trick ของ KimLIFF** — ขัดกับข้อกำหนดที่ต้องให้ทุกอย่างวิ่งผ่าน
  LineKit เอง (ขั้นตอนนี้ client คุยกับ LINE SDK ตรงๆ ข้าม LineKit ไปเลย) ใช้ `pushMessage` (เสียโควตา) แทน
- **จุดแจ้งเตือนอื่นของ group mode** (สมาชิกใหม่เข้ากลุ่ม, ผลลัพธ์ล็อก) — สเปกนี้เตรียม schema ให้ขยายได้
  แต่ยังไม่ออกแบบ/implement จุดอื่นตอนนี้
- **หน้า "Reply Designer" คุมหลายจุดสัมผัสพร้อมกัน แบบ 6 จุดของ KimLIFF** — ทำแค่จุดเดียวก่อน หน้า
  `.../quiz/replies` ตอนนี้จึงมีแค่ฟิลด์เดียว ไม่ใช่ console เต็มรูปแบบ
- **เนื้อหาข้อความแบบไดนามิก/ตัวแปร** (`{{resultTitle}}` ฯลฯ) — ตัดสินใจแล้วว่าใช้การ์ดคงที่ + ปุ่มเปิด LIFF
  พอ ไม่ต้องสร้างระบบ substitution ใหม่สำหรับ reply โดยเฉพาะ

## 3. Schema การเปลี่ยนแปลง

### 3.1 ส่วนเพิ่มใน `lib/quiz/schema.ts`

```typescript
export const QuizReplies = z.object({
  duoMatchNotifyCardId: z.string().uuid().optional(),  // การ์ดแจ้ง A ตอน B ตอบครบ
})
export type QuizReplies = z.infer<typeof QuizReplies>

// เพิ่มใน QuizConfig เดิม:
replies: QuizReplies.optional()
```

ไม่ validate cross-reference ว่า `duoMatchNotifyCardId` มีอยู่จริงในแคมเปญตอน save (ตาม pattern เดิมของ
`target_card_id`/`greeting_card_id` ที่ไม่ validate เช่นกัน — ไปเช็คตอน send จริงแทน ดู §6)

### 3.2 `TokenPurpose` enum เพิ่มค่าใหม่

`lib/db/tokens.ts`'s `readChannelSecret` ใช้ `purpose` เป็น CHECK-constrained enum — ค่าที่มีอยู่
(`'send_reply' | 'publish' | 'verify_signature' | 'display_last4' | 'test_send' | 'fetch_bot_info'`)
ไม่มีค่าไหนตรงกับ "push แจ้งเตือนอัตโนมัติจากเซิร์ฟเวอร์" เลย — เพิ่มค่าใหม่ `'push_notify'` ผ่าน migration
(ALTER CHECK constraint) เพื่อแยก audit log จาก `send_reply` (ที่ผูกกับการตอบข้อความที่มีคนพิมพ์เข้ามา) และ
`test_send` (ทดลองส่งจากหน้าแอดมิน) ให้ชัดเจนว่านี่คือ push อัตโนมัติจาก event ของระบบ

## 4. กลไกส่ง push (route layer เท่านั้น — ไม่ใช่ DB layer)

**ตำแหน่ง:** `app/api/liff/[liffId]/quiz/[activityCode]/duo/match/route.ts` — **หลัง** `matchQuizPair`
(`lib/db/quizPairs.ts`) สำเร็จเท่านั้น ไม่ใช่ในตัว `matchQuizPair` เอง เพราะ `lib/db/quizPairs.ts` เป็นเลเยอร์
DB ล้วนๆ ไม่แตะ LINE API/render ตาม pattern แยกชั้นที่ใช้ทั้งระบบ (เหมือน `lib/engine/`/`lib/render/`/
`lib/match/` ที่ห้ามแตะ DB/เน็ต) — route คือชั้นที่ orchestrate DB + LINE API + auth อยู่แล้ว

**ขั้นตอน (ห่อทั้งก้อนด้วย try/catch เดียว ไม่ throw ออกมาให้กระทบ response ของ B):**

1. เช็ค `activity.config.replies?.duoMatchNotifyCardId` — ไม่ได้ตั้งไว้ → ข้ามทั้งหมด ไม่ error
2. โหลดการ์ดจาก DB ด้วย `cardId` นี้ — ต้องเป็นการ์ดของ `campaign_id` เดียวกับ activity (กันหยิบการ์ดข้าม
   แคมเปญ) — ไม่เจอ/ไม่ใช่ของแคมเปญนี้ → log แล้วข้าม
3. `renderCard(card, state, theme)` → ได้ `LineMessage` (ใช้ helper เดิม ไม่สร้างใหม่)
4. `readChannelSecret(sql, {channelId, field:'token', purpose:'push_notify', appUserId:null})` — หา token
   ไม่ได้ → log แล้วข้าม
5. หา `line_uid` ของ A (inviter, `participantA`) จากตาราง `participant`
6. `pushMessage(accessToken, lineUidOfA, message)` — ล้มเหลว (LINE API error, A บล็อก OA) → log แล้วจบ
   เงียบๆ ไม่ throw

ทุกจุด log ต้องมีบริบทพอสืบย้อนได้ (เช่น `activityId`, `pairId`, เหตุผลที่ข้าม) แต่ไม่ต้องมีระบบ retry/queue —
เป็น fire-and-forget ตามที่ตกลงไว้

## 5. หน้าแอดมิน

**หน้าใหม่:** `app/(admin)/campaigns/[id]/activities/[activityId]/quiz/replies/page.tsx`

- โหลด activity + `QuizConfig` เต็มก้อนแบบเดียวกับหน้าควิซหลัก (`.../quiz/page.tsx`) แสดงฟอร์มเฉพาะส่วน
  `replies`
- ช่องเลือกการ์ด `duoMatchNotifyCardId` โผล่เฉพาะตอน `mode === 'duo'` — โหมดอื่นยังไม่มีจุดแจ้งเตือนให้ตั้งค่า
  (โชว์ข้อความอธิบายเฉยๆ แทนฟอร์ม)
- ตัวเลือกการ์ด reuse UI picker ที่มีอยู่แล้วในระบบ (เช่นตัวเดียวกับที่ใช้เลือก `greeting_card_id`/
  keyword rule's `target_card_id`) ไม่สร้างของใหม่
- Submit ผ่าน `saveQuizConfigAction` ตัวเดิม (ไม่สร้าง server action ใหม่) — โหลด `QuizConfig` เต็มก้อน แก้
  เฉพาะ `replies` แล้วส่งกลับทั้งก้อน เหมือนที่หน้าควิซหลักแก้ `group` แล้ว submit ทั้งก้อนอยู่แล้ว
- มีปุ่มลิงก์ไปกลับระหว่างหน้าควิซหลักกับหน้านี้ (คู่ปุ่มแบบ "ตั้งค่า"/"Replies" ของ KimLIFF แต่ผูกกับ
  activity เดียว)

## 6. Error handling

| กรณี | ผลลัพธ์ |
|---|---|
| push ล้มเหลว (LINE API error, A บล็อก OA) | log ไว้เฉยๆ ไม่กระทบ response ของ B เลย (B ยังได้ผลลัพธ์การจับคู่ตามปกติ) |
| ไม่ได้ตั้ง `duoMatchNotifyCardId` | ข้าม ไม่พยายามส่ง ไม่ log ว่า error (เป็นสถานะปกติ ไม่ใช่ misconfiguration) |
| การ์ดที่ตั้งไว้ถูกลบไปแล้ว/ไม่ใช่ของแคมเปญนี้ | log ว่า misconfigured แล้วข้าม ไม่ throw |
| หา token สำหรับ `push_notify` ไม่ได้ | log แล้วข้าม |
| ตอน save config เลือกการ์ดที่ไม่มีจริง | ไม่ validate ตอน save (ตาม §3.1) ไปเจอตอน send แทนตามตารางนี้ |

## 7. Testing

- `lib/quiz/schema.test.ts` — เพิ่มเคส `QuizReplies`: accept ค่าว่าง (ไม่ตั้ง `duoMatchNotifyCardId`), accept
  UUID ที่ถูกต้อง, reject ค่าที่ไม่ใช่ UUID
- ขยายเทสต์ route `tests/quiz-liff-duo-routes.integration.test.ts` (หรือไฟล์ที่เกี่ยวข้อง) ให้ครอบคลุม:
  - ตั้ง `duoMatchNotifyCardId` ไว้ → หลัง `duo/match` สำเร็จ มีการเรียก push (ต้องหา pattern mock LINE API
    ที่มีอยู่แล้วในระบบตอนเขียนแผน implementation — ไม่กำหนดตายตัวในสเปกนี้)
  - push จำลองว่าล้มเหลว → response ของ B ยัง 200 พร้อมผลลัพธ์การจับคู่ปกติ ไม่ได้รับผลกระทบ
  - ไม่ได้ตั้งการ์ด → ไม่มีการเรียก push เลย
  - การ์ดที่ตั้งไว้ไม่ใช่ของแคมเปญนี้ → ข้ามเงียบๆ ไม่กระทบ response
- Regression: `npx tsc --noEmit` + `npx vitest run` เต็มชุด + integration + `npx next build` ก่อนถือว่าจบงาน
  (ตาม lesson จากสไลซ์ก่อนหน้า)
