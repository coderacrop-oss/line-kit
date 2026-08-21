# LIFF Platform — Design

## 1. เป้าหมาย

LineKit ตอนนี้เป็นแพลตฟอร์มฝั่ง Messaging API ล้วน (webhook, campaign, rich menu, การ์ด) ไม่มีทางให้ LIFF
(หน้าเว็บที่เปิดในแอป LINE) มาเก็บ/อ่านข้อมูลได้เลย เป้าหมายของสไลซ์นี้คือเพิ่มความสามารถนั้นเข้าไป โดยไม่แตะ
สถาปัตยกรรมเดิมของฝั่ง Messaging API แม้แต่นิดเดียว:

- LineKit เป็น**แกนกลาง**ที่ LIFF ตัวไหนก็ได้ในอนาคต (ที่ตั้งใจสร้างมาคุยกับ LineKit ตั้งแต่ต้น) มาเก็บข้อมูล
  ได้ ไม่ต้องมี backend ของตัวเองแยกต่างหาก
- คนที่คุยกับบอทในแชท กับคนที่เล่นผ่าน LIFF ตัวเดียวกัน (ผูกกับ OA เดียวกัน) **ต้องเป็น participant แถว
  เดียวกัน** ไม่สร้างระบบ identity คู่ขนาน
- ต้นทุนเริ่มต้นของ LIFF ใหม่แต่ละตัวต่ำ — แค่เพิ่มทะเบียนหนึ่งแถว ไม่ต้องแก้โค้ด LineKit ต่อ LIFF หนึ่งตัว

### เกณฑ์ว่าสำเร็จ (สำหรับสไลซ์นี้)

ผู้ใช้สร้าง LIFF ใหม่หนึ่งตัว (ไม่ใช่ KimLIFF — ดูหัวข้อขอบเขต) ลงทะเบียนผ่านหน้าแอดมิน แล้วเรียก API ของ
LineKit จากฝั่ง LIFF ได้จริง: verify ตัวตนผ่าน → อ่าน/เขียนข้อมูลของตัวเองได้ → ปิดหน้าแล้วเปิดใหม่ยังเห็นข้อมูล
เดิม

## 2. ขอบเขต

### อยู่ในสไลซ์นี้

- ตาราง `liff_app` (ทะเบียน LIFF) และ `liff_session` (ที่เก็บข้อมูล)
- การตรวจตัวตนสองทาง: **id_token** (LIFF ฝั่งเบราว์เซอร์เรียกตรง) และ **API key** (server-to-server จาก
  backend ของ LIFF เอง)
- API routes ทั่วไป (generic) สำหรับอ่าน/เขียน session — ไม่ผูกกับ domain ของ LIFF ตัวไหนตัวหนึ่ง
- หน้าแอดมินขั้นต่ำสำหรับลงทะเบียน LIFF ใหม่ (สร้าง + ดูรายการ)
- CORS สำหรับ route กลุ่มนี้

### ไม่อยู่ และไม่แกล้งว่ามี

- **ไม่แตะ/ไม่แก้ KimLIFF** — เป็นโค้ดของคนอื่น ใช้เป็นแค่ตัวอย่างอ้างอิงตอนออกแบบเท่านั้น (ดู §13) การเชื่อม
  LineKit กับ KimLIFF จริงๆ ถ้าต้องการ จะเป็นแค่ลิงก์ออก (rich menu ชี้ไปหา URL ของมัน) ไม่มีข้อมูลใดๆ ไหลผ่าน
  ตารางในสไลซ์นี้เลย
- **ไม่สร้าง engine เกมแบบ multi-axis/pairing เข้าไปใน LineKit** (ตัวเลือก "แบบ A" ที่เคยคุยไว้) — สไลซ์นี้
  เป็นแค่ที่เก็บข้อมูลทั่วไป ไม่รู้จักคำว่า "แกน"/"คู่"/"คำถาม" เลย ถ้าจะทำฟีเจอร์แบบนั้นเป็นของจริงของ LineKit
  เอง เป็นงานคนละสไลซ์
- **ไม่มี endpoint สำหรับสั่งส่งข้อความ/push แทน LIFF** (เช่น "แจ้งอีกฝ่ายว่าคู่หูตอบแล้ว") — เป็นช่องโหว่ที่รู้
  ตัวแล้ว (ดู §12) เก็บไว้เป็นการตัดสินใจของสไลซ์ถัดไป ไม่ใช่ของสไลซ์นี้
