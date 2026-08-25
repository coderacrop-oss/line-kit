# Native Quiz Engine (solo/duo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LineKit the config owner and scoring engine for MBTI-style personality quizzes (solo + duo modes), with connected LIFFs acting only as thin render/submit clients.

**Architecture:** A new `personality_quiz` activity type sits alongside LineKit's existing `activity` system (none/pick_one/quiz/text) but bypasses its synchronous `resolve_method` engine entirely — it has its own scoring engine (`lib/quiz/engine.ts`), its own answer/pairing tables (`quiz_answer`, `quiz_pair`), and its own LIFF-facing API surface under `/api/liff/[liffId]/quiz/[activityCode]/...`, reusing the LIFF platform's existing dual-auth (`resolveLiffParticipant`) and `participant` identity.

**Tech Stack:** Next.js App Router, `postgres` tagged-template client, Zod, Vitest (unit + `tests/*.integration.test.ts` for real-DB tests).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-24-native-quiz-engine-design.md` — every task below implements one numbered section of it; read the relevant section before starting a task.
- Server Actions never throw/redirect across the boundary — return `ActionResult` (`lib/actions/result.ts`: `{ok:true} | {ok:false, message:string}`), matching every existing form in this codebase (`ChannelForm`, `LiffAppForm`, `ActionForm`).
- DB access goes through `db()` from `@/lib/db/client` (`Queryable` type), tagged-template SQL — never string-concatenate SQL.
- Multi-statement writes that must succeed or fail together use `sql.begin(async (tx) => { ... })` — existing precedent: `lib/cards/create.ts:301`, `lib/db/richmenu.ts:221`, `lib/db/card-imagemap.ts:172`.
- Unit tests: co-located `*.test.ts` next to the file, run by default `npx vitest run`. DB-integration tests (hit real Postgres): `tests/*.integration.test.ts`, run via `npx vitest run tests/*.integration.test.ts` (excluded from the default run) — existing examples: `tests/liff-platform.integration.test.ts`, `tests/activities.integration.test.ts`.
- Before any task is considered done: `npx tsc --noEmit`, `npx vitest run` (full unit suite), and for tasks touching admin pages also `npx next build` (this codebase has a known history of unit-tests-pass-but-production-build-fails bugs — see `lib/imagemap/generate.ts` split, done specifically to fix one).
- `activity.code` pattern: `/^[a-z0-9_]{1,20}$/` (`CODE_PATTERN` in `app/(admin)/campaigns/[id]/activities/actions.ts:16`). Postgres unique-violation code: `'23505'` (`UNIQUE_VIOLATION` constant, same file).
- LIFF auth: `resolveLiffParticipant(sql, liffId, request, body?)` from `@/lib/liff/auth` — returns `{ok:true, participantId, liffApp} | {ok:false, status:401|404, reason:string}`. `liffApp.channelId` is the LineKit `channel.id` UUID this LIFF is bound to.
- CORS: every LIFF-facing route must return `LIFF_CORS_HEADERS` (from `@/lib/liff/cors`) on every response and implement `OPTIONS` via `liffOptionsResponse()` — matches `app/api/liff/[liffId]/session/route.ts` exactly.
- Live-campaign-for-a-channel lookup (existing pattern, `lib/db/channels.ts:184-191`):
  ```sql
  SELECT cc.campaign_id FROM campaign_channel cc
   WHERE cc.channel_id = ${channelId} AND cc.is_published LIMIT 1
  ```

---

### Task 1: Migration — extend `activity`, add `quiz_answer` + `quiz_pair`

**Files:**
- Create: `supabase/migrations/0014_quiz_engine.sql`
- Test: `tests/db.integration.test.ts` (extend — this file already asserts on schema shape; add assertions for the new tables/constraint, following its existing style)

**Interfaces:**
- Produces: tables `quiz_answer(activity_id, participant_id, question_id, option_id, answered_at)` PK `(activity_id, participant_id, question_id)`; `quiz_pair(id, activity_id, participant_a, participant_b, result_code, scores, created_at)` UNIQUE `(activity_id, participant_a, participant_b)`, CHECK `participant_a <> participant_b`. `activity.input_type` CHECK now allows `'personality_quiz'`. `activity.resolve_method` is nullable, with a CHECK enforcing "NULL iff input_type = 'personality_quiz'".

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/0014_quiz_engine.sql

ALTER TABLE activity DROP CONSTRAINT activity_input_type_check;
ALTER TABLE activity ADD CONSTRAINT activity_input_type_check
  CHECK (input_type IN ('none','pick_one','quiz','text','personality_quiz'));

ALTER TABLE activity ALTER COLUMN resolve_method DROP NOT NULL;
ALTER TABLE activity DROP CONSTRAINT activity_resolve_method_check;
ALTER TABLE activity ADD CONSTRAINT activity_resolve_method_check
  CHECK (
    (input_type = 'personality_quiz' AND resolve_method IS NULL)
    OR (input_type <> 'personality_quiz' AND resolve_method IN ('fixed','weighted','quota','score','lookup'))
  );

CREATE TABLE quiz_answer (
  activity_id    UUID NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  question_id    TEXT NOT NULL,
  option_id      TEXT NOT NULL,
  answered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, participant_id, question_id)
);

CREATE TABLE quiz_pair (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id    UUID NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
  participant_a  UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  participant_b  UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  result_code    TEXT NOT NULL,
  scores         JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT no_self_pair CHECK (participant_a <> participant_b),
  UNIQUE (activity_id, participant_a, participant_b)
);
CREATE INDEX quiz_pair_participant_a_idx ON quiz_pair(participant_a);
CREATE INDEX quiz_pair_participant_b_idx ON quiz_pair(participant_b);
```

- [ ] **Step 2: Run the migration locally**

Run: `node scripts/migrate.mjs` (same script `npm run build` invokes — see Global Constraints; check `package.json` for the exact local-DB env var it expects before running, matching how every prior migration in this repo was applied)
Expected: migration applies with no error; `\d activity`, `\d quiz_answer`, `\d quiz_pair` in `psql` show the new shape.

- [ ] **Step 3: Extend `tests/db.integration.test.ts`**

Add assertions (matching the file's existing style — read it first) that: inserting an `activity` row with `input_type='personality_quiz', resolve_method=NULL` succeeds; inserting one with `input_type='personality_quiz', resolve_method='fixed'` fails the CHECK; inserting a `quiz_pair` row with `participant_a = participant_b` fails the CHECK.

- [ ] **Step 4: Run the integration test**

Run: `npx vitest run tests/db.integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0014_quiz_engine.sql tests/db.integration.test.ts
git commit -m "feat: add quiz_answer/quiz_pair tables, personality_quiz activity type"
```

---

### Task 2: `lib/quiz/schema.ts` — content config Zod schema

**Files:**
- Create: `lib/quiz/schema.ts`
- Test: `lib/quiz/schema.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces: `QuizAxis`, `QuizOption`, `QuizQuestion`, `QuizResultRule`, `QuizConfig` (Zod schemas) and their inferred TS types `QuizAxis`, `QuizOption`, `QuizQuestion`, `QuizResultRule`, `QuizConfig` (via `z.infer<...>`). Later tasks import `QuizConfig` and its type from this file.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/quiz/schema.test.ts
import { describe, expect, it } from 'vitest'
import { QuizConfig } from './schema'

const validConfig = {
  mode: 'solo' as const,
  axes: [
    { id: 'ei', label: 'E/I', poles: ['Extrovert', 'Introvert'] as [string, string] },
    { id: 'sn', label: 'S/N', poles: ['Sensing', 'Intuition'] as [string, string] },
  ],
  questions: [
    {
      id: 'q1', text: 'คำถามข้อ 1',
      options: [
        { id: 'q1_a', label: 'ตัวเลือก A', scores: { ei: 2, sn: -1 } },
        { id: 'q1_b', label: 'ตัวเลือก B', scores: { ei: -2, sn: 1 } },
      ],
    },
    {
      id: 'q2', text: 'คำถามข้อ 2',
      options: [
        { id: 'q2_a', label: 'ตัวเลือก A', scores: { ei: 1, sn: 1 } },
        { id: 'q2_b', label: 'ตัวเลือก B', scores: { ei: -1, sn: -1 } },
      ],
    },
    {
      id: 'q3', text: 'คำถามข้อ 3',
      options: [
        { id: 'q3_a', label: 'ตัวเลือก A', scores: { ei: 1, sn: -1 } },
        { id: 'q3_b', label: 'ตัวเลือก B', scores: { ei: -1, sn: 1 } },
      ],
    },
  ],
  results: [
    { code: 'ES', title: 'ผลลัพธ์ ES', body: 'รายละเอียด' },
    { code: 'EN', title: 'ผลลัพธ์ EN', body: 'รายละเอียด' },
    { code: 'IS', title: 'ผลลัพธ์ IS', body: 'รายละเอียด' },
    { code: 'IN', title: 'ผลลัพธ์ IN', body: 'รายละเอียด' },
  ],
  fallbackResultCode: 'ES',
}

describe('QuizConfig', () => {
  it('accepts a valid config', () => {
    expect(QuizConfig.safeParse(validConfig).success).toBe(true)
  })

  it('rejects duplicate axis ids', () => {
    const cfg = { ...validConfig, axes: [validConfig.axes[0], validConfig.axes[0]] }
    expect(QuizConfig.safeParse(cfg).success).toBe(false)
  })

  it('rejects an option that scores an axis id that does not exist', () => {
    const cfg = {
      ...validConfig,
      questions: [{
        id: 'q1', text: 'x',
        options: [
          { id: 'a', label: 'A', scores: { nope: 1 } },
          { id: 'b', label: 'B', scores: { ei: 1 } },
        ],
      }],
    }
    expect(QuizConfig.safeParse(cfg).success).toBe(false)
  })

  it('rejects a fallbackResultCode that has no matching result', () => {
    const cfg = { ...validConfig, fallbackResultCode: 'ZZ' }
    expect(QuizConfig.safeParse(cfg).success).toBe(false)
  })

  it('rejects duplicate result codes', () => {
    const cfg = { ...validConfig, results: [validConfig.results[0], validConfig.results[0]] }
    expect(QuizConfig.safeParse(cfg).success).toBe(false)
  })

  it('duo mode: rejects a non-catch-all result rule whose pair references an axis id that does not exist', () => {
    const cfg = {
      ...validConfig, mode: 'duo' as const,
      results: [
        { code: 'X', title: 't', body: 'b', pair: ['ei', 'nope'] as [string, string] },
        ...validConfig.results,
      ],
    }
    expect(QuizConfig.safeParse(cfg).success).toBe(false)
  })

  it('duo mode: accepts a result rule with no pair (catch-all)', () => {
    const cfg = { ...validConfig, mode: 'duo' as const }
    expect(QuizConfig.safeParse(cfg).success).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/quiz/schema.test.ts`
Expected: FAIL — `lib/quiz/schema.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/quiz/schema.ts
import { z } from 'zod'

export const QuizAxis = z.object({
  id: z.string().min(1).max(30),
  label: z.string().min(1).max(24),
  poles: z.tuple([z.string().max(24), z.string().max(24)]),
})
export type QuizAxis = z.infer<typeof QuizAxis>

export const QuizOption = z.object({
  id: z.string().min(1).max(30),
  label: z.string().min(1).max(60),
  scores: z.record(z.string(), z.number().int().min(-5).max(5)),
})
export type QuizOption = z.infer<typeof QuizOption>

export const QuizQuestion = z.object({
  id: z.string().min(1).max(30),
  text: z.string().min(1).max(140),
  options: z.array(QuizOption).min(2).max(6),
})
export type QuizQuestion = z.infer<typeof QuizQuestion>

export const QuizResultRule = z.object({
  code: z.string().min(1).max(30),
  title: z.string().min(1).max(120),
  body: z.string().max(600),
  imageUrl: z.string().url().optional(),
  pair: z.tuple([z.string(), z.string()]).optional(),
})
export type QuizResultRule = z.infer<typeof QuizResultRule>

export const QuizConfig = z.object({
  mode: z.enum(['solo', 'duo']),
  axes: z.array(QuizAxis).min(2).max(6),
  questions: z.array(QuizQuestion).min(3).max(10),
  results: z.array(QuizResultRule).min(2),
  fallbackResultCode: z.string().min(1),
}).superRefine((cfg, ctx) => {
  const axisIds = new Set(cfg.axes.map((a) => a.id))
  if (axisIds.size !== cfg.axes.length) {
    ctx.addIssue({ code: 'custom', path: ['axes'], message: 'axis id ซ้ำ' })
  }

  for (const [qi, q] of cfg.questions.entries()) {
    for (const [oi, opt] of q.options.entries()) {
      for (const scoredAxis of Object.keys(opt.scores)) {
        if (!axisIds.has(scoredAxis)) {
          ctx.addIssue({
            code: 'custom', path: ['questions', qi, 'options', oi, 'scores', scoredAxis],
            message: `option นี้อ้างแกน "${scoredAxis}" ที่ไม่มีอยู่จริง`,
          })
        }
      }
    }
  }

  const resultCodes = new Set(cfg.results.map((r) => r.code))
  if (resultCodes.size !== cfg.results.length) {
    ctx.addIssue({ code: 'custom', path: ['results'], message: 'result code ซ้ำ' })
  }

  if (!resultCodes.has(cfg.fallbackResultCode)) {
    ctx.addIssue({ code: 'custom', path: ['fallbackResultCode'], message: 'fallbackResultCode ต้องมีอยู่จริงใน results' })
  }

  if (cfg.mode === 'duo') {
    for (const [ri, rule] of cfg.results.entries()) {
      if (!rule.pair) continue
      for (const axisId of rule.pair) {
        if (!axisIds.has(axisId)) {
          ctx.addIssue({
            code: 'custom', path: ['results', ri, 'pair'],
            message: `result "${rule.code}" อ้างแกน "${axisId}" ที่ไม่มีอยู่จริง`,
          })
        }
      }
    }
  }
})
export type QuizConfig = z.infer<typeof QuizConfig>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/quiz/schema.test.ts`
Expected: PASS (7/7)

- [ ] **Step 5: Commit**

```bash
git add lib/quiz/schema.ts lib/quiz/schema.test.ts
git commit -m "feat: add QuizConfig zod schema for the native quiz engine"
```

---

### Task 3: `lib/quiz/engine.ts` — scoring algorithm

**Files:**
- Create: `lib/quiz/engine.ts`
- Test: `lib/quiz/engine.test.ts`

**Interfaces:**
- Consumes: `QuizConfig`, `QuizAxis`, `QuizQuestion` types from `./schema` (Task 2).
- Produces:
  - `type Answer = { questionId: string; optionId: string }`
  - `scoreAnswers(cfg: QuizConfig, answers: Answer[]): Record<string, number>` — per-axis totals, all axes present (0 default).
  - `dominantAxis(cfg: QuizConfig, scores: Record<string, number>): string` — the type-code string (concatenated first-letters-of-chosen-poles, per spec §5 step 2-3).
  - `resolveSolo(cfg: QuizConfig, answers: Answer[]): { resultCode: string; scores: Record<string, number>; usedFallback: boolean }`
  - `resolvePair(cfg: QuizConfig, answersA: Answer[], answersB: Answer[]): { resultCode: string; scoresA: Record<string,number>; scoresB: Record<string,number>; combined: Record<string,number>; axisA: string; axisB: string; usedFallback: boolean }` — `axisA`/`axisB` here are each side's own solo type-code (used by later tasks to show "your axis" vs "buddy's axis"), not the combined one.
  - `validateAnswers(cfg: QuizConfig, answers: Answer[]): string | null` — returns an error message (Thai, ready to surface to a player) if any question is unanswered or an answer references a non-existent option, else `null`.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/quiz/engine.test.ts
import { describe, expect, it } from 'vitest'
import { dominantAxis, resolvePair, resolveSolo, scoreAnswers, validateAnswers } from './engine'
import type { QuizConfig } from './schema'

const cfg: QuizConfig = {
  mode: 'duo',
  axes: [
    { id: 'ei', label: 'E/I', poles: ['E', 'I'] },
    { id: 'sn', label: 'S/N', poles: ['S', 'N'] },
  ],
  questions: [
    { id: 'q1', text: 'q1', options: [
      { id: 'q1_a', label: 'A', scores: { ei: 3, sn: 0 } },
      { id: 'q1_b', label: 'B', scores: { ei: -3, sn: 0 } },
    ] },
    { id: 'q2', text: 'q2', options: [
      { id: 'q2_a', label: 'A', scores: { ei: 0, sn: 2 } },
      { id: 'q2_b', label: 'B', scores: { ei: 0, sn: -2 } },
    ] },
    { id: 'q3', text: 'q3', options: [
      { id: 'q3_a', label: 'A', scores: { ei: 1, sn: 0 } },
      { id: 'q3_b', label: 'B', scores: { ei: -1, sn: 0 } },
    ] },
  ],
  results: [
    { code: 'ES', title: 'ES', body: 'b' },
    { code: 'EN', title: 'EN', body: 'b' },
    { code: 'IS', title: 'IS', body: 'b' },
    { code: 'IN', title: 'IN', body: 'b' },
    { code: 'ES-IN', title: 'pair', body: 'b', pair: ['ei', 'sn'] },
  ],
  fallbackResultCode: 'ES',
}

describe('scoreAnswers', () => {
  it('sums per-axis deltas from the chosen options, defaulting unanswered axes to 0', () => {
    const scores = scoreAnswers(cfg, [
      { questionId: 'q1', optionId: 'q1_a' }, // ei +3
      { questionId: 'q2', optionId: 'q2_b' }, // sn -2
      { questionId: 'q3', optionId: 'q3_a' }, // ei +1
    ])
    expect(scores).toEqual({ ei: 4, sn: -2 })
  })
})

describe('dominantAxis', () => {
  it('picks the first pole when a score is positive, second when negative, first on exact 0 (tiebreak)', () => {
    expect(dominantAxis(cfg, { ei: 4, sn: -2 })).toBe('ES')
    expect(dominantAxis(cfg, { ei: -4, sn: 2 })).toBe('IN')
    expect(dominantAxis(cfg, { ei: 0, sn: 0 })).toBe('ES')
  })
})

describe('validateAnswers', () => {
  it('rejects a missing question', () => {
    const err = validateAnswers(cfg, [{ questionId: 'q1', optionId: 'q1_a' }])
    expect(err).not.toBeNull()
  })
  it('rejects an option id that does not belong to its question', () => {
    const err = validateAnswers(cfg, [
      { questionId: 'q1', optionId: 'q2_a' },
      { questionId: 'q2', optionId: 'q2_a' },
      { questionId: 'q3', optionId: 'q3_a' },
    ])
    expect(err).not.toBeNull()
  })
  it('accepts a complete, valid answer set', () => {
    const err = validateAnswers(cfg, [
      { questionId: 'q1', optionId: 'q1_a' },
      { questionId: 'q2', optionId: 'q2_a' },
      { questionId: 'q3', optionId: 'q3_a' },
    ])
    expect(err).toBeNull()
  })
})

describe('resolveSolo', () => {
  it('resolves to the result whose code matches the computed type code', () => {
    const out = resolveSolo(cfg, [
      { questionId: 'q1', optionId: 'q1_a' },
      { questionId: 'q2', optionId: 'q2_a' },
      { questionId: 'q3', optionId: 'q3_a' },
    ])
    expect(out.resultCode).toBe('ES')
    expect(out.usedFallback).toBe(false)
  })

  it('falls back when no result matches the computed type code', () => {
    const cfgNoMatch: QuizConfig = { ...cfg, results: [{ code: 'ZZ', title: 'z', body: 'b' }], fallbackResultCode: 'ZZ' }
    const out = resolveSolo(cfgNoMatch, [
      { questionId: 'q1', optionId: 'q1_a' },
      { questionId: 'q2', optionId: 'q2_a' },
      { questionId: 'q3', optionId: 'q3_a' },
    ])
    expect(out.resultCode).toBe('ZZ')
    expect(out.usedFallback).toBe(true)
  })
})

describe('resolvePair', () => {
  it('combines both sides\' scores axis-by-axis and matches a pair rule against each side\'s own dominant axis', () => {
    const answersA = [
      { questionId: 'q1', optionId: 'q1_a' }, // A: ei +3
      { questionId: 'q2', optionId: 'q2_b' }, // A: sn -2  -> A axis "ES"
      { questionId: 'q3', optionId: 'q3_a' },
    ]
    const answersB = [
      { questionId: 'q1', optionId: 'q1_b' }, // B: ei -3
      { questionId: 'q2', optionId: 'q2_a' }, // B: sn +2  -> B axis "IN"
      { questionId: 'q3', optionId: 'q3_b' },
    ]
    const out = resolvePair(cfg, answersA, answersB)
    expect(out.axisA).toBe('ES')
    expect(out.axisB).toBe('IN')
    expect(out.resultCode).toBe('ES-IN')
    expect(out.combined).toEqual({ ei: 0, sn: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/quiz/engine.test.ts`
Expected: FAIL — `lib/quiz/engine.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/quiz/engine.ts
import type { QuizConfig } from './schema'

export type Answer = { questionId: string; optionId: string }

export function scoreAnswers(cfg: QuizConfig, answers: Answer[]): Record<string, number> {
  const scores: Record<string, number> = {}
  for (const axis of cfg.axes) scores[axis.id] = 0

  for (const answer of answers) {
    const question = cfg.questions.find((q) => q.id === answer.questionId)
    const option = question?.options.find((o) => o.id === answer.optionId)
    if (!option) continue
    for (const [axisId, delta] of Object.entries(option.scores)) {
      scores[axisId] = (scores[axisId] ?? 0) + delta
    }
  }
  return scores
}

/** ตามลำดับที่ประกาศแกนใน config เสมอ · v >= 0 เอนไปขั้วแรก (tiebreak ตายตัว) */
export function dominantAxis(cfg: QuizConfig, scores: Record<string, number>): string {
  return cfg.axes
    .map((axis) => {
      const v = scores[axis.id] ?? 0
      const pole = v >= 0 ? axis.poles[0] : axis.poles[1]
      return pole.charAt(0).toUpperCase()
    })
    .join('')
}

