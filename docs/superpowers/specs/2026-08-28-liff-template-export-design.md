# LIFF Template Export — Design

## 1. เป้าหมาย

ทีม Codera ตั้งค่ากิจกรรมควิซบุคลิกภาพผ่าน LineKit (native quiz engine ที่มีอยู่แล้ว — `lib/quiz/`)
แล้ว **export ออกมาเป็นโปรเจกต์ Next.js แบบ standalone ที่รันได้จริงทันที** — ทีมแตก zip,
`npm install && npm run dev`, ได้แอป LIFF ที่มีเนื้อหา/ตรรกะตรงตามที่ตั้งค่าไว้ครบ ไม่ต้องเขียนโค้ด
เพิ่มแม้แต่บรรทัดเดียว เหลือแค่เสียบ LIFF ID/LINE channel credentials จริงแล้ว deploy

โปรเจกต์ที่ export ออกมาต้อง **ไม่พึ่ง LineKit ที่รันอยู่เลยแม้แต่น้อย** — ไม่มี fetch กลับมาหา
LineKit API ไม่มี LineKit เป็น dependency ใน `package.json` — เป็นสำเนาโค้ด engine/render
ที่เอาไปวางที่ไหนก็รันเองได้ตลอดไป

อ้างอิงพื้นหลัง: ทีมเคยสร้าง "KimLIFF" (`~/Desktop/Codera/KimLIFF/laan-kijjakam`) เป็นแอป LIFF
ควิซคู่บัดดี้ที่ deploy ใช้งานจริงมาก่อน สไลซ์นี้สรุปโครงหน้าจอ/ตรรกะจากการศึกษาระบบนั้นมาเป็น
ต้นแบบทั่วไป (generic) — **ไม่ก็อปโค้ด ไม่แตะ ไม่เปิดอ่านของ KimLIFF ระหว่างทำงานนี้เลย** ทุกอย่าง
สรุปไว้ในเอกสารนี้แล้ว

### เกณฑ์ว่าสำเร็จ (ฟีเจอร์นี้ทั้งฟีเจอร์)

ผู้ตั้งค่าเปิดกิจกรรมควิซที่มีอยู่แล้วในหน้าแอดมิน กดปุ่ม "Export เป็นเทมเพลต" ได้ไฟล์ `.zip` — แตกไฟล์
แล้ว `npm install && npm run dev` ขึ้นแอปที่มี 12 จอตรงตามสเปก §7 พร้อม engine ตัดสินผล/จับคู่ที่ถูกต้อง
100% และ 12 ข้อความ/การ์ดที่ส่งเข้าแชท LINE ตรงกับเนื้อหาที่ตั้งค่าไว้ — เสียบ `LIFF_ID`/channel
credentials จริงแล้ว deploy ได้โดยไม่ต้องแก้โค้ด

### เกณฑ์ว่าสำเร็จ (สไลซ์นี้ — ดู §2)

Schema (versioned) + engine (pure, vendored) + render layer 12 เทมเพลตข้อความ + จอ 12 จอ (React
component, data wiring ถูกต้อง, plain styling) + กลไก export → zip + เทสต์ครบสามชั้นตามธรรมเนียม
โปรเจกต์ — ยืนยันด้วย `npm test` เขียวทั้งหมด รวมของใหม่

## 2. ขอบเขต

### อยู่ในสไลซ์นี้

- ส่วนขยาย schema ใน `lib/quiz/schema.ts`: เพิ่ม `templateCopy` (optional field ใหม่ ตามแบบที่
  `group`/`replies` เคยเพิ่มมาแล้ว) เก็บ branding/ข้อความที่จอ/การ์ดต้องใช้ทั้งหมด
- โฟลเดอร์ต้นทางของเทมเพลต `liff-template/` ที่ repo root — โปรเจกต์ Next.js ของจริง (flatten แล้ว
  ไม่ใช่ monorepo) พร้อม `package.json`/`tsconfig.json`/`next.config.ts`/`README.md` ของตัวเอง
- `liff-template/lib/schema.ts` — schema สำหรับไฟล์ config ที่ export ออกมา (`schemaVersion` +
  สำเนาโครงเดียวกับ `QuizConfig` ที่มี `templateCopy`) เทมเพลตเช็ค `schemaVersion` ตอน boot แล้ว
  โยน error ชัดเจนถ้าไม่ตรง
- `liff-template/lib/engine/` — สำเนา pure function จาก `lib/quiz/engine.ts` +
  `lib/quiz/groupEngine.ts` (คัดลอกซอร์ส ปรับ import path เท่านั้น ไม่แก้ตรรกะ) พร้อมเทสต์ครบทุก
  branch เดิม
- `liff-template/lib/render/` — 12 pure function เรนเดอร์ Flex message (§6)
- `liff-template/lib/store/` — interface `Store` + default implementation แบบ JSON-file (ไม่พึ่ง
  service ภายนอก ใช้ได้ทันทีตอน `npm run dev`/deploy ขนาดเล็ก) สำหรับ solo/duo/group ที่ต้องมี
  state ข้ามอุปกรณ์ (คำตอบ/คู่/กลุ่ม)
- `liff-template/app/screens/*.tsx` — 12 จอ (§7) เป็น presentational component รับ props ตรงสเปก
  ทุกจอมีเทสต์ (React Testing Library) ยืนยัน data wiring
- `liff-template/app/` — page routing ที่ต่อ 12 จอเข้าด้วยกันจริงสำหรับ **โหมด solo** ครบวงจร (ไม่ต้อง
  cross-device state) เป็นหลักฐานว่าสถาปัตยกรรมทำงานจริงจบ end-to-end หนึ่งเส้นทาง — duo/group เดินสาย
  ผ่าน API routes เดียวกัน (`liff-template/app/api/*`) แต่การต่อ LIFF SDK จริง (`liff.init`,
  `liff.getProfile`, friend-gate ผ่าน LINE API) ทำเป็น thin client module ที่ชี้ตำแหน่งเสียบไว้ชัดเจน
  (ดู §7.1)