- ไม่มี rate limiting / ไม่มีการจำกัดขนาด payload ของ `data` JSONB นอกจากเพดานทั่วไปของ Postgres/Next.js
- ไม่มี GIN index บน `data` — รอจนกว่าจะมี query จริงที่ต้องการ (YAGNI)

## 3. สถาปัตยกรรม

### 3.1 หลักการเดียวที่ต้องจำ

**Identity ไม่แยกฝั่ง.** คนที่เปิด LIFF กับคนที่พิมพ์คุยในแชทของ OA เดียวกัน ต้อง resolve ไปที่
`participant` แถวเดียวกันเสมอ — ทำได้เพราะทั้งสองเส้นทางเรียก `ensureParticipant(channelId, lineUid)`
ฟังก์ชันเดียวกัน (`lib/db/queries.ts`, ตัวเดียวกับที่ `lib/webhook/handle.ts` ใช้อยู่แล้ว) ไม่มีการสร้างตาราง
"ผู้ใช้ LIFF" แยกต่างหากเด็ดขาด

### 3.2 LIFF เป็นเอนทิตีใหม่ คู่กับ channel

`liff_app` คือทะเบียน คล้าย `channel` — ต่างกันตรงที่ `channel` แทน "บัญชี LINE หนึ่งบัญชี (Messaging API)"
ส่วน `liff_app` แทน "LIFF หนึ่งตัว (อยู่ใต้ LINE Login channel)" — หนึ่ง `channel` มีได้หลาย `liff_app` ผูกอยู่
(เช่น OA เดียวกันมี LIFF ควิซ + LIFF จองคิว + LIFF สะสมแต้ม พร้อมกัน)

### 3.3 สองทางเข้าตรวจตัวตน — คนละระดับความน่าเชื่อถือ

| ทาง | ใครเรียก | LineKit เชื่อได้เพราะอะไร | เหมาะกับ |
|---|---|---|---|
| **id_token** | เบราว์เซอร์ของผู้เล่นเอง (`liff.getIDToken()`) | LINE เซ็นรับรองตัวตนผู้เล่นให้จริง (เรียก LINE verify endpoint) | LIFF ที่ไม่มี backend ของตัวเอง หรือข้อมูลที่โกงแล้วไม่มีผลเสียหาย |
| **API key** | backend ของ LIFF เอง (server-to-server) | เชื่อว่าใครก็ตามที่ถือกุญแจนี้พูดความจริง — LineKit ไม่ได้ยืนยันอิสระอีกชั้น | LIFF ที่มี backend คำนวณผล/ตัดสินเกมเองอยู่แล้ว (แบบ KimLIFF) อยากได้แค่ที่เก็บข้อมูลปลายทาง |

ทาง id_token ให้ความน่าเชื่อถือสูงกว่า แต่ผู้เล่นควบคุมสิ่งที่ส่งเข้ามาได้เต็มที่ (เบราว์เซอร์แก้ payload เองได้
ก่อนส่ง) — ถ้าฟีเจอร์มีผลได้เสียจริง (รางวัล/โควตา) การตัดสินผลควรเกิดที่ backend ของ LIFF เอง แล้วค่อยเขียน
เข้า LineKit ผ่านทาง API key แทน ไม่ใช่ให้เบราว์เซอร์เขียนผลตรงๆ

### 3.4 ทำไมเก็บเป็น JSONB + คอลัมน์ index แทนที่จะเป็น schema ตายตัว

ยังไม่รู้ล่วงหน้าว่า LIFF ตัวถัดๆ ไปจะเก็บข้อมูลรูปทรงไหน — สร้างตารางเฉพาะทางไปก่อนมีของจริงมักได้ schema
ผิดแล้วต้องรื้อทีหลัง (YAGNI) แต่เพื่อไม่ให้ query ช้าไปตามข้อมูลที่โตขึ้น แยกเฉพาะสิ่งที่ต้องค้นหาได้เร็วออกมา
เป็นคอลัมน์จริงมี index (`participant_id`, `external_key`) ส่วนที่เหลือเก็บใน `data JSONB` เฉยๆ

## 4. Schema