export function validateAnswers(cfg: QuizConfig, answers: Answer[]): string | null {
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]))
  for (const question of cfg.questions) {
    const given = byQuestion.get(question.id)
    if (!given) return `ยังไม่ได้ตอบคำถาม "${question.text}"`
    if (!question.options.some((o) => o.id === given.optionId)) {
      return `ตัวเลือกที่ส่งมาไม่ตรงกับคำถาม "${question.text}"`
    }
  }
  return null
}

function matchResult(
  cfg: QuizConfig, typeCode: string,
): { resultCode: string; usedFallback: boolean } {
  const hit = cfg.results.find((r) => r.code.toUpperCase() === typeCode.toUpperCase())
  return hit ? { resultCode: hit.code, usedFallback: false } : { resultCode: cfg.fallbackResultCode, usedFallback: true }
}

export function resolveSolo(
  cfg: QuizConfig, answers: Answer[],
): { resultCode: string; scores: Record<string, number>; usedFallback: boolean } {
  const scores = scoreAnswers(cfg, answers)
  const typeCode = dominantAxis(cfg, scores)
  return { ...matchResult(cfg, typeCode), scores }
}

function matchPair(
  cfg: QuizConfig, axisA: string, axisB: string,
): { resultCode: string; usedFallback: boolean } {
  const rules = cfg.results.filter((r) => r.code !== undefined)
  for (const rule of rules) {
    if (!rule.pair) return { resultCode: rule.code, usedFallback: false } // catch-all, first one wins
    const [x, y] = rule.pair
    const matches = (x === axisA && y === axisB) || (x === axisB && y === axisA)
    if (matches) return { resultCode: rule.code, usedFallback: false }
  }
  return { resultCode: cfg.fallbackResultCode, usedFallback: true }
}