- `lib/liffExport/` ใน LineKit เอง — ฟังก์ชันประกอบไฟล์ (อ่าน `liff-template/` จากดิสก์ + stamp
  config) + ห่อ zip (ใช้ `archiver`, ไลบรารีใหม่ที่ต้องเพิ่ม — ไม่มีของเดิมให้ใช้)
- endpoint แอดมิน `app/(admin)/campaigns/[id]/activities/[activityId]/quiz/export/route.ts` — สตรีม
  zip กลับ
- หน้าแอดมินใหม่ `TemplateCopyForm.tsx` แก้ `templateCopy` — ยิง `saveQuizConfigAction` เดิม (แบบเดียว
  กับ `RepliesForm`/`GroupConfigEditor`) ไม่สร้าง action ใหม่
- ขยาย `lib/architecture.test.ts` ให้ครอบ `liff-template/lib/engine` และ `liff-template/lib/render`
- เทสต์ schema/admin parity (§10) กันการหลุดของฟิลด์ตามข้อผิดพลาดที่ 4 ของ KimLIFF

### อยู่ในฟีเจอร์แต่ไม่ใช่สไลซ์นี้ (ออกแบบ interface ไว้แล้ว ยังไม่ implement เต็ม)

- `liff-template`'s duo/group **หน้าจอต่อ LIFF SDK จริงแบบ end-to-end** (invite link → เปิดบนมือถือ
  อีกเครื่อง → เห็นผล) — ต่อ `liff.init`/`liff.getProfile` ไว้เป็น thin wrapper (`lib/liff/client.ts`)
  ที่ export ออกไปพร้อมคอมเมนต์ชี้จุดเสียบจริง แต่ยังไม่มี integration test ที่รันจริงผ่านเบราว์เซอร์
  LINE (ทำได้แค่ unit-level กับ mock)
- Push messaging จริงจาก LINE Messaging API (การ์ด push 6 ใน 12 แบบ ต้องมี webhook + channel access
  token ของ deployment นั้นจริง) — เทมเพลตมี `lib/line/push.ts` เป็น thin client เรียก Messaging API
  ตรงๆ (fetch เดียว ไม่มี queue/retry) แต่ยังไม่มี cron/scheduler สำหรับการ์ดแจ้งเตือนตามเวลา (reminder
  N ชั่วโมง, group ยังไม่ครบ) — ทำเป็น API route ที่ตั้ง cron ภายนอกยิงเข้ามาเองได้ (เอกสารไว้ใน README
  ของเทมเพลต) ไม่ทำ cron ในตัว เพราะ hosting เป้าหมาย (Vercel Hobby) ไม่มี cron ฟรีที่แม่นพอ
- `liff-template/lib/store/` แบบอื่นนอกจาก JSON-file (เช่น Postgres) — ออกแบบผ่าน interface เดียว
  (`Store`) สลับ implementation ได้โดยไม่แตะ engine/render/screens แต่สไลซ์นี้ส่งแค่ JSON-file
- duo/group full end-to-end integration test ผ่าน dev server จริง (มีแค่ unit test ของ store/API route
  handler ตรงๆ)

### ไม่อยู่ในฟีเจอร์นี้เลย (ตัดทิ้ง พร้อมเหตุผล)

- **Reward pool/claim, `overflow_mode`/`batch_size`, group `result_mode: 'score'` formula** — LineKit
  เคยพิจารณาและปฏิเสธทั้งหมดนี้แล้วตอนสร้าง native quiz engine (`2026-08-24-native-quiz-engine-design.md`
  §2, `2026-08-25-quiz-group-mode-design.md` §2) ด้วยเหตุผลเดียวกัน: เป็น dead code ในต้นแบบเดิม หรือ
  มีไว้รองรับ reward ที่ไม่มีในระบบนี้ สไลซ์นี้สืบทอดการตัดสินใจนั้นต่อ ไม่รื้อฟื้น
- **Config versioning/migration สำหรับ `QuizConfig` ของ LineKit เอง** — LineKit ตัดสินใจไม่ทำมาตั้งแต่
  ต้น (§ อ้างอิงข้างบน) `schemaVersion` ในสไลซ์นี้เป็นคนละเรื่อง: เป็นสัญญาของ **ไฟล์ config ที่ export
  ออกไปแล้ว** ต่อโค้ดเทมเพลต ไม่ใช่ versioning ของ `activity.input_config` ใน LineKit
- **ระบบ authoring Flex การ์ดทั่วไปแบบ block-based** (`lib/cards/blocks.ts`/`lib/render/flex.ts`) —
  ไม่ยกมาใช้ในเทมเพลต เพราะเป็นระบบที่ผูกกับ DB/แอดมินของ LineKit (เลือกภาพจากคลัง ฯลฯ) การ์ด 12 แบบ
  ในเทมเพลตเป็น pure function เขียนตรงจาก config (§6) เบากว่าและไม่มี dependency ย้อนกลับมาที่ LineKit
- **นำโค้ด/ทรัพยากรจาก KimLIFF มาโดยตรง** — สรุปเฉพาะพฤติกรรม/โครงหน้าจอ ไม่ก็อปสักบรรทัด

## 3. สถาปัตยกรรมรวม