```sql
CREATE TABLE liff_app (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT NOT NULL,
  liff_id                TEXT NOT NULL UNIQUE,
  line_login_channel_id  TEXT NOT NULL,
  channel_id             UUID NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  encrypted_api_key      BYTEA NOT NULL,
  api_key_last4          TEXT NOT NULL,
  key_version            INTEGER NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by             UUID REFERENCES app_user(id)
);

CREATE TABLE liff_session (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  liff_app_id    UUID NOT NULL REFERENCES liff_app(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  external_key   TEXT,
  data           JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX liff_session_app_participant_idx ON liff_session(liff_app_id, participant_id);
CREATE UNIQUE INDEX liff_session_app_external_key_key
  ON liff_session(liff_app_id, external_key) WHERE external_key IS NOT NULL;
```

หมายเหตุต่อคอลัมน์ที่ไม่ได้อธิบายไว้แล้วในเนื้อหาบน:

- `line_login_channel_id` แยกจาก `channel_id` เพราะ LIFF อยู่ใต้ LINE Login channel (คนละ Channel ID กับ
  Messaging API channel) — ต้องส่งค่านี้เป็น `client_id` ตอนเรียก LINE verify endpoint (§5.1) สองค่านี้ไม่มี
  ทางแทนกันได้
- `encrypted_api_key`/`api_key_last4`/`key_version` — เก็บแบบเดียวกับกุญแจของ `channel`
  (`encrypted_token`/`token_last4`/`key_version`) เข้ารหัสก่อนเก็บเสมอ (DD-03 เดิม) ไม่มีทางอ่านค่าเต็มกลับได้
  หลังบันทึก
- `(liff_app_id, participant_id)` **ตั้งใจไม่ unique** — ปล่อยให้แต่ละ LIFF เลือกเองว่าจะเก็บ 1 แถวต่อคน
  (โปรไฟล์) หรือหลายแถวสะสม (ประวัติ) โดยใช้ `external_key` คงที่แทนถ้าต้องการแบบแรก LineKit ไม่ตัดสินใจแทน
- `external_key` ไม่บังคับเป็นเจ้าของโดย participant เดียว — เจตนาให้ query ด้วย key (เช่น invite token) อ่าน
  ข้ามคนได้ (คนละคนแต่รู้ key เดียวกัน) ตัวป้องกันคือต้องผ่านการตรวจตัวตนก่อนเสมอ ไม่ใช่ว่าใครก็ query ได้เลย

## 5. การตรวจตัวตน

### 5.1 ทาง id_token (จากเบราว์เซอร์)

```
1. LIFF เรียก liff.getIDToken() → แนบ Authorization: Bearer <id_token> ทุก request
2. LineKit หาแถว liff_app จาก liffId ใน path
3. POST https://api.line.me/oauth2/v2.1/verify
   body: id_token=<token>&client_id=<liff_app.line_login_channel_id>
   → ได้ { sub: <LINE userId> } กลับมาถ้า token ถูกต้อง ไม่หมดอายุ audience ตรง
4. เรียก ensureParticipant(liff_app.channel_id, sub) → ได้ participant_id
```

token ไม่ถูกต้อง/หมดอายุ/audience ไม่ตรง → LINE เองตอบ error กลับมา → LineKit ส่งต่อเป็น 401 ทันที ไม่เดา
ต่อ

### 5.2 ทาง API key (server-to-server)

```
1. backend ของ LIFF เรียก LineKit ด้วย Authorization: Bearer <api key ของ liff_app นั้น>
2. ต้องระบุ lineUserId ตรงๆ ผ่าน header `X-Line-User-Id` (ไม่มีบริบทเบราว์เซอร์ให้ derive ตัวตนจากไหนเลย —
   และใช้ header แทน body เพราะ GET ส่ง body ไม่ได้จริงในทางปฏิบัติ ทั้ง fetch ของเบราว์เซอร์และ undici
   ของ Node ปฏิเสธการแนบ body คู่กับ method GET; PUT ที่ส่ง `lineUserId` มาทาง body อยู่แล้วยังใช้ได้เป็น
   fallback)
3. LineKit ถอดรหัส encrypted_api_key เทียบกับค่าที่ได้รับ (constant-time compare)
4. ตรงกัน → เรียก ensureParticipant(liff_app.channel_id, lineUserId) → ได้ participant_id
```

**ไม่ตรวจสอบว่า `lineUserId` ที่ส่งมาเป็นตัวจริงหรือไม่** — จุดนี้คือขอบเขตของความน่าเชื่อถือทางนี้ (ดู §3.3)
ผู้ถือ API key ต้องรับผิดชอบเอง

## 6. API routes