export function resolvePair(
  cfg: QuizConfig, answersA: Answer[], answersB: Answer[],
): {
  resultCode: string; scoresA: Record<string, number>; scoresB: Record<string, number>
  combined: Record<string, number>; axisA: string; axisB: string; usedFallback: boolean
} {
  const scoresA = scoreAnswers(cfg, answersA)
  const scoresB = scoreAnswers(cfg, answersB)
  const axisA = dominantAxis(cfg, scoresA)
  const axisB = dominantAxis(cfg, scoresB)

  const combined: Record<string, number> = {}
  for (const axis of cfg.axes) combined[axis.id] = (scoresA[axis.id] ?? 0) + (scoresB[axis.id] ?? 0)

  const { resultCode, usedFallback } = matchPair(cfg, axisA, axisB)
  return { resultCode, scoresA, scoresB, combined, axisA, axisB, usedFallback }
}
```

Note on `matchPair`: `cfg.results` may contain rules with `pair` (duo-specific match rules) interleaved with entries that have no `pair` at all (catch-all, matches unconditionally, first one wins per spec §5). Iterate top-to-bottom exactly as authored — do not sort or filter by presence of `pair` before matching.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/quiz/engine.test.ts`
Expected: PASS (8/8)

- [ ] **Step 5: Commit**

```bash
git add lib/quiz/engine.ts lib/quiz/engine.test.ts
git commit -m "feat: add solo/duo scoring engine for native quiz (ported from KimLIFF, no group/legacy-flow)"
```

---

### Task 4: `lib/quiz/publicConfig.ts` — strip the answer key before it reaches a LIFF

**Files:**
- Create: `lib/quiz/publicConfig.ts`
- Test: `lib/quiz/publicConfig.test.ts`

**Interfaces:**
- Consumes: `QuizConfig` type from `./schema` (Task 2).
- Produces: `type PublicQuizConfig = { mode: 'solo'|'duo'; axes: {id:string; label:string}[]; questions: {id:string; text:string; options:{id:string; label:string}[]}[] }` and `toPublicQuizConfig(cfg: QuizConfig): PublicQuizConfig`.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/quiz/publicConfig.test.ts
import { describe, expect, it } from 'vitest'
import { toPublicQuizConfig } from './publicConfig'
import type { QuizConfig } from './schema'

const cfg: QuizConfig = {
  mode: 'solo',
  axes: [{ id: 'ei', label: 'E/I', poles: ['E', 'I'] }],
  questions: [{
    id: 'q1', text: 'q1',
    options: [{ id: 'a', label: 'A', scores: { ei: 3 } }],
  }],
  results: [{ code: 'E', title: 'title', body: 'secret answer key' }],
  fallbackResultCode: 'E',
}