```
LineKit repo (การตั้งค่าอยู่ที่นี่ — ไม่มีการรันจริง)
├── lib/quiz/                    schema/engine/groupEngine เดิม (ไม่แก้ตรรกะ เพิ่มแค่ templateCopy field)
├── lib/liffExport/
│   ├── assemble.ts               อ่าน liff-template/** จากดิสก์ + stamp config → รายการไฟล์ในหน่วยความจำ
│   ├── zip.ts                    ห่อรายการไฟล์เป็น zip stream (archiver)
│   └── assemble.test.ts / zip.test.ts
├── app/(admin)/.../quiz/
│   ├── template/page.tsx + TemplateCopyForm.tsx     แก้ templateCopy
│   └── export/route.ts                               GET → stream .zip
└── liff-template/                โปรเจกต์ปลายทาง — โครงสร้างเดียวกับที่จะอยู่ใน .zip ทุกประการ
    ├── package.json / next.config.ts / tsconfig.json / README.md / .env.example
    ├── config/quiz.config.sample.json    ตัวอย่างไว้ dev ในโหมด standalone (ถูกแทนที่ตอน export จริง)
    ├── lib/
    │   ├── schema.ts                     TemplateConfig (schemaVersion + QuizConfig-compatible shape)
    │   ├── config.ts                     โหลด+validate config ตอน build/runtime
    │   ├── engine/{quiz,group}.ts(+test) สำเนา pure logic
    │   ├── render/messages.ts(+test)     12 pure renderer
    │   ├── store/{types,fileStore}.ts(+test)
    │   └── liff/client.ts                thin wrapper รอบ @line/liff (ชี้จุดเสียบจริงไว้ชัดเจน)
    └── app/
        ├── screens/*.tsx(+test)          12 จอ
        ├── page.tsx / layout.tsx          ต่อจอเข้าด้วยกันจริงสำหรับ solo
        └── api/{answer,pair,group}/route.ts
```

**หลักการสำคัญ:** โค้ดใต้ `liff-template/lib/engine/` และ `liff-template/lib/render/` เป็น **pure
เหมือน `lib/engine/`/`lib/render/`/`lib/quiz/` เดิมของ LineKit ทุกประการ** — ห้ามแตะ DB/เน็ต/
`process.env` (บังคับด้วย `lib/architecture.test.ts` ที่ขยายมาครอบ path นี้ด้วย, §9) เพราะเป็นโค้ดที่
จะถูกก็อปไปรันในโปรเจกต์อื่นที่ไม่มี LineKit อยู่เลย จะพึ่ง I/O ของ LineKit ไม่ได้ตั้งแต่ต้น

`liff-template/` **ไม่ใช่ dependency ของ LineKit และไม่ถูก `npm install` ในรีโปนี้** — เป็นซอร์สที่
`lib/liffExport/assemble.ts` อ่านจากดิสก์ตรงๆ (fs) แล้ว relocate เข้า zip เท่านั้น เทสต์ pure logic
ของมันรันผ่าน `vitest` ตัวเดียวกับ LineKit ได้เลยเพราะ `vitest.config.ts` ของ LineKit สแกนทั้ง repo
ด้วย glob `**/*.test.ts(x)` อยู่แล้ว (ต้องเพิ่ม `liff-template/node_modules/**` เข้า `exclude` กันไว้
เผื่อมีใคร `npm install` ในโฟลเดอร์นั้นเพื่อรัน `next dev` ทดสอบเทมเพลตเอง)

## 4. Config schema (versioned)

### 4.1 `lib/quiz/schema.ts` — ส่วนเพิ่มใน LineKit (ไม่แตะของเดิม)

```typescript
export const RewardMilestone = z.object({
  key: z.string().min(1).max(30),
  label: z.string().min(1).max(60),
  icon: z.string().max(10).optional(), // emoji เดียว เก็บเป็นสตริง ไม่ใช่ path รูป
  triggerCount: z.number().int().min(1),
})
export type RewardMilestone = z.infer<typeof RewardMilestone>

export const TemplateMessagesCopy = z.object({
  resultCard: z.object({ eyebrow: z.string().max(40), ctaLabel: z.string().min(1).max(30) }),
  keywordCard: z.object({ title: z.string().min(1).max(80), body: z.string().max(300), ctaLabel: z.string().min(1).max(30) }),
  soloShare: z.object({ badge: z.string().max(30), ctaLabel: z.string().min(1).max(30), secondaryCtaLabel: z.string().min(1).max(30) }).optional(),
  duoInvite: z.object({ titleTemplate: z.string().min(1).max(120), bodyTemplate: z.string().max(400), ctaLabel: z.string().min(1).max(30) }).optional(),
  duoPartnerAnswered: z.object({ badge: z.string().max(30), ctaLabel: z.string().min(1).max(30) }).optional(),
  duoPairResult: z.object({ badge: z.string().max(30), rankLineTemplate: z.string().max(120), ctaLabel: z.string().min(1).max(30) }).optional(),
  duoReminder: z.object({ badge: z.string().max(30), headlineTemplate: z.string().min(1).max(120), ctaLabel: z.string().min(1).max(30) }).optional(),
  groupComplete: z.object({ badge: z.string().max(30), ctaLabel: z.string().min(1).max(30) }).optional(),
  groupUnlock: z.object({ headlineTemplate: z.string().min(1).max(120), ctaLabel: z.string().min(1).max(30) }).optional(),
  groupReminder: z.object({ badge: z.string().max(30), headlineTemplate: z.string().min(1).max(120), subText: z.string().max(200), ctaLabel: z.string().min(1).max(30) }).optional(),
  groupInvite: z.object({
    headerCompleteTemplate: z.string().min(1).max(120), headerIncompleteTemplate: z.string().min(1).max(120),
    body: z.string().max(300), ctaLabel: z.string().min(1).max(30), secondaryCtaLabel: z.string().min(1).max(30),
  }).optional(),
}).superRefine((copy, ctx) => {
  // เติมใน superRefine ของ QuizConfig แม่ (ดูข้อ 2) — ที่นี่ประกาศ shape อย่างเดียว
})
export type TemplateMessagesCopy = z.infer<typeof TemplateMessagesCopy>

export const TemplateCopy = z.object({
  brand: z.object({
    name: z.string().min(1).max(40),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  }),
  intro: z.object({ title: z.string().min(1).max(80), body: z.string().max(400), ctaLabel: z.string().min(1).max(30) }),
  friendGate: z.object({ title: z.string().min(1).max(80), body: z.string().max(400), ctaLabel: z.string().min(1).max(30) }),
  openInLine: z.object({ title: z.string().min(1).max(80), body: z.string().max(400) }),
  invite: z.object({ shareTitle: z.string().min(1).max(80), shareBodyTemplate: z.string().max(300) }).optional(),
  rewards: z.object({ milestones: z.array(RewardMilestone).default([]) }),
  messages: TemplateMessagesCopy,
})
export type TemplateCopy = z.infer<typeof TemplateCopy>
```