Base path: `/api/liff/[liffId]/...` — `liffId` ในที่นี้คือ `liff_app.liff_id` (ค่า LIFF ID จริงของ LINE ไม่ใช่
`liff_app.id`) เพื่อให้ LIFF ฝั่งเบราว์เซอร์ที่รู้แค่ liff-id ของตัวเองเรียกได้ตรงๆ โดยไม่ต้องรู้จัก UUID ภายใน

| Method | Path | Auth | หน้าที่ |
|---|---|---|---|
| GET | `/api/liff/[liffId]/me` | id_token หรือ API key | คืน `{ participantId, lineUserId }` — เช็คว่า auth ผ่านไหม |
| GET | `/api/liff/[liffId]/session` | id_token หรือ API key | คืนแถวทั้งหมดของ participant ที่ resolve ได้จากการตรวจตัวตน |
| GET | `/api/liff/[liffId]/session?key=xxx` | id_token หรือ API key | คืนแถวที่ตรงกับ `external_key` — ไม่จำกัดว่าต้องเป็นเจ้าของแถว (ดู §4) |
| PUT | `/api/liff/[liffId]/session` | id_token หรือ API key | upsert — body `{ externalKey?: string, data: object }`; มี `externalKey` ที่ตรงกับแถวเดิมของ `liff_app` นี้ → อัปเดตทับ + touch `updated_at`; ไม่งั้นสร้างแถวใหม่ผูกกับ participant ที่ resolve ได้ |

ทุก route คืน `401` ถ้าตรวจตัวตนไม่ผ่าน, `404` ถ้า `liffId` ไม่มีทะเบียนอยู่จริง — ไม่มี route ไหนคืนรายชื่อ LIFF
อื่นหรือข้อมูลข้าม `liff_app` ได้เลย (กรองด้วย `liff_app_id` ทุก query)

## 7. หน้าแอดมิน — ลงทะเบียน LIFF ใหม่

จอใหม่ (v1 มีแค่สร้าง + ดูรายการ ยังไม่มีแก้/ลบ — ตามแพทเทิร์นที่หน้า `/channels` เคยเริ่มต้นแบบง่ายมาก่อน):

- ฟอร์ม: name, liff_id, line_login_channel_id, เลือก `channel` จาก dropdown ที่มีอยู่แล้ว, กรอก API key (ครั้ง
  เดียวตอนสร้าง เข้ารหัสก่อนเก็บ เหมือนหน้า channel)
- รายการ: ชื่อ, liff_id, channel ที่ผูกอยู่, `api_key_last4` (ไม่มีทางเห็นค่าเต็มอีกหลังบันทึก — BR-16 เดิม)
- role gate: `configurator` เท่านั้น (เหมือนหน้า channel)

## 8. CORS

Route กลุ่ม `/api/liff/*` ต้องเปิด `Access-Control-Allow-Origin: *` เพราะ LIFF อยู่คนละโดเมนเสมอ (เช่น
`dew-liff.vercel.app` เรียก `line-kit-bice.vercel.app`) — ตัวที่ป้องกันจริงคือการตรวจตัวตนใน §5 ไม่ใช่ origin
เปิดกว้างไว้ก่อนในสไลซ์นี้ คุมเข้มเป็นต่อ-`liff_app` ทีหลังได้ถ้าจำเป็นจริง (ดู §12)

## 9. การจัดการข้อผิดพลาด

| สถานการณ์ | HTTP | เหตุผล |
|---|---|---|
| ไม่มี header `Authorization` เลย | 401 | ไม่มีทางตรวจตัวตนได้ |
| id_token หมดอายุ/ไม่ถูกต้อง/audience ไม่ตรง | 401 | LINE เองปฏิเสธตอน verify |
| API key ไม่ตรงกับ `liff_app` | 401 | ถอดรหัสแล้วเทียบไม่ตรง |
| `liffId` ใน path ไม่มีทะเบียนอยู่จริง | 404 | ป้องกัน enumerate liff_app ที่มีอยู่ |
| `GET session?key=xxx` ไม่เจอแถวไหนตรง | 404 | key นี้ไม่เคยมีอยู่จริง |
| `GET session` (ไม่ระบุ key) แต่ participant นี้ยังไม่เคยมีแถวเลย | **200** พร้อม array ว่าง | คนละความหมายกับ 404 — "ยังไม่เคยเล่น" เป็นสถานะปกติ ไม่ใช่ข้อผิดพลาด |

## 10. เทสต์