describe('toPublicQuizConfig', () => {
  it('never includes results, option scores, poles, or fallbackResultCode', () => {
    const pub = toPublicQuizConfig(cfg)
    expect(pub).not.toHaveProperty('results')
    expect(pub).not.toHaveProperty('fallbackResultCode')
    expect(pub.axes[0]).not.toHaveProperty('poles')
    expect(pub.questions[0].options[0]).not.toHaveProperty('scores')
  })

  it('keeps the fields a player-facing screen needs', () => {
    const pub = toPublicQuizConfig(cfg)
    expect(pub).toEqual({
      mode: 'solo',
      axes: [{ id: 'ei', label: 'E/I' }],
      questions: [{ id: 'q1', text: 'q1', options: [{ id: 'a', label: 'A' }] }],
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/quiz/publicConfig.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/quiz/publicConfig.ts
import type { QuizConfig } from './schema'

export type PublicQuizConfig = {
  mode: 'solo' | 'duo'
  axes: { id: string; label: string }[]
  questions: { id: string; text: string; options: { id: string; label: string }[] }[]
}

export function toPublicQuizConfig(cfg: QuizConfig): PublicQuizConfig {
  return {
    mode: cfg.mode,
    axes: cfg.axes.map((a) => ({ id: a.id, label: a.label })),
    questions: cfg.questions.map((q) => ({
      id: q.id, text: q.text,
      options: q.options.map((o) => ({ id: o.id, label: o.label })),
    })),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/quiz/publicConfig.test.ts`
Expected: PASS (2/2)

- [ ] **Step 5: Commit**

```bash
git add lib/quiz/publicConfig.ts lib/quiz/publicConfig.test.ts
git commit -m "feat: add public quiz config projection (strips the answer key)"
```

---

### Task 5: `lib/db/quizAnswers.ts` — answer storage

**Files:**
- Create: `lib/db/quizAnswers.ts`
- Test: `tests/quiz-answers.integration.test.ts` (real DB — this module only does inserts/selects against `quiz_answer`, which references `activity`/`participant`; needs a real Postgres, matching how `tests/liff-sessions.integration.test.ts` tests `lib/db/liffSessions.ts`)

**Interfaces:**
- Consumes: `Queryable` from `@/lib/db/client` (existing). `Answer` type shape `{questionId:string; optionId:string}` (matches Task 3's `Answer` — this module is intentionally decoupled from `lib/quiz/engine.ts`, so it re-declares the same shape rather than importing it, since a DB-layer module should not depend on the scoring-engine module).
- Produces:
  - `saveQuizAnswers(sql: Queryable, activityId: string, participantId: string, answers: {questionId:string; optionId:string}[]): Promise<void>` — upserts every answer (`ON CONFLICT (activity_id, participant_id, question_id) DO UPDATE`).
  - `loadQuizAnswers(sql: Queryable, activityId: string, participantId: string): Promise<{questionId:string; optionId:string}[]>` — empty array if none.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/quiz-answers.integration.test.ts
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { loadQuizAnswers, saveQuizAnswers } from '@/lib/db/quizAnswers'

const sql = db()
let channelId: string
let campaignId: string
let activityId: string
let participantId: string

beforeAll(async () => {
  // ปรับตามลวดลายจริงของ tests/liff-sessions.integration.test.ts หรือ tests/activities.integration.test.ts
  // (สร้าง channel/campaign/activity/participant ขั้นต่ำที่ FK ต้องการ ก่อนรันเทสต์นี้)
})

afterAll(async () => {
  await sql`DELETE FROM activity WHERE id = ${activityId}`
  await sql`DELETE FROM channel WHERE id = ${channelId}`
  await sql.end()
})

describe('saveQuizAnswers / loadQuizAnswers', () => {
  it('round-trips answers', async () => {
    await saveQuizAnswers(sql, activityId, participantId, [
      { questionId: 'q1', optionId: 'a' },
      { questionId: 'q2', optionId: 'b' },
    ])
    const loaded = await loadQuizAnswers(sql, activityId, participantId)
    expect(loaded).toHaveLength(2)
    expect(loaded).toContainEqual({ questionId: 'q1', optionId: 'a' })
  })

  it('re-saving overwrites the previous answer for the same question (no completion lock)', async () => {
    await saveQuizAnswers(sql, activityId, participantId, [{ questionId: 'q1', optionId: 'a' }])
    await saveQuizAnswers(sql, activityId, participantId, [{ questionId: 'q1', optionId: 'b' }])
    const loaded = await loadQuizAnswers(sql, activityId, participantId)
    expect(loaded.filter((a) => a.questionId === 'q1')).toEqual([{ questionId: 'q1', optionId: 'b' }])
  })

  it('returns an empty array for a participant who never answered', async () => {
    const loaded = await loadQuizAnswers(sql, activityId, randomUUID())
    expect(loaded).toEqual([])
  })
})
```

Read `tests/liff-sessions.integration.test.ts` and `tests/activities.integration.test.ts` before filling in `beforeAll` — copy their exact pattern for creating a throwaway `channel`/`campaign`/`participant`/`activity` row (this repo already has helpers or inline SQL for this in those files; match whichever pattern they use, do not invent a new one).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quiz-answers.integration.test.ts`
Expected: FAIL — `lib/db/quizAnswers.ts` does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/db/quizAnswers.ts
import type { Queryable } from './client'

export type QuizAnswerInput = { questionId: string; optionId: string }

export async function saveQuizAnswers(
  sql: Queryable, activityId: string, participantId: string, answers: QuizAnswerInput[],
): Promise<void> {
  if (answers.length === 0) return
  const rows = answers.map((a) => ({
    activity_id: activityId, participant_id: participantId,
    question_id: a.questionId, option_id: a.optionId,
  }))
  await sql`
    INSERT INTO quiz_answer ${sql(rows, 'activity_id', 'participant_id', 'question_id', 'option_id')}
    ON CONFLICT (activity_id, participant_id, question_id)
    DO UPDATE SET option_id = EXCLUDED.option_id, answered_at = now()`
}

export async function loadQuizAnswers(
  sql: Queryable, activityId: string, participantId: string,
): Promise<QuizAnswerInput[]> {
  const rows = await sql<{ question_id: string; option_id: string }[]>`
    SELECT question_id, option_id FROM quiz_answer
     WHERE activity_id = ${activityId} AND participant_id = ${participantId}`
  return rows.map((r) => ({ questionId: r.question_id, optionId: r.option_id }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/quiz-answers.integration.test.ts`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add lib/db/quizAnswers.ts tests/quiz-answers.integration.test.ts
git commit -m "feat: add quiz_answer read/write"
```

---

### Task 6: `lib/db/quizPairs.ts` — duo pairing (transaction-safe)

**Files:**
- Create: `lib/db/quizPairs.ts`
- Test: `tests/quiz-pairs.integration.test.ts`

**Interfaces:**
- Consumes: `Queryable` (`@/lib/db/client`), `loadQuizAnswers`/`saveQuizAnswers` (Task 5), `resolvePair`/`Answer` from `@/lib/quiz/engine` (Task 3), `QuizConfig` (Task 2).
- Produces:
  - `type QuizPair = { id: string; activityId: string; participantA: string; participantB: string; resultCode: string; scores: { a: Record<string,number>; b: Record<string,number>; combined: Record<string,number> }; createdAt: Date }`
  - `findQuizPair(sql: Queryable, activityId: string, participantA: string, participantB: string): Promise<QuizPair | null>`
  - `matchQuizPair(sql: Queryable, cfg: QuizConfig, activityId: string, inviterParticipantId: string, bParticipantId: string, bAnswers: Answer[]): Promise<QuizPair>` — the whole "load A's answers, save B's answers, compute, insert" sequence inside one `sql.begin()`. Throws a plain `Error` with a Thai message if the inviter has no saved answers, or if `inviterParticipantId === bParticipantId`. **Idempotent**: if a `quiz_pair` for this exact `(activityId, inviterParticipantId, bParticipantId)` already exists, returns it unchanged without re-running the transaction (checked before opening the transaction, per spec §7).
  - `listQuizPairsForParticipant(sql: Queryable, activityId: string, participantId: string): Promise<QuizPair[]>` — every pair where the participant is `participant_a` or `participant_b`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/quiz-pairs.integration.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { findQuizPair, listQuizPairsForParticipant, matchQuizPair } from '@/lib/db/quizPairs'
import { saveQuizAnswers } from '@/lib/db/quizAnswers'
import type { QuizConfig } from '@/lib/quiz/schema'

const sql = db()
let activityId: string
let participantA: string
let participantB: string

const cfg: QuizConfig = {
  mode: 'duo',
  axes: [{ id: 'ei', label: 'E/I', poles: ['E', 'I'] }],
  questions: [{ id: 'q1', text: 'q1', options: [
    { id: 'a', label: 'A', scores: { ei: 3 } },
    { id: 'b', label: 'B', scores: { ei: -3 } },
  ] }],
  results: [{ code: 'EE', title: 't', body: 'b', pair: ['ei', 'ei'] }],
  fallbackResultCode: 'EE',
}

beforeAll(async () => {
  // สร้าง channel/campaign/activity/participant×2 ขั้นต่ำ — ตามลวดลายเดียวกับ Task 5
})

afterAll(async () => {
  await sql.end()
})

describe('matchQuizPair', () => {
  it('rejects when the inviter has not answered yet', async () => {
    await expect(matchQuizPair(sql, cfg, activityId, participantA, participantB, [
      { questionId: 'q1', optionId: 'a' },
    ])).rejects.toThrow()
  })

  it('rejects self-pairing', async () => {
    await saveQuizAnswers(sql, activityId, participantA, [{ questionId: 'q1', optionId: 'a' }])
    await expect(matchQuizPair(sql, cfg, activityId, participantA, participantA, [
      { questionId: 'q1', optionId: 'a' },
    ])).rejects.toThrow()
  })

  it('creates the pair, saves B\'s answers, and returns the computed result', async () => {
    const pair = await matchQuizPair(sql, cfg, activityId, participantA, participantB, [
      { questionId: 'q1', optionId: 'a' },
    ])
    expect(pair.resultCode).toBe('EE')
    expect(pair.participantA).toBe(participantA)
    expect(pair.participantB).toBe(participantB)

    const found = await findQuizPair(sql, activityId, participantA, participantB)
    expect(found?.id).toBe(pair.id)
  })

  it('is idempotent — matching the same pair again returns the same row, no duplicate', async () => {
    const first = await matchQuizPair(sql, cfg, activityId, participantA, participantB, [
      { questionId: 'q1', optionId: 'a' },
    ])
    const second = await matchQuizPair(sql, cfg, activityId, participantA, participantB, [
      { questionId: 'q1', optionId: 'a' },
    ])
    expect(second.id).toBe(first.id)
  })

  it('two concurrent match attempts for the same pair produce exactly one quiz_pair row', async () => {
    const [r1, r2] = await Promise.allSettled([
      matchQuizPair(sql, cfg, activityId, participantA, participantB, [{ questionId: 'q1', optionId: 'a' }]),
      matchQuizPair(sql, cfg, activityId, participantA, participantB, [{ questionId: 'q1', optionId: 'a' }]),
    ])
    expect(r1.status).toBe('fulfilled')
    expect(r2.status).toBe('fulfilled')
    const rows = await sql`SELECT id FROM quiz_pair WHERE activity_id = ${activityId}
      AND participant_a = ${participantA} AND participant_b = ${participantB}`
    expect(rows).toHaveLength(1)
  })
})

describe('listQuizPairsForParticipant', () => {
  it('finds a pair whether the participant is side A or side B', async () => {
    const asA = await listQuizPairsForParticipant(sql, activityId, participantA)
    const asB = await listQuizPairsForParticipant(sql, activityId, participantB)
    expect(asA.length).toBeGreaterThan(0)
    expect(asB.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quiz-pairs.integration.test.ts`
Expected: FAIL — `lib/db/quizPairs.ts` does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/db/quizPairs.ts
import { loadQuizAnswers, saveQuizAnswers } from './quizAnswers'
import type { Queryable } from './client'
import { resolvePair, type Answer } from '../quiz/engine'
import type { QuizConfig } from '../quiz/schema'

export type QuizPair = {
  id: string
  activityId: string
  participantA: string
  participantB: string
  resultCode: string
  scores: { a: Record<string, number>; b: Record<string, number>; combined: Record<string, number> }
  createdAt: Date
}

type QuizPairRow = {
  id: string; activity_id: string; participant_a: string; participant_b: string
  result_code: string; scores: QuizPair['scores']; created_at: Date
}

function toQuizPair(row: QuizPairRow): QuizPair {
  return {
    id: row.id, activityId: row.activity_id, participantA: row.participant_a, participantB: row.participant_b,
    resultCode: row.result_code, scores: row.scores, createdAt: row.created_at,
  }
}

const SELECT_COLUMNS = 'id, activity_id, participant_a, participant_b, result_code, scores, created_at'

export async function findQuizPair(
  sql: Queryable, activityId: string, participantA: string, participantB: string,
): Promise<QuizPair | null> {
  const [row] = await sql<QuizPairRow[]>`
    SELECT ${sql.unsafe(SELECT_COLUMNS)} FROM quiz_pair
     WHERE activity_id = ${activityId} AND participant_a = ${participantA} AND participant_b = ${participantB}`
  return row ? toQuizPair(row) : null
}

export async function listQuizPairsForParticipant(
  sql: Queryable, activityId: string, participantId: string,
): Promise<QuizPair[]> {
  const rows = await sql<QuizPairRow[]>`
    SELECT ${sql.unsafe(SELECT_COLUMNS)} FROM quiz_pair
     WHERE activity_id = ${activityId} AND (participant_a = ${participantId} OR participant_b = ${participantId})
     ORDER BY created_at DESC`
  return rows.map(toQuizPair)
}

/**
 * จับคู่ A+B ให้จริง — ห่อทั้งชุดใน transaction เดียว กัน race ที่ KimLIFF เจอตอน survey
 * (สอง request join พร้อมกันจับคู่ครึ่งๆ กลางๆ) idempotent เช็คก่อนเปิด transaction เสมอ
 */
export async function matchQuizPair(
  sql: Queryable, cfg: QuizConfig, activityId: string,
  inviterParticipantId: string, bParticipantId: string, bAnswers: Answer[],
): Promise<QuizPair> {
  if (inviterParticipantId === bParticipantId) {
    throw new Error('จับคู่กับตัวเองไม่ได้')
  }

  const existing = await findQuizPair(sql, activityId, inviterParticipantId, bParticipantId)
  if (existing) return existing

  return sql.begin(async (tx) => {
    const inviterAnswers = await loadQuizAnswers(tx, activityId, inviterParticipantId)
    if (inviterAnswers.length === 0) {
      throw new Error('ยังไม่มีคำตอบของผู้ชวน')
    }

    await saveQuizAnswers(tx, activityId, bParticipantId, bAnswers)
    const outcome = resolvePair(cfg, inviterAnswers, bAnswers)

    const [row] = await tx<QuizPairRow[]>`
      INSERT INTO quiz_pair (activity_id, participant_a, participant_b, result_code, scores)
      VALUES (
        ${activityId}, ${inviterParticipantId}, ${bParticipantId}, ${outcome.resultCode},
        ${tx.json({ a: outcome.scoresA, b: outcome.scoresB, combined: outcome.combined })}
      )
      ON CONFLICT (activity_id, participant_a, participant_b) DO UPDATE SET activity_id = EXCLUDED.activity_id
      RETURNING ${tx.unsafe(SELECT_COLUMNS)}`
    return toQuizPair(row)
  })
}
```

Note on the `ON CONFLICT ... DO UPDATE SET activity_id = EXCLUDED.activity_id` clause in the `INSERT`: this is a no-op update (sets a column to its own existing value) used specifically so the statement's `RETURNING` clause fires even when the unique constraint was already satisfied by a concurrent transaction that committed first — a plain `ON CONFLICT DO NOTHING` would return zero rows in that case, and the second concurrent caller would have nothing to return. This is what makes the "two concurrent match attempts" test in Step 1 both resolve successfully with the same row.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/quiz-pairs.integration.test.ts`
Expected: PASS (7/7)

- [ ] **Step 5: Commit**

```bash
git add lib/db/quizPairs.ts tests/quiz-pairs.integration.test.ts
git commit -m "feat: add transaction-safe duo pairing (quiz_pair)"
```

---

### Task 7: LIFF-facing API — public config + solo answer

**Files:**
- Create: `app/api/liff/[liffId]/quiz/[activityCode]/route.ts`
- Create: `app/api/liff/[liffId]/quiz/[activityCode]/solo/answer/route.ts`
- Create: `lib/quiz/loadActivity.ts` (shared helper — both this task and Task 8 need "resolve activityCode + this LIFF's channel into the activity row + parsed QuizConfig")
- Test: `tests/quiz-liff-routes.integration.test.ts`

**Interfaces:**
- Consumes: `resolveLiffParticipant` (`@/lib/liff/auth`), `LIFF_CORS_HEADERS`/`liffOptionsResponse` (`@/lib/liff/cors`), `db()` (`@/lib/db/client`), `QuizConfig`/schema (Task 2), `toPublicQuizConfig` (Task 4), `validateAnswers`/`resolveSolo` (Task 3), `saveQuizAnswers` (Task 5).
- Produces:
  - `lib/quiz/loadActivity.ts`: `loadQuizActivity(sql: Queryable, channelId: string, activityCode: string): Promise<{ id: string; config: QuizConfig } | null>` — resolves the channel's live campaign (see Global Constraints SQL), then the `activity` row in that campaign with matching `code` and `input_type = 'personality_quiz'`, parses `input_config` through `QuizConfig` (throws if a saved config somehow fails validation — that is a data-integrity bug, not a client error, so let it surface as a 500 rather than swallowing it).
  - `GET /api/liff/{liffId}/quiz/{activityCode}` → `{ config: PublicQuizConfig }`
  - `POST /api/liff/{liffId}/quiz/{activityCode}/solo/answer` body `{ answers: {questionId,optionId}[] }` → `{ resultCode, title, body, imageUrl, axisScores }` (title/body/imageUrl come from the matched `QuizResultRule`, not exposed anywhere else in this response until now — this is the one point where the private `results` array is legitimately read to build a response for the specific player who just earned that specific result).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/quiz-liff-routes.integration.test.ts
import { beforeAll, describe, expect, it } from 'vitest'
// Follow the exact fixture-setup pattern of tests/liff-platform.integration.test.ts:
// register a channel, a campaign published on it (campaign_channel.is_published = true),
// a liff_app bound to that channel, and an activity (input_type='personality_quiz',
// input_config = a valid QuizConfig JSON) in that campaign. Then exercise the routes
// with real fetch() calls against the Next.js route handlers (this repo's existing
// liff-platform integration tests call the route handlers directly by importing
// { GET, POST } from the route file and constructing a Request — match that pattern,
// do not spin up a real server).

describe('GET /api/liff/[liffId]/quiz/[activityCode]', () => {
  it('returns the public config with no answer key', async () => {
    // assert response.config has no `results`, no `scores`, no `poles`
  })
  it('returns 404 for an activityCode that does not exist in the channel\'s live campaign', async () => {})
})

describe('POST .../solo/answer', () => {
  it('returns a computed result for a complete answer set', async () => {})
  it('returns 422 for an incomplete answer set', async () => {})
  it('returns 401 with no Authorization header', async () => {})
})
```

Read `tests/liff-platform.integration.test.ts` in full before writing this — it already demonstrates the exact fixture setup (channel + liff_app + auth headers) this test needs, and the pattern for calling route handlers directly (importing `GET`/`POST` and building a `Request`) rather than starting a server.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quiz-liff-routes.integration.test.ts`
Expected: FAIL — routes don't exist.

- [ ] **Step 3: Write `lib/quiz/loadActivity.ts`**

```typescript
// lib/quiz/loadActivity.ts
import type { Queryable } from '../db/client'
import { QuizConfig } from './schema'

export async function loadQuizActivity(
  sql: Queryable, channelId: string, activityCode: string,
): Promise<{ id: string; config: QuizConfig } | null> {
  const [row] = await sql<{ id: string; input_config: unknown }[]>`
    SELECT a.id, a.input_config
      FROM activity a
      JOIN campaign_channel cc ON cc.campaign_id = a.campaign_id
     WHERE cc.channel_id = ${channelId} AND cc.is_published
       AND a.code = ${activityCode} AND a.input_type = 'personality_quiz'`
  if (!row) return null

  const parsed = QuizConfig.parse(row.input_config) // throws → surfaces as 500; a saved-but-invalid config is a bug, not a client error
  return { id: row.id, config: parsed }
}
```

- [ ] **Step 4: Write `app/api/liff/[liffId]/quiz/[activityCode]/route.ts`**

```typescript
// app/api/liff/[liffId]/quiz/[activityCode]/route.ts
import { db } from '@/lib/db/client'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from '@/lib/liff/cors'
import { resolveLiffParticipant } from '@/lib/liff/auth'
import { loadQuizActivity } from '@/lib/quiz/loadActivity'
import { toPublicQuizConfig } from '@/lib/quiz/publicConfig'

export async function GET(
  request: Request, { params }: { params: Promise<{ liffId: string; activityCode: string }> },
): Promise<Response> {
  const { liffId, activityCode } = await params
  const sql = db()
  const auth = await resolveLiffParticipant(sql, liffId, request)
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status, headers: LIFF_CORS_HEADERS })
  }

  const activity = await loadQuizActivity(sql, auth.liffApp.channelId, activityCode)
  if (!activity) {
    return Response.json({ error: 'ไม่พบควิซนี้' }, { status: 404, headers: LIFF_CORS_HEADERS })
  }

  return Response.json({ config: toPublicQuizConfig(activity.config) }, { headers: LIFF_CORS_HEADERS })
}

export async function OPTIONS(): Promise<Response> {
  return liffOptionsResponse()
}
```

- [ ] **Step 5: Write `app/api/liff/[liffId]/quiz/[activityCode]/solo/answer/route.ts`**

```typescript
// app/api/liff/[liffId]/quiz/[activityCode]/solo/answer/route.ts
import { db } from '@/lib/db/client'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from '@/lib/liff/cors'
import { resolveLiffParticipant } from '@/lib/liff/auth'
import { saveQuizAnswers } from '@/lib/db/quizAnswers'
import { resolveSolo, validateAnswers, type Answer } from '@/lib/quiz/engine'
import { loadQuizActivity } from '@/lib/quiz/loadActivity'

export async function POST(
  request: Request, { params }: { params: Promise<{ liffId: string; activityCode: string }> },
): Promise<Response> {
  const { liffId, activityCode } = await params
  const sql = db()

  let body: { answers?: Answer[] }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'อ่าน request body ไม่ได้ — ต้องเป็น JSON' }, { status: 400, headers: LIFF_CORS_HEADERS })
  }

  const auth = await resolveLiffParticipant(sql, liffId, request, {})
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status, headers: LIFF_CORS_HEADERS })
  }

  const activity = await loadQuizActivity(sql, auth.liffApp.channelId, activityCode)
  if (!activity) {
    return Response.json({ error: 'ไม่พบควิซนี้' }, { status: 404, headers: LIFF_CORS_HEADERS })
  }
  if (activity.config.mode !== 'solo') {
    return Response.json({ error: 'ควิซนี้เป็นโหมด duo ไม่ใช่ solo' }, { status: 400, headers: LIFF_CORS_HEADERS })
  }

  const answers = body.answers ?? []
  const validationError = validateAnswers(activity.config, answers)
  if (validationError) {
    return Response.json({ error: validationError }, { status: 422, headers: LIFF_CORS_HEADERS })
  }

  await saveQuizAnswers(sql, activity.id, auth.participantId, answers)
  const outcome = resolveSolo(activity.config, answers)
  const rule = activity.config.results.find((r) => r.code === outcome.resultCode)!

  return Response.json({
    resultCode: outcome.resultCode, title: rule.title, body: rule.body, imageUrl: rule.imageUrl,
    axisScores: outcome.scores,
  }, { headers: LIFF_CORS_HEADERS })
}

export async function OPTIONS(): Promise<Response> {
  return liffOptionsResponse()
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/quiz-liff-routes.integration.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/quiz/loadActivity.ts "app/api/liff/[liffId]/quiz/[activityCode]/route.ts" \
  "app/api/liff/[liffId]/quiz/[activityCode]/solo/answer/route.ts" tests/quiz-liff-routes.integration.test.ts
git commit -m "feat: add LIFF-facing quiz config + solo answer API"
```

---

### Task 8: LIFF-facing API — duo answer, match, my-pairs

**Files:**
- Create: `app/api/liff/[liffId]/quiz/[activityCode]/duo/answer/route.ts`
- Create: `app/api/liff/[liffId]/quiz/[activityCode]/duo/match/route.ts`
- Create: `app/api/liff/[liffId]/quiz/[activityCode]/duo/my-pairs/route.ts`
- Test: `tests/quiz-liff-duo-routes.integration.test.ts`

**Interfaces:**
- Consumes: everything Task 7 consumes, plus `matchQuizPair`/`listQuizPairsForParticipant`/`QuizPair` from `@/lib/db/quizPairs` (Task 6).
- Produces:
  - `POST .../duo/answer` body `{ answers: Answer[] }` → `{ shareUrl: string }` where `shareUrl = "{LIFF_URL}?inviterParticipantId={participantId}&activityCode={activityCode}"`. `LIFF_URL` here is `activity`'s own LIFF app's LIFF ID turned into a URL — reuse `auth.liffApp.liffId` to build `https://liff.line.me/{liffId}`, do not hardcode a domain.
  - `POST .../duo/match` body `{ inviterParticipantId: string, answers: Answer[] }` → `{ resultCode, title, body, imageUrl, axisMe, axisBuddy }` (title/body/imageUrl from the matched rule, `axisMe` = the calling participant's own dominant-axis code, `axisBuddy` = the inviter's).
  - `GET .../duo/my-pairs` → `{ pairs: { resultCode: string; title: string; asA: boolean; createdAt: string }[] }` (one entry per `QuizPair` the caller is in; `title` looked up from the activity's own `results` at request time — cheap, config is small and already loaded).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/quiz-liff-duo-routes.integration.test.ts
// Same fixture pattern as tests/quiz-liff-routes.integration.test.ts, but with a
// duo-mode activity and two distinct LINE users (two participants) authenticating
// via two different id_tokens (or API-key + X-Line-User-Id, matching how
// tests/liff-platform-idtoken.integration.test.ts exercises both auth paths).

describe('duo flow end to end', () => {
  it('A answers, gets a shareUrl containing their own participantId', async () => {})
  it('B matches against A\'s shareUrl and gets a combined result', async () => {})
  it('A can see the completed pair via GET my-pairs', async () => {})
  it('matching against an inviter who never answered returns 404', async () => {})
  it('matching against yourself returns 400', async () => {})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quiz-liff-duo-routes.integration.test.ts`
Expected: FAIL — routes don't exist.

- [ ] **Step 3: Write `duo/answer/route.ts`**

```typescript
// app/api/liff/[liffId]/quiz/[activityCode]/duo/answer/route.ts
import { db } from '@/lib/db/client'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from '@/lib/liff/cors'
import { resolveLiffParticipant } from '@/lib/liff/auth'
import { saveQuizAnswers } from '@/lib/db/quizAnswers'
import { validateAnswers, type Answer } from '@/lib/quiz/engine'
import { loadQuizActivity } from '@/lib/quiz/loadActivity'

export async function POST(
  request: Request, { params }: { params: Promise<{ liffId: string; activityCode: string }> },
): Promise<Response> {
  const { liffId, activityCode } = await params
  const sql = db()

  let body: { answers?: Answer[] }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'อ่าน request body ไม่ได้ — ต้องเป็น JSON' }, { status: 400, headers: LIFF_CORS_HEADERS })
  }

  const auth = await resolveLiffParticipant(sql, liffId, request, {})
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status, headers: LIFF_CORS_HEADERS })
  }

  const activity = await loadQuizActivity(sql, auth.liffApp.channelId, activityCode)
  if (!activity) {
    return Response.json({ error: 'ไม่พบควิซนี้' }, { status: 404, headers: LIFF_CORS_HEADERS })
  }
  if (activity.config.mode !== 'duo') {
    return Response.json({ error: 'ควิซนี้เป็นโหมด solo ไม่ใช่ duo' }, { status: 400, headers: LIFF_CORS_HEADERS })
  }

  const answers = body.answers ?? []
  const validationError = validateAnswers(activity.config, answers)
  if (validationError) {
    return Response.json({ error: validationError }, { status: 422, headers: LIFF_CORS_HEADERS })
  }

  await saveQuizAnswers(sql, activity.id, auth.participantId, answers)

  const shareUrl = `https://liff.line.me/${auth.liffApp.liffId}?inviterParticipantId=${auth.participantId}&activityCode=${activityCode}`
  return Response.json({ shareUrl }, { headers: LIFF_CORS_HEADERS })
}

export async function OPTIONS(): Promise<Response> {
  return liffOptionsResponse()
}
```

- [ ] **Step 4: Write `duo/match/route.ts`**

```typescript
// app/api/liff/[liffId]/quiz/[activityCode]/duo/match/route.ts
import { db } from '@/lib/db/client'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from '@/lib/liff/cors'
import { resolveLiffParticipant } from '@/lib/liff/auth'
import { matchQuizPair } from '@/lib/db/quizPairs'
import { dominantAxis, validateAnswers, type Answer } from '@/lib/quiz/engine'
import { loadQuizActivity } from '@/lib/quiz/loadActivity'

export async function POST(
  request: Request, { params }: { params: Promise<{ liffId: string; activityCode: string }> },
): Promise<Response> {
  const { liffId, activityCode } = await params
  const sql = db()

  let body: { inviterParticipantId?: string; answers?: Answer[] }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'อ่าน request body ไม่ได้ — ต้องเป็น JSON' }, { status: 400, headers: LIFF_CORS_HEADERS })
  }

  const auth = await resolveLiffParticipant(sql, liffId, request, {})
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status, headers: LIFF_CORS_HEADERS })
  }

  const activity = await loadQuizActivity(sql, auth.liffApp.channelId, activityCode)
  if (!activity) {
    return Response.json({ error: 'ไม่พบควิซนี้' }, { status: 404, headers: LIFF_CORS_HEADERS })
  }
  if (activity.config.mode !== 'duo') {
    return Response.json({ error: 'ควิซนี้เป็นโหมด solo ไม่ใช่ duo' }, { status: 400, headers: LIFF_CORS_HEADERS })
  }

  const inviterParticipantId = body.inviterParticipantId
  if (!inviterParticipantId) {
    return Response.json({ error: 'ต้องมี inviterParticipantId' }, { status: 400, headers: LIFF_CORS_HEADERS })
  }

  const answers = body.answers ?? []
  const validationError = validateAnswers(activity.config, answers)
  if (validationError) {
    return Response.json({ error: validationError }, { status: 422, headers: LIFF_CORS_HEADERS })
  }

  try {
    const pair = await matchQuizPair(sql, activity.config, activity.id, inviterParticipantId, auth.participantId, answers)
    const isCallerSideB = pair.participantB === auth.participantId
    // scores.a is always the inviter's own scores, scores.b is always the caller's (side B) —
    // see lib/db/quizPairs.ts's matchQuizPair. dominantAxis() is a pure function (Task 3), cheap
    // to recompute here rather than persisting the type-code strings redundantly on quiz_pair.
    const myScores = isCallerSideB ? pair.scores.b : pair.scores.a
    const buddyScores = isCallerSideB ? pair.scores.a : pair.scores.b
    const axisMe = dominantAxis(activity.config, myScores)
    const axisBuddy = dominantAxis(activity.config, buddyScores)
    const rule = activity.config.results.find((r) => r.code === pair.resultCode)!
    return Response.json({
      resultCode: pair.resultCode, title: rule.title, body: rule.body, imageUrl: rule.imageUrl,
      axisMe, axisBuddy,
    }, { headers: LIFF_CORS_HEADERS })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'จับคู่ไม่สำเร็จ'
    const status = message === 'ยังไม่มีคำตอบของผู้ชวน' ? 404 : 400
    return Response.json({ error: message }, { status, headers: LIFF_CORS_HEADERS })
  }
}