เพิ่มใน `QuizConfig` เดิม: `templateCopy: TemplateCopy.optional()` (field เสริม ตามแบบ `group`/
`replies`) พร้อม `superRefine` เพิ่มในก้อนเดิมของ `QuizConfig`:

- ถ้า `mode === 'duo'`: `templateCopy.invite` และ `templateCopy.messages.duoInvite`/
  `duoPartnerAnswered`/`duoPairResult` ต้องมีค่า (`required`) — ตรงกับกติกาที่สเปกต้นทางระบุ
  ("ถ้า mode !== 'solo' certain messages keys are required") แต่ระบุแม่นยำกว่าเดิมว่าคือฟิลด์ไหนบ้าง
- ถ้า `mode === 'solo'`: `templateMessages.soloShare` ต้องมีค่า
- ถ้า `group?.enabled === true`: `templateCopy.messages.groupComplete`/`groupUnlock`/`groupReminder`/
  `groupInvite` ต้องมีค่าทั้งหมด
- `templateCopy` เองเป็น optional ทั้งก้อน — กิจกรรมที่ยังไม่ตั้งค่าเทมเพลต (ยังไม่เคย export) จะ
  `templateCopy` เป็น `undefined` ได้ปกติ, **แต่ export จะปฏิเสธด้วยข้อความชัดเจนถ้า `templateCopy`
  ไม่มีหรือไม่ผ่าน validation ของกฎข้างบน** (§9)

