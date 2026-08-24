# Native Quiz Engine (LineKit-owned MBTI/personality quiz) — Design

## 1. เป้าหมาย

ตอนนี้เวลาจะทำ LIFF แบบ "ตอบคำถามบุคลิกภาพ" (MBTI-style, มีแกน มีผลลัพธ์ จับคู่/รวมกลุ่มได้) ทุกตัวต้องมี
backend + admin ของตัวเอง (แบบที่ DewLIFF/KimLIFF ทำอยู่) — ทั้ง config คำถาม/แกน/ผลลัพธ์ และ logic การจับคู่/
คิดคะแนน ต้องเขียนซ้ำทุกครั้ง

เป้าหมายของสไลซ์นี้: ให้ **LineKit เป็นเจ้าของ config และเป็นคนคำนวณผลลัพธ์เอง** ส่วน LIFF แต่ละตัวมีหน้าที่แค่
ดึงคำถามมาโชว์ ส่งคำตอบกลับมา แล้วรับผลลัพธ์ที่คำนวณเสร็จแล้วไปแสดง — ตั้ง config ไว้ล่วงหน้าที่ LineKit
แล้ว LIFF ใหม่ที่มาต่อเล่นได้ทันทีโดยไม่ต้องตั้งอะไรเพิ่มฝั่งตัวเอง

### เกณฑ์ว่าสำเร็จ (สไลซ์นี้)

ผู้ตั้งค่าสร้างกิจกรรมชนิด "ควิซบุคลิกภาพ" ในแคมเปญ ตั้งแกน/คำถาม/ผลลัพธ์ เลือกโหมด solo หรือ duo แล้ว LIFF
ที่ลงทะเบียนกับ LineKit (ผ่าน `liff_app` ที่มีอยู่แล้ว) เรียก API ของ LineKit ได้จริง: ดึง config (ไม่มีคำตอบ
ที่ถูกหลุดไปด้วย) → ส่งคำตอบ → ได้ผลลัพธ์กลับมา — โหมด duo แชร์ลิงก์ให้เพื่อนตอบต่อได้ และเมื่อครบสองคน
ได้ผลลัพธ์รวมของทั้งคู่กลับมาทั้งสองฝั่ง

## 2. ขอบเขต

### อยู่ในสไลซ์นี้

- Activity ชนิดใหม่ `personality_quiz` ในระบบ "กิจกรรม" เดิม — เป็นอีกตัวเลือกในฟอร์มสร้างกิจกรรม ไม่แทนที่
  ของเดิม (none/pick_one/quiz/text × fixed/weighted/quota/score ยังอยู่ครบ ไม่แก้ไม่กระทบ)
- รหัสกิจกรรม (`activity.code`) ให้ระบบ generate เองตอนสร้าง — ใช้กับกิจกรรมทุกชนิด ไม่ใช่แค่ควิซ (แก้จุดเดียว
  ได้ประโยชน์ทั้งหน้า)
- Config: แกน (axis) + คำถาม/ตัวเลือก/คะแนนต่อแกน + กติกาผลลัพธ์ (type code → ผลลัพธ์) — เก็บเป็น JSON ก้อน
  เดียวใน `activity.input_config` แบบเดียวกับกิจกรรมชนิดอื่นในระบบเดิม (**ไม่ทำ versioning** — ดู §9 เหตุผล)
- โหมด **solo** (คนเดียวตอบ ได้ผลทันที) และ **duo** (สองคนตอบ ได้ผลรวม) เท่านั้น
- API ฝั่ง LIFF: ดึง config (public, ไม่มีคำตอบที่ถูก), ส่งคำตอบ, ดูผลลัพธ์ — ใช้ auth เดิมของ LIFF platform
  (`lib/liff/auth.ts`) ไม่สร้างระบบ auth ใหม่
- หน้าแอดมินตั้งค่า axes/คำถาม/ผลลัพธ์/โหมด แยกเป็นหน้าย่อยของกิจกรรม (คล้าย `activities/[activityId]` เดิม)

### ไม่อยู่ในสไลซ์นี้ (ตั้งใจเว้น — เป็นงานคนละสไลซ์)

- **โหมด group** — ต่อยอดจาก duo ทีหลัง (KimLIFF เองก็ทำ group เป็นเลเยอร์บนคนที่เล่น duo จบแล้ว ไม่ใช่ flow
  แยก) รอสไลซ์นี้เสร็จและพิสูจน์ตัวก่อน