export async function OPTIONS(): Promise<Response> {
  return liffOptionsResponse()
}
```

- [ ] **Step 5: Write `duo/my-pairs/route.ts`**

```typescript
// app/api/liff/[liffId]/quiz/[activityCode]/duo/my-pairs/route.ts
import { db } from '@/lib/db/client'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from '@/lib/liff/cors'
import { resolveLiffParticipant } from '@/lib/liff/auth'
import { listQuizPairsForParticipant } from '@/lib/db/quizPairs'
import { loadQuizActivity } from '@/lib/quiz/loadActivity'

export async function GET(
  request: Request, { params }: { params: Promise<{ liffId: string; activityCode: string }> },
): Promise<Response> {
  const { liffId, activityCode } = await params
  const sql = db()
  const auth = await resolveLiffParticipant(sql, liffId, request)
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status, headers: LIFF_CORS_HEADERS })
  }

  const activity = await loadQuizActivity(sql, auth.liffApp.channelId, activityCode)
  if (!activity) {
    return Response.json({ error: 'ไม่พบควิซนี้' }, { status: 404, headers: LIFF_CORS_HEADERS })
  }

  const pairs = await listQuizPairsForParticipant(sql, activity.id, auth.participantId)
  const titleByCode = new Map(activity.config.results.map((r) => [r.code, r.title]))

  return Response.json({
    pairs: pairs.map((p) => ({
      resultCode: p.resultCode,
      title: titleByCode.get(p.resultCode) ?? p.resultCode,
      asA: p.participantA === auth.participantId,
      createdAt: p.createdAt.toISOString(),
    })),
  }, { headers: LIFF_CORS_HEADERS })
}