หมายเหตุ error copy: ตามสเปกต้นทาง ("ErrorScreen รับ title/body ที่คำนวณมาแล้วเป็น props — การ map
error เป็น app-level logic ไม่ใช่ config") — จอ ErrorScreen เองไม่ผูกกับ `templateCopy` เลย มันรับ
`title`/`body` เป็น prop จากโค้ด route ที่เรียกมัน ซึ่ง map จาก error code → ข้อความ (โค้ด ไม่ใช่ config
— แต่ข้อความ fallback ตายตัวเพียงคำเดียวที่ไม่ผูกแคมเปญคือ `"เกิดข้อผิดพลาด"`/`"Something went
wrong"` เป็น label ทางเทคนิคล้วนๆ ตามข้อยกเว้นที่สเปกอนุญาตไว้)

### 4.2 `liff-template/lib/schema.ts` — schema ของไฟล์ config ที่ export ออกมา

```typescript
export const TEMPLATE_SCHEMA_VERSION = 1 as const

export const TemplateConfig = z.object({
  schemaVersion: z.literal(TEMPLATE_SCHEMA_VERSION),
  quiz: QuizConfig, // สำเนา shape เดียวกับ lib/quiz/schema.ts's QuizConfig เป๊ะ (รวม templateCopy ที่ตอนนี้ required แล้วในไฟล์ export)
})
export type TemplateConfig = z.infer<typeof TemplateConfig>
```

`liff-template/lib/config.ts` อ่าน `config/quiz.config.json` ตอน build (import แบบ static, ไม่ใช่
`fetch` ตอน runtime) แล้ว `TemplateConfig.parse(raw)` — ถ้า `schemaVersion` ไม่ตรง `1` (เช่น
ไฟล์เก่าจาก LineKit เวอร์ชันก่อนหน้าที่มี shape ต่าง หรือใหม่กว่าที่โค้ดนี้รู้จัก) โยน error ทันทีตอน
build/boot ด้วยข้อความ:

```
LIFF template config schemaVersion mismatch: config file is v${found}, this template code expects v${TEMPLATE_SCHEMA_VERSION}.
Re-export this campaign from LineKit, or update this template's code to match.
```

**ไม่พยายาม auto-migrate** — ชัดเจนกว่าและตรงกับหลักการ "no versioning/migration" ที่ LineKit ยึดอยู่
แล้ว: schemaVersion ที่นี่มีไว้ **บอกความไม่ตรงกันให้ชัด** ไม่ใช่แก้ให้อัตโนมัติ

## 5. Engine (vendored, pure)

`liff-template/lib/engine/quiz.ts` = สำเนา `lib/quiz/engine.ts` ทั้งไฟล์ (import path เปลี่ยนจาก
`./schema` เป็น `../schema` เท่านั้น): `scoreAnswers`, `dominantAxis` (solo type-code, MBTI-style ตาม
`poles`), `strongestAxis` (axis เดียวที่เด่นที่สุด สำหรับ duo/group), `validateAnswers`,
`resolveSolo`, `resolvePair` — **ตรงกับสเปกต้นทางทุกข้อโดยไม่ต้องเขียนใหม่**:
เดี่ยว = MBTI-style type-code เทียบ `results[].code` แบบไม่สนตัวพิมพ์เล็กใหญ่ ตกไป
`fallbackResultCode`; คู่ = `strongestAxis` ของแต่ละคนอิสระ แล้วเทียบ `results[].pair` แบบไม่เรียง
ลำดับ (unordered) ตกไป fallback เหมือนกัน

`liff-template/lib/engine/group.ts` = สำเนา `lib/quiz/groupEngine.ts` ทั้งไฟล์ (import path เดียวกัน
ที่ต้องแก้) — `axisCountsFromMembers`, `avgScoresFromMembers`, `matchesGroupCondition`,
`evaluateGroupArchetype` ตรงสเปกทุกเงื่อนไข (`hasAxes`+`hasMode`, `topAxes`+`topN`, `isBalanced`+
`dominantThreshold`, `maxDistinct`, `minMembersWithAxis`) รวมกฎ tier ประเมินจากใหญ่ไปเล็ก
non-fallback ก่อน fallback ทีหลัง

เทสต์: ก็อป `lib/quiz/engine.test.ts`/`lib/quiz/groupEngine.test.ts` มาทั้งชุด (import path เปลี่ยน) —
ยืนยันว่าสำเนาพฤติกรรมเหมือนต้นฉบับ 100% ไม่ใช่แค่ compile ผ่าน

## 6. Render layer — 12 message templates

`liff-template/lib/render/messages.ts` — แต่ละอันเป็น pure function
`(config: TemplateConfig['quiz'], data: <RuntimeData>) => FlexMessage`, ไม่แตะ DB/เน็ต/`process.env`:

| # | ฟังก์ชัน | ใช้ตอนไหน | RuntimeData (สิ่งที่มาจาก request/state ไม่ใช่ config) |
|---|---|---|---|
| 1 | `renderFollowMessage(cfg)` | follow event | — (ข้อความคงที่จาก `templateCopy.intro`) |
| 2 | `renderResultCard(cfg, { resultCode, shareUrl })` | ควิซจบ | `resultCode` ที่คำนวณแล้ว, ลิงก์แชร์ |
| 3 | `renderKeywordText(cfg)` | คีย์เวิร์ด — variant ข้อความล้วน | — |
| 4 | `renderKeywordCard(cfg, { liffUrl })` | คีย์เวิร์ด — variant การ์ดทั่วไป | ลิงก์เข้าเล่น |
| 5 | `renderKeywordCustom(cfg)` | คีย์เวิร์ด — escape hatch | อ่าน `cfg.templateCopy.messages.keywordCard.customFlexJson` (ฟิลด์ `z.unknown().optional()` — จุดเดียวที่ยอมรับ Flex JSON ดิบตามที่สเปกต้นทางต้องการ "escape hatch สำหรับเนื้อหาที่กำหนดเองได้เต็มที่") |
| 6 | `renderSoloShareCard(cfg, { resultCode })` | solo แชร์ผล | ผลที่คำนวณแล้ว |
| 7 | `renderDuoInviteCard(cfg, { myAxisId, shareUrl })` | duo ชวนบัดดี้ | axis เด่นของผู้ชวน (interpolate ชื่อแกนลง `titleTemplate`), ลิงก์เชิญ |
| 8 | `renderDuoPartnerAnsweredPush(cfg, { partnerName, partnerAxisId })` | duo แจ้งว่าคู่ตอบแล้ว | ชื่อ LINE ของคู่ (runtime, ไม่ใช่ config), axis ของคู่ |
| 9 | `renderDuoPairResultCard(cfg, { resultCode, heroImageUrl, rank })` | duo ผลคู่เต็ม | resultCode, hero image URL ที่ compose ไว้แล้ว (compositing ไม่ใช่หน้าที่ของ renderer นี้), rank |
| 10 | `renderDuoReminderPush(cfg, { hoursSinceInvite })` | duo เตือนยังไม่จับคู่ | ชั่วโมงที่ผ่านมา |
| 11 | `renderGroupCompletePush(cfg, { archetypeCode, memberCount })` | group ครบ | archetype ที่คำนวณแล้ว, จำนวนสมาชิก |
| 12 | `renderGroupUnlockPush(cfg, { archetypeCode })` | group ปลดล็อกสัญลักษณ์ใหม่ | archetype ที่ปลดล็อก |
|    | `renderGroupReminderPush(cfg, { currentMembers, remaining })` | group เตือนยังไม่ครบ | จำนวนปัจจุบัน/ที่ขาด |
|    | `renderGroupInviteCard(cfg, { members, maxMembers, archetypeCode })` | group ชวนคนเข้ากลุ่ม | รายชื่อ/axis สมาชิกปัจจุบัน (แต่ละ slot โชว์ axis art ของสมาชิกจริงหรือ "?" ถ้าว่าง), archetype ถ้าคำนวณได้แล้ว |

(รายการข้อ 12 มี 2 ฟังก์ชันเพิ่มเพราะ "group" ในสเปกต้นทางนับเป็น 4 เทมเพลตย่อย รวมกับอีก 11 หัวข้อ
เป็น 12 เทมเพลตตามที่ระบุไว้ — นับตามจำนวนพฤติกรรมการส่งจริง ไม่ใช่นับตามเลขหัวข้อ)

ทุก renderer: **ห้ามมีข้อความ/ภาพ default ที่ผูกกับแคมเปญใดแคมเปญหนึ่งฝังในโค้ด** — ทุกคำที่เห็นบนจอ
LINE มาจาก `cfg.templateCopy`/`cfg.results`/`cfg.group.archetypes` เท่านั้น (ป้องกันข้อผิดพลาดที่ 1 ของ
KimLIFF) ยกเว้น label ทางเทคนิคล้วน (เช่น placeholder "?" สำหรับ slot สมาชิกที่ว่าง)

Interpolation: ฟิลด์ชื่อลงท้าย `Template` (เช่น `titleTemplate`, `headlineTemplate`) รองรับ placeholder
`{axisName}`/`{hours}`/`{remaining}`/`{rank}` แทนที่ด้วย `String.prototype.replaceAll` ธรรมดา — ไม่ใช้
template engine ภายนอก (เกินความจำเป็น, เพิ่ม dependency โดยไม่มีเหตุผล)

เทสต์: หนึ่งไฟล์ `messages.test.ts` ต่อกลุ่ม (shared/solo/duo/group) ยืนยันว่า field ทุกตัวที่ป้อนเข้า
โผล่ในผลลัพธ์ตรงตำแหน่งที่ควร (ไม่ใช่แค่ "ไม่ throw")

## 7. หน้าจอ 12 จอ (screens)

ทุกจอเป็น React component ธรรมดา รับ props ตรง ๆ ไม่มี custom branding/CSS ซับซ้อน — ใช้ system font,
layout พื้นฐาน (flexbox), ไม่มี custom theme engine เทียบสี/ฟอนต์เอง (ยกเว้นสี `brand.primaryColor`
เดียวที่อ่านจาก config มาทาสี accent ได้ ถ้ามี)

| จอ | Props (มาจากไหน) | โหมดที่ใช้ |
|---|---|---|
| `Loading` | ไม่มี (spinner คงที่) | ทุกโหมด |
| `Intro` | `{ brand, intro }` จาก `templateCopy` | ทุกโหมด |
| `Invited` | `{ inviterDisplayName }` (runtime, จาก LIFF profile — ไม่ใช่ config), `{ invite }` จาก config; ถ้า group: `{ groupInfo: { memberCount, creatorName, currentArchetypeTitle? } }` | duo, group |
| `Question` | `{ question: QuizQuestion, onAnswer }` — หนึ่งข้อจาก `questions[]` ต่อครั้ง | ทุกโหมด |
| `Matching` | `{ axisCardImageUrlA, axisCardImageUrlB }` (มาจาก `axes[].imageUrl` ถ้ามี — ดูหมายเหตุ) | duo, group |
| `Summary` | `{ resultTitle, resultBody, resultImageUrl, history: PairOrGroupSummary[] }` จาก resolved result + `templateCopy` | ทุกโหมด |
| `PairResult` | `{ result, axisA, axisB, rank? }` ของคู่หนึ่งคู่ที่ระบุ | duo, group |
| `Rewards` | `{ milestones: RewardMilestone[], claimed: string[] }` | ทุกโหมด |
| `Group` | `{ members, maxMembers, archetype, onInvite }` | group เท่านั้น |
| `ErrorScreen` | `{ title, body }` — คำนวณมาแล้วจากโค้ด route ที่เรียก (ไม่ใช่ config) | ทุกโหมด |
| `FriendGate` | `{ friendGate }` จาก `templateCopy` | ทุกโหมด |
| `OpenInLine` | `{ openInLine }` จาก `templateCopy` | ทุกโหมด |

หมายเหตุ `axes[].imageUrl`: สเปกต้นทางระบุว่าจอ Matching "ต้องการภาพการ์ดของทั้งสองแกน" —
`lib/quiz/schema.ts`'s `QuizAxis` ปัจจุบันไม่มี `imageUrl` เลย จึงเพิ่มเป็นฟิลด์ optional ใหม่
`imageUrl: z.string().url().optional()` ใน `QuizAxis` (ส่วนของ §4.1) — ถ้าไม่ตั้งไว้ จอ Matching
แสดง placeholder เจนเนอริก (กรอบว่าง + ชื่อแกน ไม่ใช่ hardcode ภาพ)

### 7.1 การต่อจอเป็นแอปจริง

`liff-template/app/page.tsx` เป็น state machine ง่ายๆ (`useState<Screen>`) ไล่ตาม flow:
`Loading` → (เช็ค LIFF context ผ่าน `lib/liff/client.ts`) → `OpenInLine` ถ้าไม่ได้เปิดในแอป LINE →
`FriendGate` ถ้ายังไม่ได้เพิ่มเพื่อน → `Intro`/`Invited` → `Question` (วนตาม `questions[]`) →
(`Matching` ถ้า duo/group) → `Summary`/`PairResult`/`Group` → `Rewards`

`lib/liff/client.ts` เป็น thin wrapper: `isInClient()`, `getProfile()`, `isFriend()` — สไลซ์นี้ทำโหมด
solo ให้ครบสาย (ไม่ต้องเช็ค friend/profile จริงก็รันได้ ใช้ stub ที่ประกาศชัดว่าเป็น stub) ส่วน
duo/group ที่ต้องพึ่ง LIFF SDK จริง (`liff.init`, `liff.getProfile`) ทำเป็นโครงพร้อมคอมเมนต์ชี้จุดเสียบ
— ทดสอบได้แค่ระดับ unit (mock `@line/liff`) ไม่ใช่ end-to-end ในเบราว์เซอร์จริง (บันทึกไว้ใน §2 ว่า
เป็นสิ่งที่ยังไม่ทำในสไลซ์นี้)

## 8. Persistence ของเทมเพลต

Solo ไม่ต้องเก็บ state ข้ามอุปกรณ์ (คำนวณจากคำตอบที่ส่งมาตรงๆ ต่อ request) แต่ duo/group ต้องมี
ที่เก็บกลาง (รอคู่/รอสมาชิก) ข้ามอุปกรณ์จริง

```typescript
// liff-template/lib/store/types.ts
export interface Store {
  saveAnswers(participantId: string, answers: Answer[]): Promise<void>
  loadAnswers(participantId: string): Promise<Answer[] | null>
  createPair(inviterID: string, joinerID: string, scoresA: Record<string, number>, scoresB: Record<string, number>): Promise<{ pairId: string }>
  getPair(pairId: string): Promise<PairRecord | null>
  createGroup(creatorId: string, topAxis: string, axisScores: Record<string, number>): Promise<{ groupId: string }>
  joinGroup(groupId: string, participantId: string, topAxis: string, axisScores: Record<string, number>): Promise<void>
  getGroup(groupId: string): Promise<GroupRecord | null>
}
```

`liff-template/lib/store/fileStore.ts` — implementation เดียวที่ export ออกไปในสไลซ์นี้: เขียน/อ่าน
JSON ไฟล์เดียว (`.data/store.json`) ด้วย advisory lock ง่ายๆ (คิว in-process, ไม่รองรับ multi-instance
serverless จริงจัง — README ของเทมเพลตบอกตรงๆ ว่าเหมาะกับ dev/แคมเปญขนาดเล็กที่ deploy เครื่องเดียว/
container เดียว ถ้าจะรองรับ multi-instance ให้เขียน `Store` implementation ใหม่ต่อ Postgres/Redis เอง
โดยไม่ต้องแตะ engine/render/screens เลยเพราะทุกที่เรียกผ่าน interface เดียวกัน)

**สิ่งนี้ทำให้ "ready-to-run ทันที" เป็นจริง** โดยไม่เพิ่ม native dependency ที่มีปัญหา build บน
serverless (เช่น `better-sqlite3`) และไม่บังคับให้ต้องมี Postgres ก่อนถึงจะรันได้แม้แต่ครั้งแรก

## 9. กลไก Export (zip)

`lib/liffExport/assemble.ts`:
1. รับ `campaignId`/`activityId` → โหลด `activity.input_config` ผ่าน SQL ตรงๆ (ไม่ใช้
   `loadQuizActivity` เพราะฟังก์ชันนั้นเช็ค "live/published" ซึ่งไม่เกี่ยวกับ export — แอดมินต้อง
   export ควิซที่ยังไม่ publish ได้ด้วย) → `QuizConfig.parse(...)`
2. เช็ค `config.templateCopy` ครบตามกฎ §4.1 — ถ้าไม่ครบ คืน error พร้อมรายชื่อฟิลด์ที่ขาด (นำ
   ผู้ตั้งค่ากลับไปหน้า `template/page.tsx` ได้ตรงจุด ไม่ใช่ 500 หรือ export ไฟล์พังเงียบๆ)
3. อ่านทุกไฟล์ใต้ `liff-template/` แบบ recursive (`fs.readdirSync` ซ้ำ, ข้าม `node_modules`/`.next`/
   `.data`) เป็น `{ relativePath, content: Buffer }[]`
4. แทนที่ `config/quiz.config.sample.json` ด้วย `JSON.stringify({ schemaVersion: 1, quiz: config })`
   ที่ path เดียวกัน (`config/quiz.config.json` — เปลี่ยนชื่อไฟล์จาก `.sample.json` เป็น `.json` ตอน
   ประกอบ ไม่ใช่ตอน dev เทมเพลตเอง)
5. เขียน `package.json`'s `name` ให้ตรงกับ slug ของแคมเปญ (косметик แต่ช่วยแยกโปรเจกต์เวลามีหลายอัน)

`lib/liffExport/zip.ts` — `archiver('zip')` (เพิ่มเป็น dependency ใหม่ใน `package.json` ของ LineKit
เอง ไม่ใช่ของเทมเพลต) รับรายการไฟล์ในหน่วยความจำ → คืน `Readable` stream

`app/(admin)/campaigns/[id]/activities/[activityId]/quiz/export/route.ts` — `GET`, `requireRole`
เดียวกับหน้าจออื่นของแคมเปญนี้, เรียก `assemble` แล้ว pipe zip stream ออกเป็น response พร้อม
`Content-Disposition: attachment; filename="<slug>-liff-template.zip"`

## 10. หน้าแอดมิน — schema/admin parity

**ข้อผิดพลาดที่ 4 ของ KimLIFF** (จอ admin ตกรุ่นไม่ตรงกับ frontend ที่ถูกเขียนใหม่) ป้องกันเชิง
โครงสร้างด้วยเทสต์เดียว ไม่ใช่ระเบียบที่ต้องจำ:

`app/(admin)/campaigns/[id]/activities/[activityId]/quiz/template/TemplateCopyForm.test.tsx` มีเทสต์
`'ทุกฟิลด์ใน TemplateCopy มีอินพุตในฟอร์มนี้'` — เดิน key ของ `TemplateCopy.shape` แบบ recursive
(reflection บน Zod schema object ผ่าน `._def.shape()`) เทียบกับ `data-field="..."` attribute ที่ต้อง
ติดไว้บน input ทุกตัวใน `TemplateCopyForm.tsx` — ฟิลด์ไหนไม่มี `data-field` ตรงกัน เทสต์แดง (บังคับว่า
เพิ่มฟิลด์ใน schema ต้องเพิ่ม input ในฟอร์ม "ในคอมมิตเดียวกัน" ไม่งั้น CI แดง)

`liff-template/lib/render/messages.parity.test.ts` — เทสต์คู่กัน ฝั่งเทมเพลต: เดิน AST หยาบๆ ของ
`messages.ts` หา `cfg.templateCopy.xxx` ทุกจุดที่ถูกอ้างถึง เทียบกับ key ที่มีจริงใน `TemplateCopy`
schema (import จาก `../schema`) — ฟิลด์ที่ renderer อ้างถึงแต่ schema ไม่มี (พิมพ์ผิด/ลบ schema แต่ลืม
ลบโค้ดอ้างอิง) จะทำให้เทสต์แดงก่อนที่จะไปพังตอน runtime จริง

## 11. Error handling

| กรณี | ผลลัพธ์ |
|---|---|
| `templateCopy` ไม่มีค่าตอนกด export | 400 พร้อมข้อความ "ยังไม่ได้ตั้งค่าเทมเพลต — ไปที่แท็บ 'เทมเพลต' ก่อน" |
| `templateCopy` มีค่าแต่ไม่ครบตามกฎโหมด (§4.1) | 400 พร้อมรายชื่อฟิลด์ที่ขาด (Zod issues flatten แบบเดียวกับ `saveQuizConfigAction`) |
| กิจกรรมไม่ใช่ `personality_quiz` | 404 |
| `liff-template/` อ่านไฟล์ไม่ครบ (deploy ผิดพลาด ไฟล์หาย) | 500 — log path ที่หาไม่เจอ ไม่ปล่อย zip เสีย |
| เทมเพลต boot แล้ว `schemaVersion` ไม่ตรง | โยน error ตอน build/boot พร้อมข้อความบอกเวอร์ชันที่เจอ vs ที่ต้องการ (§4.2) — ไม่ crash เงียบ |

## 12. Testing

- **Unit** (`liff-template/lib/engine/*.test.ts`, `.../render/*.test.ts`, `.../store/*.test.ts`,
  `lib/liffExport/*.test.ts`) — รันผ่าน `npm test` เดิมของ LineKit (glob ครอบทั้ง repo อยู่แล้ว)
- **Component** (`liff-template/app/screens/*.test.tsx`) — React Testing Library เหมือน
  `components/cards/Preview.test.tsx` ของ LineKit เดิม ยืนยันแต่ละจอ render ข้อความ/รูปตรงจาก props
  ที่ป้อน ไม่มี hardcoded string ของแคมเปญใดแคมเปญหนึ่ง
- **Architecture** (`lib/architecture.test.ts` ขยาย `PURE_DIRS`) — กัน `liff-template/lib/engine`/
  `liff-template/lib/render` แตะ DB/เน็ต/`process.env`
- **Parity** (§10) — กันฟอร์มแอดมินตกรุ่นจาก schema, กัน renderer อ้างฟิลด์ที่ schema ไม่มี
- **Regression/snapshot** — `liff-template/lib/render/messages.test.ts` เทียบ shape ของ Flex JSON
  ที่ได้ด้วย `toEqual` ทั้งก้อน (ไม่ใช่ `toContain` บางส่วน) ตามธรรมเนียมเดิมของโปรเจกต์
  (`components/cards/Preview.tsx`'s comment เรื่องนี้)
- ก่อนถือว่าจบงาน: `npm run typecheck` + `npm test` (ทั้งชุดรวมของใหม่) เขียวหมด — integration test
  ของ export endpoint (`tests/quiz-export.integration.test.ts`) ยิงจริงผ่าน DB ทดสอบ ยืนยันว่า zip
  ที่ได้มี `config/quiz.config.json` ที่ parse ผ่าน `TemplateConfig` schema ของเทมเพลตจริง

## 13. ของที่ยังไม่รู้ / ความเสี่ยง

- `archiver` เป็น dependency ใหม่ที่ไม่มีใครใช้ในโปรเจกต์นี้มาก่อน — ความเสี่ยงต่ำ (ไลบรารีเสถียร ใช้
  กว้างขวาง) แต่เป็นจุดเดียวที่ทำให้ `npm audit`/bundle size ของ LineKit เองเปลี่ยน (ไม่กระทบเทมเพลตที่
  export ออกไป เพราะ `archiver` ไม่ได้อยู่ใน `liff-template/package.json`)
- `fileStore.ts` ไม่รองรับ multi-instance serverless (เช่น deploy บน Vercel ที่ scale เป็นหลาย instance
  พร้อมกัน) — เอกสารไว้ชัดใน README ของเทมเพลต ไม่ปิดบัง ถือเป็น trade-off ที่ยอมรับได้สำหรับ "internal
  tool ขนาดเล็ก" ตามโจทย์ ไม่ใช่ข้อบกพร่องที่ซ่อนไว้
- Hero-image compositing (การ์ด PairResult ต้องมีภาพผสมสองแกน) — สไลซ์นี้รับ `heroImageUrl` เป็น
  RuntimeData ที่คำนวณมาแล้ว (โค้ด compositing จริงยังไม่ทำ เพราะเป็นงาน image-processing แยกต่างหาก
  ที่ LineKit เองก็มีอยู่แล้วบางส่วนที่ `@napi-rs/canvas`, `components/richmenu/Compositor.tsx` — ทำเป็น
  สไลซ์ถัดไปที่พอร์ตแนวทางเดียวกันมาใช้กับภาพแกนคู่)
- LIFF SDK จริง (`@line/liff`) ยังไม่ได้ทดสอบ end-to-end ในเบราว์เซอร์ LINE จริง (§2) — ความเสี่ยงคือ
  พฤติกรรมจริงของ `liff.init()`/friend-gate อาจต่างจาก mock ที่ทดสอบไว้ ต้อง smoke-test มือก่อน deploy
  จริงครั้งแรกทุกครั้ง

## 14. อ้างอิง

- `lib/quiz/schema.ts`, `lib/quiz/engine.ts`, `lib/quiz/groupEngine.ts`, `lib/quiz/publicConfig.ts` —
  ต้นฉบับที่ vendor มา
- `docs/superpowers/specs/2026-08-24-native-quiz-engine-design.md`,
  `2026-08-25-quiz-group-mode-design.md` — การตัดสินใจที่สืบทอดมา (ตัด reward/formula/versioning)
- `lib/render/card.ts`, `lib/render/flex.ts` — แบบอย่าง pure-renderer pattern ที่ยึดโครงมาปรับใช้
- `lib/architecture.test.ts` — กลไก purity-guard ที่ขยายมาครอบเทมเพลต
- แผนลงมือ: `docs/superpowers/plans/2026-08-28-liff-template-export-core.md`
