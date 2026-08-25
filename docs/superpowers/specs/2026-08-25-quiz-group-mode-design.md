# Native Quiz Engine — Group Mode — Design

## 1. เป้าหมาย

`docs/superpowers/specs/2026-08-24-native-quiz-engine-design.md` (§2) ตั้งใจเว้น "โหมด group" ไว้เป็นสไลซ์ถัดไป
ตอนนี้ solo/duo เสร็จและ merge แล้ว ({สไลซ์นี้ต่อยอด — ดู `docs/superpowers/plans/2026-08-24-native-quiz-engine.md`)

เป้าหมายของสไลซ์นี้: ให้ผู้เล่นหลายคน (N ≥ 2) ที่ตอบควิซเดียวกันไปแล้ว รวมกันเป็น "กลุ่ม" แล้วได้ผลลัพธ์ระดับกลุ่ม
กลับมา — ผลลัพธ์กลุ่มพิจารณาจาก **องค์ประกอบของสมาชิก** (ใครแกนไหนกี่คน) ไม่ใช่แค่ผลรวมสุทธิแบบ duo

อ้างอิงหลัก: `~/Desktop/Codera/KimLIFF/laan-kijjakam` (`src/services/group.ts`, `src/routes/group.ts`,
`src/config/schema.ts`, `liff/src/screens/Group.tsx`) — พิสูจน์แล้วว่าใช้งานจริง พอร์ตเฉพาะส่วน
"คำนวณผลจากองค์ประกอบกลุ่ม" มา ตัดส่วนที่ผูกกับ reward/batch/symbol ออกทั้งหมด (ดู §2)

### เกณฑ์ว่าสำเร็จ (สไลซ์นี้)

ผู้ตั้งค่าเปิด "ผลลัพธ์กลุ่ม" ให้กิจกรรมควิซที่มีอยู่แล้ว (solo หรือ duo ก็ได้) ตั้ง archetype + เงื่อนไของค์ประกอบกลุ่ม
ผู้เล่นที่ตอบควิซแล้วสร้างกลุ่ม ได้ลิงก์เชิญ ส่งให้เพื่อนเปิดแล้วเข้ากลุ่มได้ทันที (หรือ creator เลือกคู่ duo ที่จับคู่
ไว้แล้วมาเติมเข้ากลุ่มโดยตรงก็ได้) — ทุกคนในกลุ่มเห็นผลลัพธ์กลุ่มที่คำนวณจากองค์ประกอบสมาชิกปัจจุบัน จนกว่าจะถึง
`resultLocksAt` แล้วผลจะหยุดนิ่ง

## 2. ขอบเขต

### อยู่ในสไลซ์นี้

- `group` เป็น field เสริมใน `QuizConfig` (`lib/quiz/schema.ts`) — **อิสระจาก `mode: 'solo'|'duo'`** ไม่ใช่ mode
  ที่สาม เปิดใช้ได้กับกิจกรรมโหมดไหนก็ได้ ขอแค่ผู้เล่นเคยตอบควิซ (`quiz_answer` มีแถว) เท่านั้น — ตรงกับ
  สถาปัตยกรรมจริงของ KimLIFF (`cfg.group.enabled` ไม่เช็ค mode เลย)
- การเข้ากลุ่ม 2 ทาง: (1) ลิงก์เชิญ (`?groupId=...` เหมือน pattern `shareUrl` ของ duo) ใครเปิดแล้วเคยตอบแล้ว
  เข้าได้ทันที (2) creator เลือกคู่ duo ที่จับคู่สำเร็จแล้ว (`quiz_pair`) มาเติมเข้ากลุ่มโดยตรง — ทางลัด ไม่ใช่ทางเดียว
- คะแนนสมาชิก **freeze ตอนเข้ากลุ่ม** (snapshot `top_axis`/`axis_scores` ลง `quiz_group_member`) — แก้คำตอบ
  หลังเข้ากลุ่มแล้วไม่มีผลย้อนหลังกับกลุ่มที่เข้าไปแล้ว ตรงกับพฤติกรรมเดิมของ `quiz_pair` (duo) ที่ freeze ตอน
  จับคู่สำเร็จเหมือนกัน
- ผลลัพธ์กลุ่ม: พอร์ต condition DSL เต็มจาก KimLIFF (`has_axes`/`has_mode`/`top_axes`/`top_n`/`is_balanced`/
  `dominant_threshold`/`min_members_with_axis`/`max_distinct`) จับกับ archetype ที่มี `min_group_size`/
  `max_group_size`/`fallback` ต่อ tier — ประเมินจากบนลงล่าง tier ใหญ่สุดที่เข้าเงื่อนไขก่อน
- `max_members` (hard cap เดียว), `min_members` (ต้องถึงก่อนถึงจะมีผลลัพธ์), `result_locks_at` (0 = ไม่ล็อก)
- API ฝั่ง LIFF: create/join/get/add-pairs — ใช้ auth เดิมของ LIFF platform (`resolveLiffParticipant`)
- หน้าแอดมินตั้งค่ากลุ่ม (archetype + เงื่อนไข) — ส่วนขยายของหน้าย่อยควิซที่มีอยู่แล้ว

### ไม่อยู่ในสไลซ์นี้ (ตัดตามที่สเปกเดิมกันไว้ + เหตุผลเพิ่มจากการอ่านโค้ดจริง)

- **Reward pool / claim ผูกกับกลุ่ม** — `claimGroupReward`/`reward_pool_id`/milestone ทั้งหมดของ KimLIFF ไม่พอร์ต
  มา ตรงกับที่สเปกเดิม §2 กันไว้แล้ว
- **`overflow_mode`/`batch_size` (rolling/creator_pick)** — มีไว้จัดคิว reward เป็นชุดเท่านั้น ไม่มี reward
  แล้วก็ไม่มีเหตุผลต้องมี — แทนที่ด้วย `max_members` เดียวเป็น hard cap ธรรมดา
- **`formula`/score mode** — สเปกเดิมระบุว่าเป็นโค้ดที่กรอกได้แต่ engine ไม่เคยอ่านค่าจริง (`group_weight` ใน
  comment ของ `computeScore` ไม่เคยถูกใช้จริง) — ยืนยันจากการอ่านโค้ดจริงในสไลซ์นี้ ไม่พอร์ต
- **`shareGroup`/symbol unlock/Team Builder** — คนละฟีเจอร์ ตัดตามสเปกเดิม
- **Config versioning/rollback** — เหมือน solo/duo เดิม ไม่ทำ

## 3. Schema การเปลี่ยนแปลง

### 3.1 ตารางใหม่ (migration ใหม่ ไม่แตะของเดิม)

```sql
CREATE TABLE quiz_group (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id            UUID NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
  created_by             UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  locked_archetype_code  TEXT,
  locked_at              TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- คะแนนของสมาชิกแต่ละคน "แช่แข็ง" ตอนเข้ากลุ่ม — เหมือน quiz_pair.scores ของ duo ทุกประการ
-- (คนละแนวคิดกับ quiz_answer ที่แก้ทีหลังได้เสมอ แต่ไม่มีผลย้อนหลังกับกลุ่มที่เข้าไปแล้ว)
CREATE TABLE quiz_group_member (
  group_id       UUID NOT NULL REFERENCES quiz_group(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  top_axis       TEXT NOT NULL,
  axis_scores    JSONB NOT NULL,
  joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, participant_id)
);
CREATE INDEX quiz_group_activity_idx ON quiz_group(activity_id);
CREATE INDEX quiz_group_member_participant_idx ON quiz_group_member(participant_id);
```

ไม่มี `status` column — ไม่มี reward/batch ให้ปิดสถานะ "เต็ม" เช็คจาก `COUNT(*) FROM quiz_group_member` เทียบ
`max_members` ตรงๆ ตอน join (เหมือนที่ `channels.integration` เคยเจอปัญหา count-ทั้งตาราง — ตรงนี้นับเฉพาะ
`group_id` ของตัวเอง ไม่ใช่ทั้งตาราง จึงไม่มีปัญหาแบบเดียวกัน)

### 3.2 ส่วนเพิ่มใน `lib/quiz/schema.ts`

`group` เป็น field เสริมใน `QuizConfig` เดิม (ไม่ใช่ mode ที่สาม):

```typescript
export const GroupCondition = z.object({
  hasAxes: z.array(z.string().min(1)).min(1).optional(),
  hasMode: z.enum(['any', 'all']).default('any'),
  topAxes: z.array(z.string().min(1)).min(1).optional(),
  topN: z.number().int().min(1).max(5).default(1),
  isBalanced: z.boolean().optional(),
  dominantThreshold: z.number().min(0.3).max(0.9).default(0.5),
  minMembersWithAxis: z.number().int().min(1).optional(),
  maxDistinct: z.number().int().min(1).max(6).optional(),
})
export type GroupCondition = z.infer<typeof GroupCondition>

export const GroupArchetype = z.object({
  code: z.string().min(1).max(30),
  title: z.string().min(1).max(120),
  body: z.string().max(600),
  imageUrl: z.string().url().optional(),
  minGroupSize: z.number().int().min(2).max(200).default(2),
  maxGroupSize: z.number().int().min(2).max(200).optional(),
  condition: GroupCondition.nullable().optional(),
  fallback: z.boolean().optional(),
})
export type GroupArchetype = z.infer<typeof GroupArchetype>

export const GroupConfig = z.object({
  enabled: z.boolean().default(false),
  minMembers: z.number().int().min(2).max(200).default(2),
  maxMembers: z.number().int().min(2).max(200).default(50),
  resultLocksAt: z.number().int().min(0).max(200).default(0),
  archetypes: z.array(GroupArchetype).min(1),
  fallbackArchetype: z.string().min(1),
}).superRefine((cfg, ctx) => {
  if (cfg.maxMembers < cfg.minMembers) {
    ctx.addIssue({ code: 'custom', path: ['maxMembers'], message: 'maxMembers ต้อง >= minMembers' })
  }
  if (!cfg.archetypes.some((a) => a.code === cfg.fallbackArchetype)) {
    ctx.addIssue({ code: 'custom', path: ['fallbackArchetype'], message: 'fallbackArchetype ต้องมีอยู่จริงใน archetypes' })
  }
  const tiers = [...new Set(cfg.archetypes.map((a) => a.minGroupSize))]
  for (const tier of tiers) {
    if (!cfg.archetypes.some((a) => a.minGroupSize === tier && a.fallback)) {
      ctx.addIssue({ code: 'custom', path: ['archetypes'], message: `min_group_size=${tier} ไม่มี fallback` })
    }
  }
})
export type GroupConfig = z.infer<typeof GroupConfig>
```

เพิ่มใน `QuizConfig` เดิม: `group: GroupConfig.optional()` — ไม่ตั้งค่าอะไรเลยแปลว่ากิจกรรมนี้ไม่มีโหมดกลุ่ม
(เหมือนพฤติกรรม optional field อื่นในระบบเดิม)

## 4. Group evaluation algorithm (พอร์ตจาก KimLIFF `group.ts` — `evaluateArchetype`/`matchesCondition`)

`lib/quiz/groupEngine.ts` — pure module ใหม่ (ห้ามแตะ DB/เน็ต/`process.env` เหมือน `lib/quiz/engine.ts`):

1. แต่ละสมาชิกมี `topAxis` (แกนเด่นที่สุด**แกนเดียว**ของตัวเอง จาก `strongestAxis` เดิมใน `lib/quiz/engine.ts`
   — ตัวเดียวกับที่ duo ใช้หา `axisA`/`axisB` ตอนจับคู่ ไม่ใช่ `dominantAxis` ที่คืน type-code รวมทุกแกน
   เพราะ `has_axes`/`top_axes` ด้านล่างต้องเทียบกับ **แกนเดียว** เช่น `"ei"` ไม่ใช่ type-code แบบ `"ES"`) และ
   `axisScores` ดิบ
2. `axisCountsFromMembers` — นับสมาชิกกี่คนที่ `topAxis` เป็นอะไรบ้าง → `Record<axisId, count>`
3. `normaliseScores` — แปลงคะแนนดิบของสมาชิกคนหนึ่งเป็นสัดส่วน (ค่าลบ clamp เป็น 0 ก่อน แล้วหารด้วยผลรวม รวม
   เป็น 1 ทุกแกน — ถ้าผลรวม (หลัง clamp) เป็น 0 คืนค่า 0 ทุกแกนแทน กันหารด้วยศูนย์)
4. `avgScoresFromMembers` — normalize คะแนนของทุกคนแล้วเฉลี่ยรวม → "โปรไฟล์กลุ่ม" (`Record<axisId, 0..1>`)
5. `matchesGroupCondition(cond, axisCounts, avgNorm)` — เช็คทุกเงื่อนไขที่ตั้งไว้ใน `cond` (ทุกอันที่ไม่ได้ตั้ง
   ข้าม) ต้องผ่านหมดถึงจะ true:
   - `hasAxes` + `hasMode`: `any` (มีอย่างน้อย 1 คนในแกนใดแกนหนึ่งของลิสต์) หรือ `all` (ทุกแกนในลิสต์ต้องมีคน)
   - `minMembersWithAxis` (มีความหมายเมื่อ `hasAxes` มีแกนเดียว): จำนวนคนในแกนนั้นต้อง >= ค่านี้
   - `topAxes` + `topN`: เอา `axisCounts` เรียงมากไปน้อย ตัดมา N อันดับแรก ต้องมีอย่างน้อย 1 แกนใน `topAxes` ซ้อนอยู่
   - `isBalanced` + `dominantThreshold`: ทุกแกนใน `avgNorm` ต้องน้อยกว่า threshold (ไม่มีแกนไหนครอง)
   - `maxDistinct`: จำนวนแกนที่มีคนอย่างน้อย 1 คนต้องไม่เกินค่านี้
6. `evaluateGroupArchetype(cfg, members)`:
   - `n = members.length`; ถ้า `n < cfg.group.minMembers` คืน `null`
   - กรอง archetype ที่ `minGroupSize <= n` และ (`maxGroupSize` ไม่ตั้งไว้ หรือ `>= n`)
   - เรียงจาก `minGroupSize` มากไปน้อย (tier เฉพาะเจาะจงกว่าก่อน)
   - ไล่หา non-fallback ตัวแรกที่ `condition` ตรง (ไม่มี `condition` = ไม่ match อัตโนมัติ ต้องมี condition ถึงจะ
     ถูกพิจารณาเป็น non-fallback) → เจอก่อนใช้ก่อน
   - ไม่เจอเลย → หา fallback ตัวแรกของ tier ที่กรองไว้ (เรียงมากไปน้อยเหมือนกัน)
   - ไม่มีเลย (schema กันไว้แล้วว่าทุก tier ต้องมี fallback แต่ tier ที่ `n` ตกไม่ถึงเลยเป็นไปได้) → `null`

## 5. Group flow

**สร้างกลุ่ม** `POST /api/liff/{liffId}/quiz/{activityCode}/group/create`:
1. `resolveLiffParticipant` → `participantId`
2. โหลด activity + `QuizConfig` (ผ่าน `loadQuizActivity` เดิม) — 404 ถ้าไม่มี `group.enabled`
3. โหลด `quiz_answer` ของ participant — 400 "ยังไม่ได้ตอบควิซ" ถ้าไม่มี
4. คำนวณ `topAxis`/`axisScores` (ใช้ `scoreAnswers`/`strongestAxis` เดิมจาก `lib/quiz/engine.ts` — ดู §4 ข้อ 1)
5. `INSERT quiz_group` + `INSERT quiz_group_member` (creator เป็นคนแรก) ในธุรกรรมเดียว
6. คืน `{ groupId, shareUrl: "{LIFF_URL}?groupId={groupId}&activityCode={code}" }`

**เข้ากลุ่มผ่านลิงก์** `POST /api/liff/{liffId}/quiz/{activityCode}/group/{groupId}/join`:
1. เหมือนขั้น 1-4 ของสร้างกลุ่ม
2. ถ้าเป็นสมาชิกอยู่แล้ว (`participant_id` มีแถวใน `quiz_group_member` ของ `groupId` นี้แล้ว) → คืน `{ ok: true }`
   เฉยๆ ไม่ insert ซ้ำ (idempotent)
3. นับสมาชิกปัจจุบัน — ถ้า `>= max_members` → 400 "กลุ่มนี้เต็มแล้ว"
4. `INSERT quiz_group_member`

**Creator เติมคู่ duo เข้ากลุ่ม** `POST /api/liff/{liffId}/quiz/{activityCode}/group/{groupId}/add-pairs`:
1. `resolveLiffParticipant` → ต้องเป็น `created_by` ของกลุ่มนี้ — 403 ถ้าไม่ใช่
2. รับ `{ pairIds: string[] }` — แต่ละ `pairId` โหลด `quiz_pair` ของ `activity_id` เดียวกัน หา "อีกฝ่าย" (ไม่ใช่
   creator) แล้วดึง `axisScores` จาก `quiz_pair.scores` (`.a` หรือ `.b` แล้วแต่ว่าอีกฝ่ายเป็นฝั่งไหน) จากนั้น
   คำนวณ `topAxis` ด้วย `strongestAxis(cfg, axisScores)` เดิม (`quiz_pair.scores` เก็บแค่คะแนนดิบ ไม่มี `topAxis`
   สำเร็จรูป — และต้องเป็น `strongestAxis` ไม่ใช่ `dominantAxis` ด้วยเหตุผลเดียวกับ §4 ข้อ 1)
3. ข้ามเงียบๆ ถ้า `pairId` ไม่มีจริง/คนละ activity/ไม่มีอีกฝ่ายอยู่ในนั้นจริง/เกิน `max_members` แล้ว/เป็นสมาชิกอยู่
   แล้ว — ไม่ throw ทั้งคำขอ
4. คืน `{ added: number }`

**ดูสถานะกลุ่ม** `GET /api/liff/{liffId}/quiz/{activityCode}/group/{groupId}`:
- คืน `{ groupId, totalMembers, minMembers, maxMembers, members: [{participantId, topAxis, joinedAt}],
  result: {code, title, body, imageUrl} | null, isLocked, amIMember, canJoin }`
- `result` เป็น `null` ถ้า `totalMembers < minMembers`
- ถ้า `resultLocksAt > 0` และ `totalMembers >= resultLocksAt`: ถ้ายังไม่เคย lock (`locked_archetype_code IS
  NULL`) → คำนวณครั้งเดียวแล้วบันทึก `locked_archetype_code`/`locked_at`; ถ้า lock แล้ว → คืน archetype ตาม
  `locked_archetype_code` ตรงๆ ไม่คำนวณใหม่ (เหมือน `quiz_pair.scores` ที่แช่แข็งแล้วไม่คำนวณซ้ำ)
- `canJoin = totalMembers < maxMembers && !amIMember`

## 6. Error handling

| กรณี | ผลลัพธ์ |
|---|---|
| กิจกรรมไม่มี `group.enabled` | 404 |
| create/join ทั้งที่ยังไม่เคยตอบควิซ | 400 พร้อมข้อความ "ยังไม่ได้ตอบควิซ" |
| join กลุ่มที่เต็มแล้ว | 400 "กลุ่มนี้เต็มแล้ว" |
| join ซ้ำ (เป็นสมาชิกอยู่แล้ว) | `{ ok: true }` — ไม่ error |
| add-pairs โดยไม่ใช่ creator | 403 |
| add-pairs ด้วย `pairId` ที่ไม่ตรง activity/creator/ซ้ำ/เต็มแล้ว | ข้ามรายการนั้นเงียบๆ ไม่ error ทั้งคำขอ |
| `groupId` ไม่มีจริง หรือคนละ activity | 404 |

## 7. หน้าแอดมิน

ขยาย `app/(admin)/campaigns/[id]/activities/[activityId]/quiz/QuizConfigForm.tsx` (แยกเป็น
`GroupArchetypeEditor.tsx` ถ้าไฟล์รวมยาวเกินไป — ตามเกณฑ์เดิมของโปรเจกต์เรื่องไฟล์ควรมีจุดประสงค์เดียว):

- Checkbox "เปิดใช้งานผลลัพธ์กลุ่ม" — เป็นอิสระจาก dropdown โหมด solo/duo ที่มีอยู่แล้ว
- เปิดแล้วโชว์: จำนวนสมาชิกขั้นต่ำ/สูงสุด, `resultLocksAt`
- รายการ archetype ต่อแถว: code/title/body/imageUrl, min/max group size, fallback checkbox, ตัวสร้างเงื่อนไข
  แบบเปิดทีละส่วน (checkbox คลุมแต่ละ field ของ `GroupCondition` — ไม่ตั้งเลยแปลว่า `condition: null` = ไม่ใช่
  non-fallback ที่ประเมินได้ ต้องมีอย่างน้อย 1 field ตั้งไว้ถ้าไม่ใช่ fallback)
- Validate ด้วย `GroupConfig` ผ่าน Server Action เดิม (`saveQuizConfigAction`) — ก้อนเดียวกับ `QuizConfig`

## 8. Testing

- `lib/quiz/groupEngine.test.ts` — unit test ทุก branch ของ §4: แต่ละ condition field แยกกัน, รวมกันหลาย field,
  tiering (min/max group size), fallback ต่อ tier, `n` ต่ำกว่า `minMembers` ทุก tier
- `lib/quiz/schema.test.ts` — เพิ่มเคส `GroupConfig`: `fallbackArchetype` ไม่มีจริง, tier ไม่มี fallback,
  `maxMembers < minMembers`
- `tests/quiz-groups.integration.test.ts` — DB จริง: create → join → freeze snapshot ถูกต้อง → แก้คำตอบหลังเข้า
  กลุ่มแล้วไม่กระทบสมาชิกที่ freeze ไปแล้ว → เต็ม `max_members` แล้ว join ไม่ได้ → `add-pairs` ดึงจาก `quiz_pair`
  ถูกต้อง + ข้ามรายการที่ไม่ถูกต้องเงียบๆ → lock ที่ `resultLocksAt` แล้วผลไม่เปลี่ยนตามคนเข้าใหม่
- `tests/quiz-liff-group-routes.integration.test.ts` — ยิง API เต็มเส้นทางผ่าน route handler โดยตรง (ตาม pattern
  เดิมของ `tests/quiz-liff-routes.integration.test.ts`) รวมยิง join พร้อมกันหลาย request ใกล้ `max_members`
  เพื่อยืนยันว่านับสมาชิกแบบกัน race ได้จริง (เทียบกับปัญหาที่ duo เคยเจอตอน survey)
- Regression: `npx tsc --noEmit` + `npx vitest run` เต็มชุด + `npx vitest run tests/*.integration.test.ts` +
  `npx next build` ก่อนถือว่าจบงาน (ตาม lesson จาก Task 12 ของสไลซ์ solo/duo)