export async function OPTIONS(): Promise<Response> {
  return liffOptionsResponse()
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/quiz-liff-duo-routes.integration.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add "app/api/liff/[liffId]/quiz/[activityCode]/duo" tests/quiz-liff-duo-routes.integration.test.ts
git commit -m "feat: add LIFF-facing duo answer/match/my-pairs API"
```

---

### Task 9: Auto-generate `activity.code` (all activity types)

**Files:**
- Modify: `app/(admin)/campaigns/[id]/activities/actions.ts` (the create-activity action — read it in full first; it currently reads `code` from `formData` via `trimmed(formData, 'code')` and validates against `CODE_PATTERN`)
- Modify: `app/(admin)/campaigns/[id]/activities/page.tsx` (remove the "รหัสกิจกรรม" text input from the create form)
- Test: `app/(admin)/campaigns/[id]/activities/actions.test.ts` (extend existing)

**Interfaces:**
- Produces: `slugifyActivityName(name: string): string` (new exported helper, same file as the create action) — lowercases, replaces runs of non-`[a-z0-9]` with `_`, trims leading/trailing `_`, truncates to fit `CODE_PATTERN`'s `{1,20}` while leaving room for a numeric suffix.

- [ ] **Step 1: Write the failing test**

```typescript
// add to app/(admin)/campaigns/[id]/activities/actions.test.ts
import { slugifyActivityName } from './actions'

describe('slugifyActivityName', () => {
  it('lowercases and replaces spaces/punctuation with underscores', () => {
    expect(slugifyActivityName('สุ่มรางวัลประจำวัน')).toMatch(/^[a-z0-9_]{1,20}$/)
    expect(slugifyActivityName('Daily Draw!')).toBe('daily_draw')
  })

  it('produces a value matching CODE_PATTERN for a long name', () => {
    const slug = slugifyActivityName('a'.repeat(50))
    expect(slug.length).toBeLessThanOrEqual(20)
  })
})

describe('createActivity (auto-generated code)', () => {
  it('generates a unique code from the name when none is supplied, retrying once on collision', async () => {
    // mock the DB layer's insert to reject the first attempt with a UNIQUE_VIOLATION
    // (constructor shape matching the existing UNIQUE_VIOLATION handling in this file)
    // and succeed on a retried, suffixed code; assert the action does not surface the
    // collision as a user-facing error.
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "app/(admin)/campaigns/[id]/activities/actions.test.ts"`
Expected: FAIL — `slugifyActivityName` not exported yet.

- [ ] **Step 3: Implement**

Read the existing `createActivity` action (around line 150-190 of `actions.ts`, per the earlier grep) in full before editing. Add:

```typescript
// in app/(admin)/campaigns/[id]/activities/actions.ts

export function slugifyActivityName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 14) // เผื่อที่ให้ตัวเลขต่อท้ายได้ถึง 5 หลักโดยยังไม่เกิน 20 (CODE_PATTERN)
  return base || 'activity'
}
```

Then in the create-activity flow: stop reading `code` from `formData`; instead compute `const code = slugifyActivityName(name)` and attempt the insert; on `UNIQUE_VIOLATION`, retry once with `` `${code}_${Math.floor(Math.random() * 9000 + 1000)}` `` (four random digits) rather than surfacing the collision to the user — a person who names two activities the same thing should not have to know what a slug collision is. If the retried insert also collides (astronomically unlikely with a fresh random suffix — do not loop further), surface the existing "มีกิจกรรมรหัส ... อยู่แล้ว" error as a fallback.

In `page.tsx`, delete the "รหัสกิจกรรม (บังคับ)" `<Field>`/`<input name="code">` block entirely — the form no longer collects it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "app/(admin)/campaigns/[id]/activities/actions.test.ts"`
Expected: PASS

- [ ] **Step 5: Run the full unit suite + build (this touches a shared admin screen)**

Run: `npx vitest run && npx next build`
Expected: both clean — this change touches `page.tsx`, which `tests/design/landmarks.json` may reference (check `M7-S01` / any activities-related entry in that file per the pattern used for `LIFF-S01`/`LIFF-S02` — if the "รหัสกิจกรรม" input's text is a required landmark for that screen, update the landmark entry to match the new form, same way `LIFF-S02` was added in the quiz-engine spec's precedent work).

- [ ] **Step 6: Commit**

```bash
git add "app/(admin)/campaigns/[id]/activities/actions.ts" "app/(admin)/campaigns/[id]/activities/page.tsx" \
  "app/(admin)/campaigns/[id]/activities/actions.test.ts" tests/design/landmarks.json
git commit -m "feat: auto-generate activity code from its name instead of asking for it"
```

---

### Task 10: Admin — add `personality_quiz` to the create-activity form

**Files:**
- Modify: `lib/activities/wizard.ts` (add `'personality_quiz'` to `INPUT_TYPES`, give it a name, and make `fieldsFor`/`BY_INPUT` handle it — see note below)
- Modify: `lib/activities/wizard.test.ts` (extend the existing "all sixteen pairs" test — will need updating since this adds a fifth input type; read the test first)
- Modify: `app/(admin)/campaigns/[id]/activities/page.tsx` (when `personality_quiz` is selected, hide the "วิธีตัดสินผล" resolve-method selector and show a `mode: solo/duo` selector instead; on submit, route straight to the new quiz-config sub-screen from Task 11 instead of the generic wizard fields)
- Modify: `app/(admin)/campaigns/[id]/activities/actions.ts` (the create action: when `input_type === 'personality_quiz'`, write `resolve_method = NULL` and store `input_config = { mode }` — just the mode; axes/questions/results get filled in by the Task 11 sub-screen afterward)
- Test: extend `app/(admin)/campaigns/[id]/activities/actions.test.ts`

**Interfaces:**
- Consumes: `slugifyActivityName` (Task 9).
- Produces: `INPUT_TYPES` now includes `'personality_quiz'`; `inputTypeName('personality_quiz')` returns `'ควิซบุคลิกภาพ'`.

**Important — read before implementing:** `lib/activities/wizard.ts`'s whole design principle (its own header comment, quoted in this plan's Global Constraints research) is "the form is generated from the type definition, never hand-written per activity" (BR-87), and `fieldsFor(input, resolve)` is called with a **required** `ResolveMethod` — but `personality_quiz` has no `resolve_method` at all (Task 1's migration makes it `NULL` specifically for this type). Do not force a fake `resolve_method` value into `RESOLVE_METHODS` just to satisfy `fieldsFor`'s signature — that would violate BR-36's `comboProblem` invariant test (`isComboAllowed` is checked exhaustively for all input×resolve pairs elsewhere; adding a type that's secretly incompatible with every resolve method would need a `comboProblem` entry for all four, which is the wrong shape for "this type doesn't use resolve_method at all"). Instead: `personality_quiz` should be handled as a **special case at the call site** (`page.tsx`), branching *before* calling `fieldsFor`/`isComboAllowed` at all — those two functions keep their existing four-type signatures unchanged; `wizard.ts` only gains the `INPUT_TYPES` entry and its display name, not a new resolve-method-shaped code path. Re-read `wizard.test.ts`'s "sixteen pairs" test before touching this file: it will need to explicitly exclude `personality_quiz` from that combinatorial check (with a comment explaining why), not silently break.

- [ ] **Step 1: Write the failing test**

```typescript
// add to lib/activities/wizard.test.ts
it('personality_quiz has a display name but is excluded from the input×resolve combo matrix (no resolve_method applies to it)', () => {
  expect(inputTypeName('personality_quiz')).toBe('ควิซบุคลิกภาพ')
  expect(INPUT_TYPES).toContain('personality_quiz')
})
```

Also locate the existing "walks all sixteen pairs" test (per the file's header comment quoted in this plan's research) and update its input list to `INPUT_TYPES.filter((t) => t !== 'personality_quiz')` with a one-line comment explaining why, so the count assertion still matches reality.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/activities/wizard.test.ts`
Expected: FAIL — `personality_quiz` not in `INPUT_TYPES` yet.

- [ ] **Step 3: Implement**

In `lib/activities/wizard.ts`:
```typescript
export const INPUT_TYPES = ['none', 'pick_one', 'quiz', 'text', 'personality_quiz'] as const
```
and add `personality_quiz: 'ควิซบุคลิกภาพ'` to `INPUT_TYPE_NAME`. Do not add anything to `BY_INPUT`, `RESOLVE_METHODS`, `BY_RESOLVE`, or `comboProblem` — per the note above.

In `page.tsx`'s create-activity form: read the existing `<select name="input_type">`/`<select name="resolve_method">` block first. Add a client-side branch (this form likely already needs to be a client component or use a small client sub-component to react to the selected input type — check whether it already has one, e.g. for the existing conditional rendering, and follow that same mechanism) so that when `input_type === 'personality_quiz'` is selected: hide the `resolve_method` select entirely, and show a new `<select name="quiz_mode">` with options `solo`/`duo` in its place.

In `actions.ts`'s create-activity action: when `input_type === 'personality_quiz'`, skip the `resolve_method` validation/insert value entirely (pass `null`), read `quiz_mode` from the form (`'solo'|'duo'`, reject anything else with a clear error), and set `input_config` to `{ mode: quizMode }` on insert (not the generic wizard fields).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/activities/wizard.test.ts "app/(admin)/campaigns/[id]/activities/actions.test.ts"`
Expected: PASS

- [ ] **Step 5: Full regression + build**

Run: `npx vitest run && npx next build`
Expected: clean. Update `tests/design/landmarks.json` for this screen if the new `personality_quiz`/mode-selector text needs to be added as a landmark (same reasoning as Task 9 Step 5).

- [ ] **Step 6: Commit**

```bash
git add lib/activities/wizard.ts lib/activities/wizard.test.ts \
  "app/(admin)/campaigns/[id]/activities/page.tsx" "app/(admin)/campaigns/[id]/activities/actions.ts" \
  "app/(admin)/campaigns/[id]/activities/actions.test.ts" tests/design/landmarks.json
git commit -m "feat: add personality_quiz as a selectable activity type (mode instead of resolve_method)"
```

---

### Task 11: Admin — quiz content authoring sub-screen

**Files:**
- Create: `app/(admin)/campaigns/[id]/activities/[activityId]/quiz/page.tsx`
- Create: `app/(admin)/campaigns/[id]/activities/[activityId]/quiz/actions.ts`
- Create: `app/(admin)/campaigns/[id]/activities/[activityId]/quiz/QuizConfigForm.tsx` (client component — this form has enough dynamic add/remove-row behavior, per axes/questions/results, that it needs client state; follow the `ActionForm`/`LiffAppForm` pattern for the submit/error handling shell, same reasons documented in those files)
- Modify: `app/(admin)/campaigns/[id]/activities/ActivityRow.tsx` (when an activity's `input_type === 'personality_quiz'`, link to this sub-screen instead of the generic `activities/[activityId]` wizard screen)
- Test: `app/(admin)/campaigns/[id]/activities/[activityId]/quiz/actions.test.ts`

**Interfaces:**
- Consumes: `QuizConfig` schema (Task 2), `db()`/`Queryable`, `requireRole`, `ActionResult`.
- Produces: `saveQuizConfigAction(activityId: string, formData: FormData): Promise<ActionResult>` — parses the submitted form into a `QuizConfig` shape, validates through the Zod schema (Task 2), and on success `UPDATE activity SET input_config = ${cfg} WHERE id = ${activityId} AND input_type = 'personality_quiz'` (the `input_type` guard in the `WHERE` clause is deliberate — refuse to overwrite a differently-typed activity's config even if the id somehow mismatches what the URL implies).

- [ ] **Step 1: Write the failing test**

```typescript
// app/(admin)/campaigns/[id]/activities/[activityId]/quiz/actions.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let sessionRole: 'configurator' | 'content_editor' | null = 'configurator'
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => (sessionRole ? { userId: 'u1', role: sessionRole } : null),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const sqlMock = vi.fn()
vi.mock('@/lib/db/client', () => ({ db: () => sqlMock }))

const { saveQuizConfigAction } = await import('./actions')

beforeEach(() => { sessionRole = 'configurator'; sqlMock.mockReset() })
afterEach(() => { vi.clearAllMocks() })

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

describe('saveQuizConfigAction', () => {
  it('rejects a non-configurator', async () => {
    sessionRole = 'content_editor'
    const result = await saveQuizConfigAction('act-1', formData({ config: '{}' }))
    expect(result.ok).toBe(false)
  })

  it('rejects an invalid config with a specific validation message', async () => {
    const result = await saveQuizConfigAction('act-1', formData({
      config: JSON.stringify({ mode: 'solo', axes: [], questions: [], results: [], fallbackResultCode: 'x' }),
    }))
    expect(result.ok).toBe(false)
  })

  it('saves a valid config', async () => {
    sqlMock.mockResolvedValue(undefined)
    const validConfig = {
      mode: 'solo', axes: [{ id: 'a', label: 'A', poles: ['X', 'Y'] }],
      questions: [
        { id: 'q1', text: 't', options: [{ id: 'o1', label: 'o', scores: { a: 1 } }, { id: 'o2', label: 'o2', scores: { a: -1 } }] },
        { id: 'q2', text: 't', options: [{ id: 'o1', label: 'o', scores: { a: 1 } }, { id: 'o2', label: 'o2', scores: { a: -1 } }] },
        { id: 'q3', text: 't', options: [{ id: 'o1', label: 'o', scores: { a: 1 } }, { id: 'o2', label: 'o2', scores: { a: -1 } }] },
      ],
      results: [{ code: 'X', title: 't', body: 'b' }, { code: 'Y', title: 't', body: 'b' }],
      fallbackResultCode: 'X',
    }
    const result = await saveQuizConfigAction('act-1', formData({ config: JSON.stringify(validConfig) }))
    expect(result).toEqual({ ok: true })
  })
})
```

Decide the exact form-encoding approach before finalizing this test: given the config's nesting depth (axes → questions → options → per-axis scores, results → optional pair tuple), a flat `FormData` field-per-value encoding (the pattern every other form in this codebase uses) would need dozens of dynamically-named fields and a non-trivial reconstruction step. Prefer instead: `QuizConfigForm.tsx` builds the full `QuizConfig` object in client-side React state as the user edits it, and on submit sets a single hidden `<input name="config" value={JSON.stringify(state)}>` before calling the action — the action then does `JSON.parse(formData.get('config'))` and validates the whole thing through the Task 2 Zod schema in one shot. This is a deliberate exception to the flat-FormData convention used elsewhere in this codebase, justified by the config's nesting depth; note this explicitly in a comment in `QuizConfigForm.tsx` so a future reader does not "fix" it back to flat fields.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "app/(admin)/campaigns/[id]/activities/[activityId]/quiz/actions.test.ts"`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `actions.ts`**

```typescript
// app/(admin)/campaigns/[id]/activities/[activityId]/quiz/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { ZodError } from 'zod'
import type { ActionResult } from '@/lib/actions/result'
import { requireRole } from '@/lib/auth/require'
import { db } from '@/lib/db/client'
import { QuizConfig } from '@/lib/quiz/schema'

// ZodError.message เป็น JSON ดิบยาวๆ ไม่ใช่ข้อความให้คนอ่าน — ต่อ .issues เป็นบรรทัดเดียว
// อ่านง่ายแทน เหตุผลเดียวกับที่ทุกฟอร์มอื่นในระบบเขียน error message เองเป็นภาษาไทย
// ไม่ปล่อยให้ error ดิบหลุดไปหาคนกรอกฟอร์ม
const resultMessage = (err: unknown, fallback: string): string => {
  if (err instanceof ZodError) {
    return err.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' · ')
  }
  return err instanceof Error ? err.message : fallback
}

export async function saveQuizConfigAction(activityId: string, formData: FormData): Promise<ActionResult> {
  try {
    await requireRole('configurator')

    const raw = String(formData.get('config') ?? '')
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(raw)
    } catch {
      throw new Error('บันทึกไม่สำเร็จ — โครงสร้างข้อมูลเสีย ลองรีเฟรชหน้าแล้วแก้ใหม่')
    }

    const config = QuizConfig.parse(parsedJson) // throws ZodError with .issues on failure — caught below

    const sql = db()
    await sql`
      UPDATE activity SET input_config = ${sql.json(config)}
       WHERE id = ${activityId} AND input_type = 'personality_quiz'`

    revalidatePath(`/campaigns/[id]/activities/${activityId}/quiz`)
    return { ok: true }
  } catch (err) {
    return { ok: false, message: resultMessage(err, 'บันทึกไม่สำเร็จ — ลองใหม่') }
  }
}
```

- [ ] **Step 4: Write `QuizConfigForm.tsx` and `page.tsx`**

Build the editor UI: three repeating sections (axes, questions+options, results), each with add/remove-row controls in client state, following the visual conventions already established in `ActivitySetup.tsx` (`Field`, `Panel`, `Button`, `Note`, `BlockHead`-style section headers — read that file's UI composition before starting, it is the closest existing precedent for a multi-block activity-config form in this codebase). `page.tsx` loads the current `activity.input_config` (parse through `QuizConfig.safeParse`; if it fails — e.g. a still-empty `{mode: 'solo'}` from Task 10's creation step — start the editor from an empty-but-valid draft state with that `mode` and zero axes/questions/results, since the schema requires at least 2 axes/3 questions/2 results and a freshly-created activity has none of those yet).

- [ ] **Step 5: Modify `ActivityRow.tsx`**

Read the file first. Add a branch: if `activity.inputType === 'personality_quiz'`, the row's link target is `/campaigns/${campaignId}/activities/${activity.id}/quiz` instead of the existing `/campaigns/${campaignId}/activities/${activity.id}`.

- [ ] **Step 6: Run tests + build**

Run: `npx vitest run && npx next build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add "app/(admin)/campaigns/[id]/activities/[activityId]/quiz" "app/(admin)/campaigns/[id]/activities/ActivityRow.tsx"
git commit -m "feat: add quiz content authoring screen (axes/questions/results/mode)"
```

---

### Task 12: Whole-branch regression pass

**Files:** none new — verification only.

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Full unit suite**

Run: `npx vitest run`
Expected: all passing, including every test added in Tasks 1-11.

- [ ] **Step 3: Full integration suite** (needs a real Postgres — same one every other `*.integration.test.ts` in this repo already targets; do not skip this because it "needs a DB", every other slice in this codebase runs it)

Run: `npx vitest run tests/*.integration.test.ts`
Expected: all passing.

- [ ] **Step 4: Production build**

Run: `npx next build`
Expected: clean — this specifically catches the class of bug this codebase has hit before (server-only code leaking into a client bundle; see the `@napi-rs/canvas`/`lib/imagemap/generate.ts` split precedent referenced in Global Constraints) that neither `tsc` nor `vitest` catches.

- [ ] **Step 5: Manually verify the existing (untouched) activity types still work**

Open `/campaigns/[id]/activities` for a real campaign, confirm `none`/`pick_one`/`quiz`(trivia)/`text` × their resolve methods still create and save exactly as before Task 9/10's changes — the auto-generated-code and personality_quiz additions must be strictly additive.