สามชั้นเดียวกับที่โปรเจกต์นี้ใช้อยู่แล้ว (ดู README):

- **unit** — ฟังก์ชันถอด/เทียบ API key, ฟังก์ชัน parse ผล verify ของ LINE (mock fetch เหมือนที่
  `lib/line/client.test.ts` ทำกับ endpoint อื่นอยู่แล้ว), validation ของ body `PUT session`
- **integration** — ยิงเข้าจริงกับ Postgres: สร้าง `liff_app`, เรียก route ด้วย id_token ปลอม (mock การเรียก
  LINE verify endpoint) และด้วย API key จริง, ยืนยันว่า participant ที่ได้ตรงกับที่ `ensureParticipant` สร้าง
  ไว้ให้ฝั่ง webhook ใช้อยู่แล้ว (คนละ entry point แต่ต้องได้แถวเดียวกัน — นี่คือเทสต์ที่สำคัญที่สุดของสไลซ์นี้)
- **regression** — snapshot ของ response shape แต่ละ route (กัน field หาย/เปลี่ยนชื่อโดยไม่ตั้งใจ)

## 11. ลำดับลงมือ

1. Migration: สร้าง `liff_app` + `liff_session` (ตาม §4)
2. ฟังก์ชัน auth กลาง (`resolveLiffParticipant`) — รองรับทั้งสองทางใน §5 คืนค่าเดียวกัน (`participantId`,
   `channelId`) ให้ route เรียกใช้โดยไม่ต้องรู้ว่าทางไหนผ่านมา
3. API routes ตาม §6 (me / GET session / PUT session)
4. หน้าแอดมินลงทะเบียน (§7)
5. ทดสอบเชื่อมจริงกับ LIFF ทดลองหนึ่งตัว (ไม่ใช่ KimLIFF) — เกณฑ์สำเร็จตาม §1

## 12. ของที่ยังไม่รู้ และความเสี่ยง

- **ไม่มี endpoint แจ้งเตือน/push แทน LIFF** — ถ้าฟีเจอร์แบบ "แจ้ง A ว่า B ตอบเสร็จ" จะย้ายมาพึ่ง LineKit ด้วย
  ต้องออกแบบเพิ่ม (`POST /api/liff/[liffId]/notify` หรือคล้ายกัน) เป็นการตัดสินใจของสไลซ์ถัดไป ไม่ใช่ตอนนี้
- **`(liff_app_id, participant_id)` ไม่ unique อาจต้องทบทวน** ถ้าใช้จริงแล้วพบว่า LIFF ส่วนใหญ่อยากได้
  พฤติกรรม "1 แถวต่อคน" อยู่ดี — ตอนนั้นอาจคุ้มที่จะเพิ่ม constraint หรือ helper กลาง แทนที่จะให้แต่ละ LIFF
  ทำ convention เอง
- **CORS เปิดกว้าง (`*`)** — ยังไม่มีเหตุผลต้องคุมเข้มตอนนี้ (auth เป็นตัวป้องกันจริง) แต่ถ้ามี LIFF จำนวนมาก
  อาจอยากจำกัด origin ต่อ `liff_app` ทีหลัง
- **ไม่มี rate limiting** — ยังไม่รู้รูปแบบการใช้งานจริงพอจะออกแบบเพดานที่สมเหตุสมผล รอข้อมูลจริงก่อน

## 13. อ้างอิง

- `KimLIFF/laan-kijjakam` (`docs/SYSTEM-OVERVIEW.md`, `src/services/pair.ts`, `src/services/push.ts`,
  `src/services/solo.ts`, `src/services/match.ts`) — ศึกษาเป็นตัวอย่างของ LIFF ที่มีคนทำไว้แล้วจริง ไม่ใช่โค้ด
  ที่จะถูกแก้หรือรวมเข้ากับ LineKit
- `lib/db/queries.ts` — `ensureParticipant()` ที่ทั้ง webhook และ LIFF platform นี้เรียกร่วมกัน
- `lib/line/verify.ts` — ตัวอย่างการตรวจลายเซ็นจาก LINE ที่มีอยู่แล้ว (คนละกลไกกับ id_token verify แต่หลักคิด
  เดียวกัน: ไม่เชื่ออะไรที่ยังไม่ผ่านการตรวจ)
- `app/(admin)/channels/actions.ts` — แพทเทิร์นเข้ารหัสกุญแจก่อนเก็บ (DD-03) ที่ `liff_app.encrypted_api_key`
  เดินตาม