- **Reward pool / claim ผูกกับควิซ**, **Team Builder / สะสมสัญลักษณ์** — เฉพาะทางมาก จาก KimLIFF survey พบว่า
  บางส่วนของฟีเจอร์คล้ายกันนี้ใน KimLIFF เอง (group score formula) เป็นโค้ดที่กรอกได้แต่ engine ไม่เคยอ่านค่าจริง
  เลย — เป็นสัญญาณว่ายังไม่นิ่งพอจะก็อปมาใช้เป็นมาตรฐาน
- **Legacy token-invite duo flow** — พอร์ตมาแค่ flow ใหม่ที่ KimLIFF เองยืนยันว่าใช้งานจริง ("A ตอบครั้งเดียว
  แชร์ลิงก์ด้วย userId ของตัวเอง B มาตอบทีหลังค่อยจับคู่") ไม่พอร์ต token/invite_tokens ที่มี race condition
  จริงที่เจอตอน survey
- **Config versioning/rollback** — ระบบ "กิจกรรม" เดิมทั้งหมดก็ไม่มี versioning (แก้ `input_config` ทับตรงๆ)
  ทำแบบเดียวกันเพื่อความสม่ำเสมอ — ผลคือถ้าแก้ config ระหว่างมีคน duo ค้างรออยู่ ผลลัพธ์อาจเพี้ยนได้ (ยอมรับ
  ความเสี่ยงนี้ไว้ก่อน ไม่ใช่ bug ที่มองไม่เห็น)
- **`liff_session` (LIFF platform เดิม) ไม่ถูกแทนที่** — ยังมีไว้สำหรับ LIFF ที่อยากเก็บ session แบบ generic
  เอง (เช่น DewLIFF ตอนนี้) เอนจิ้นควิซตัวใหม่นี้เป็นความสามารถเพิ่มเติมคู่ขนานกัน ไม่ใช่มาแทน

## 3. Schema การเปลี่ยนแปลง

### 3.1 แก้ตาราง `activity` (migration ใหม่ ไม่แตะของเดิม)

```sql
ALTER TABLE activity DROP CONSTRAINT activity_input_type_check;
ALTER TABLE activity ADD CONSTRAINT activity_input_type_check
  CHECK (input_type IN ('none','pick_one','quiz','text','personality_quiz'));

-- resolve_method ไม่มีความหมายกับ personality_quiz เลย (ไม่ได้ "เลือกผลลัพธ์ 1 จากลิสต์"
-- แบบที่ fixed/weighted/quota/score/lookup ออกแบบมา) — อนุญาตให้เป็น NULL เฉพาะชนิดนี้
ALTER TABLE activity ALTER COLUMN resolve_method DROP NOT NULL;
ALTER TABLE activity DROP CONSTRAINT activity_resolve_method_check;
ALTER TABLE activity ADD CONSTRAINT activity_resolve_method_check
  CHECK (
    (input_type = 'personality_quiz' AND resolve_method IS NULL)
    OR (input_type <> 'personality_quiz' AND resolve_method IN ('fixed','weighted','quota','score','lookup'))
  );
```

`input_config` ของกิจกรรมชนิดนี้เก็บ `QuizConfig` ทั้งก้อน (ดู §4) — คนละรูปร่างกับ `input_config` ของชนิดอื่น
โดยสิ้นเชิง แยกจากกันด้วย `input_type` column เดิม ไม่ต้องมี column ใหม่

### 3.2 ตารางใหม่ — session/pairing state

```sql
-- คำตอบถาวรของผู้เล่นต่อกิจกรรม — คนละแนวคิดกับ input_config (นั่นคือ config ของแอดมิน
-- นี่คือคำตอบของผู้เล่น) ตอบซ้ำได้ (upsert) เหมือน user_quiz_answers ของ KimLIFF —
-- ตอบใหม่ล่าสุดคือค่าที่ใช้จริงเสมอ
CREATE TABLE quiz_answer (
  activity_id    UUID NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  question_id    TEXT NOT NULL,
  option_id      TEXT NOT NULL,
  answered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, participant_id, question_id)
);

-- คู่ duo หนึ่งคู่ — สร้างตอน B มาตอบและจับคู่กับ A สำเร็จ (ไม่สร้างตอน A แชร์ลิงก์)
-- ต่างจาก KimLIFF ตรงที่ไม่มี table pairs ที่ทำหน้าที่ทั้ง solo/duo-เก่า/duo-ใหม่ปนกัน —
-- ตารางนี้มีไว้สำหรับ duo ที่จับคู่สำเร็จแล้วเท่านั้น solo ไม่ใช้ตารางนี้เลย (คำนวณจาก
-- quiz_answer ตรงๆ ไม่มี state ค้าง)
CREATE TABLE quiz_pair (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id       UUID NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
  participant_a     UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  participant_b     UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  result_code       TEXT NOT NULL,
  scores            JSONB NOT NULL, -- { a: {...}, b: {...}, combined: {...} }
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT no_self_pair CHECK (participant_a <> participant_b),
  UNIQUE (activity_id, participant_a, participant_b)
);
CREATE INDEX quiz_pair_participant_a_idx ON quiz_pair(participant_a);
CREATE INDEX quiz_pair_participant_b_idx ON quiz_pair(participant_b);
```

ไม่มี `status: 'waiting'` เพราะ flow ที่พอร์ตมา (§6) ไม่มีสถานะ "รอ" จริงๆ — แถวใน `quiz_pair` ถูกสร้างขึ้นตอน
จับคู่**สำเร็จ**เท่านั้น (เหมือน flow ใหม่ของ KimLIFF ที่ B เปิดลิงก์มาตอบแล้วจบในคำขอเดียว ไม่มีช่วง "รอ" ที่
สังเกตได้จริงในทางปฏิบัติ — ดู survey §4b)

## 4. Content config shape

Zod schema เก็บใน `activity.input_config` ทั้งก้อน — ปรับจาก `CampaignConfig`/`AxisDef`/`Option`/`Question`/
`ResultRule` ของ KimLIFF (ตัดส่วน brand/copy/rewards/messages/group ออก เพราะสิ่งเหล่านั้นเป็นของแคมเปญ/ระบบ
กิจกรรมเดิมของ LineKit เองอยู่แล้ว ไม่ต้องมีซ้ำในนี้):

```ts
// lib/quiz/schema.ts
export const QuizAxis = z.object({
  id: z.string().min(1).max(30),          // slug — ต้องไม่ซ้ำกันในกิจกรรมเดียวกัน
  label: z.string().min(1).max(24),        // โชว์ในหน้าแอดมิน
  poles: z.tuple([z.string().max(24), z.string().max(24)]), // [ขั้วบวก, ขั้วลบ]
})

export const QuizOption = z.object({
  id: z.string().min(1).max(30),
  label: z.string().min(1).max(60),
  // คะแนนต่อแกน — private เสมอ ไม่ส่งให้ LIFF เห็น (ดู §8)
  scores: z.record(z.string(), z.number().int().min(-5).max(5)),
})

export const QuizQuestion = z.object({
  id: z.string().min(1).max(30),
  text: z.string().min(1).max(140),
  options: z.array(QuizOption).min(2).max(6),
})

export const QuizResultRule = z.object({
  code: z.string().min(1).max(30),         // type code เช่น "ENTP" หรือ custom
  title: z.string().min(1).max(120),
  body: z.string().max(600),
  imageUrl: z.string().url().optional(),
  // duo เท่านั้น — คู่แกนเด่นที่ต้องตรง (ไม่สนลำดับ) ไม่ใส่ = ใช้ได้กับทุกคู่ (catch-all)
  pair: z.tuple([z.string(), z.string()]).optional(),
})

export const QuizConfig = z.object({
  mode: z.enum(['solo', 'duo']),
  axes: z.array(QuizAxis).min(2).max(6),
  questions: z.array(QuizQuestion).min(3).max(10),
  results: z.array(QuizResultRule).min(2),
  fallbackResultCode: z.string().min(1),
}).superRefine((cfg, ctx) => {
  // แกน id ซ้ำ, option อ้างแกนที่ไม่มีจริง, ResultRule.code ซ้ำ, fallbackResultCode ต้องมีอยู่จริง,
  // duo mode: ทุก ResultRule (ยกเว้น catch-all) ต้อง .pair อ้างแกนที่มีจริง 2 แกน
})
```

## 5. Scoring algorithm (พอร์ตจาก KimLIFF `buddyQuiz.ts` ตรงๆ — พิสูจน์แล้วว่าใช้งานได้จริง)

1. รวมคะแนนต่อแกนจากทุกคำตอบที่เลือก (`option.scores[axisId]`) เริ่มจาก 0 ทุกแกน
2. แต่ละแกน (ตามลำดับที่ประกาศใน config): `v = scores[axis.id] ?? 0`; เลือกขั้ว `v >= 0 ? poles[0] : poles[1]`
   (เท่ากับ 0 เอนไปทางขั้วแรกเสมอ — tiebreak ตายตัว)
3. เอาตัวอักษรตัวแรกของขั้วที่เลือกของทุกแกน มาต่อกันตามลำดับ → type code (เช่น `ENTP`)
4. หา `results` ที่ `code` ตรงกับ type code (case-insensitive) — เจอก็จบ ไม่เจอ fallback ไปที่
   `fallbackResultCode`
5. โหมด duo: คิดคะแนนของทั้งคู่แยกกันแบบข้อ 1-2 ก่อน (ได้ dominant axis ของ A และของ B) แล้วรวมคะแนนแต่ละแกน
   ของสองฝั่งเข้าด้วยกัน (`combined[axis] = scoresA[axis] + scoresB[axis]`) — หา `ResultRule` ที่ `pair` ตรงกับ
   คู่ dominant axis ของ A/B (ไม่สนลำดับ) โดยเช็คจากบนลงล่าง เจอก่อนใช้ก่อน ไม่มี `pair` ที่ตรง → fallback

## 6. Solo flow

`POST /api/liff/{liffId}/quiz/{activityCode}/solo/answer` — คำขอเดียวจบ ไม่มี state ค้าง:

1. `resolveLiffParticipant` (auth เดิม) → ได้ `participantId`
2. โหลด `activity` จาก `activityCode` + `campaign_id` ที่ผูกกับ `liff_app.channel_id` (ผ่าน `campaign_channel`
   ที่ `is_published`) — 404 ถ้าไม่เจอหรือ `input_type <> 'personality_quiz'` หรือ `input_config.mode <> 'solo'`
3. Validate คำตอบครบทุกคำถาม, option id มีจริง — 422 ถ้าไม่ครบ
4. Upsert เข้า `quiz_answer` (ทับคำตอบเก่าถ้ามี — ตอบซ้ำได้เสมอ ไม่ล็อก)
5. คำนวณผลตาม §5 คืนกลับทันที `{ resultCode, title, body, imageUrl, axisScores }`

## 7. Duo flow

**ขั้น A — ใครก็ตามตอบคนแรก** `POST /api/liff/{liffId}/quiz/{activityCode}/duo/answer`:
- เหมือน solo ข้อ 1-4 ทุกประการ (upsert เข้า `quiz_answer` เดียวกัน — solo/duo ใช้ตารางคำตอบร่วมกัน เพราะ
  "คำตอบของคนคนนี้ต่อคำถามนี้" ไม่ขึ้นกับโหมด)
- คืน `{ shareUrl: "{LIFF_URL}?inviterParticipantId={participantId}&activityCode={code}" }` — ไม่มี token,
  ไม่มีวันหมดอายุ ใช้แชร์ได้เรื่อยๆ (ตามแบบที่ KimLIFF ยืนยันว่าใช้จริง)

**ขั้น B — อีกฝ่ายเปิดลิงก์มาตอบ** `POST /api/liff/{liffId}/quiz/{activityCode}/duo/match`:
- รับ `inviterParticipantId` + คำตอบของตัวเอง (หรือถ้าเคยตอบไปแล้วก็ดึงจาก `quiz_answer`)
- ปฏิเสธถ้า `bParticipantId === inviterParticipantId` (จับคู่กับตัวเองไม่ได้)
- เช็คก่อนว่ามี `quiz_pair` ของคู่นี้ (`activity_id, participant_a=inviter, participant_b=b`) อยู่แล้วหรือยัง
  — ถ้ามี **คำนวณซ้ำแล้วคืนผลเดิม** ไม่สร้างแถวซ้ำ (idempotent — กัน B กดซ้ำ/refresh แล้วได้คู่ปลอมอีกอัน)
- ไม่มี → **ใช้ transaction จริง** (`sql.begin()`) ห่อ: โหลดคำตอบของ inviter จาก `quiz_answer` (404 ถ้ายังไม่
  เคยตอบ) + validate คำตอบของ B + upsert คำตอบ B เข้า `quiz_answer` + insert แถว `quiz_pair` ในทีเดียว — กัน
  ปัญหา race ที่ KimLIFF เจอตอน survey (สอง request ยิงพร้อมกันแล้วจับคู่ครึ่งๆ กลางๆ)
- คำนวณผลตาม §5 คืนกลับให้ B ทันที `{ resultCode, title, body, axisMe, axisBuddy }`
- (Push แจ้ง A ว่ามีคนมาต่อแล้ว เป็นเรื่องของ Messaging API ฝั่ง LineKit เอง ไม่ใช่ของสไลซ์นี้ — ถ้าต้องการ
  เป็น follow-up แยก)

**A เช็คผลย้อนหลัง** `GET /api/liff/{liffId}/quiz/{activityCode}/duo/my-pairs` — คืนลิสต์ `quiz_pair` ทุกคู่ที่
`participantId` ปัจจุบันอยู่ฝั่ง A หรือ B (คำนวณผลจากที่บันทึกไว้ใน `quiz_pair.scores`/`result_code` ตรงๆ ไม่
ต้องคำนวณใหม่ เพราะแช่แข็งไว้ตอนจับคู่สำเร็จแล้ว)

## 8. Public config API

`GET /api/liff/{liffId}/quiz/{activityCode}` — คืน config เวอร์ชัน**ตัดคำตอบที่ถูกออก**:

```ts
{
  mode: 'solo' | 'duo',
  axes: [{ id, label }],                    // ตัด poles ออกด้วย — ไม่บอกว่าขั้วไหนคือขั้วไหน
  questions: [{ id, text, options: [{ id, label }] }],  // ตัด option.scores ออก
}
// ไม่ส่ง results เลย — คือคำตอบเฉลย ห้ามหลุดไปฝั่ง client เด็ดขาด (เหมือน toPublicConfig ของ KimLIFF)
```

## 9. หน้าแอดมิน

- `activities/page.tsx` (ฟอร์มสร้างกิจกรรม): เพิ่ม `personality_quiz` เป็นตัวเลือกที่ 5 ใน "ชนิดอินพุต" —
  เลือกแล้วซ่อนช่อง "วิธีตัดสินผล" ทั้งหมด (ไม่มีความหมายกับชนิดนี้) โชว์แค่ dropdown "โหมด: solo/duo"
  แทน — ไปตั้งค่าแกน/คำถาม/ผลลัพธ์ต่อที่หน้าย่อยหลังสร้าง
- **รหัสกิจกรรม generate อัตโนมัติ** (ทุกชนิด ไม่ใช่แค่ควิซ) — เอาจากชื่อกิจกรรม slugify (ตัดอักขระพิเศษ, เว้น
  วรรค→ขีดล่าง, ตัดให้พอดี `CODE_PATTERN`) ต่อท้ายด้วยเลขสุ่มสั้นๆ ถ้าชนกัน (unique violation retry ครั้งเดียว
  — เหมือน pattern อื่นในระบบที่ดัก unique violation อยู่แล้ว) — เอาช่อง input ออกจากฟอร์ม ไม่ให้พิมพ์เองอีก
  ต่อไป
- `activities/[activityId]/quiz/page.tsx` (หน้าใหม่ เฉพาะกิจกรรมชนิด `personality_quiz`): ตั้งแกน (id/label/
  poles) → คำถาม+ตัวเลือก+คะแนนต่อแกน → กติกาผลลัพธ์ (code/title/body/pair) → fallback — ฟอร์มเดียว บันทึกทับ
  `activity.input_config` ทั้งก้อน (ไม่มี versioning ตาม §2)

## 10. Error handling

- Config ไม่ครบ/ผิดรูปแบบตอนบันทึก → validate ด้วย Zod ฝั่ง server เหมือนทุกฟอร์มอื่นในระบบ คืน error message
  เจาะจง (ไม่ throw ข้าม Server Action boundary — ตาม pattern `ActionResult` ที่ใช้ทั้งระบบ)
- LIFF ยิง API มาแต่กิจกรรมไม่ใช่ `personality_quiz` หรือโหมดไม่ตรง (เช่นยิง `/duo/answer` กับกิจกรรมที่ตั้งเป็น
  solo) → 400 พร้อมข้อความบอกโหมดที่ถูกต้อง
- คำตอบไม่ครบทุกคำถาม / option id ไม่มีจริง → 422 พร้อมรายชื่อคำถามที่ขาด
- Duo match กับ inviter ที่ยังไม่เคยตอบ → 404 "ยังไม่มีคำตอบของผู้ชวน"
- จับคู่กับตัวเอง → 400

## 11. Testing

- `lib/quiz/schema.ts` — unit test ครอบ superRefine ทุกกรณี (แกนซ้ำ, อ้างแกนไม่มีจริง, fallback ไม่มีอยู่จริง,
  ฯลฯ)
- `lib/quiz/engine.ts` (คิดคะแนน+เลือกผลลัพธ์) — unit test ทุก branch ของ §5 รวม tiebreak ที่ 0 และ fallback
  เมื่อไม่มี type code ตรง
- Solo/duo API route — integration test ต่อ DB จริง (ตาม pattern DB test ของ LIFF platform) รวมเทสต์ยิง duo
  match พร้อมกัน 2 request เพื่อยืนยันว่า transaction กัน race ได้จริง (ข้อกังวลที่เจอใน KimLIFF)
- Regression: รัน `npx vitest run` เต็มชุด + `npx next build` ก่อนถือว่าจบงาน (ตาม lesson จาก
  `@napi-rs/canvas` bundling bug ที่เจอมาก่อนหน้านี้ — unit test อย่างเดียวไม่พอ)
