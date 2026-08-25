# Native Quiz Engine — Group Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let N≥2 players who already answered the same personality quiz (solo or duo activity) form a "group" and get back a result computed from the group's composition (who's dominant in which axis), not just a combined score.

**Architecture:** `group` is an optional block on the existing `QuizConfig` (`lib/quiz/schema.ts`), independent of `mode: 'solo'|'duo'` — it works on top of either. Two new tables (`quiz_group`, `quiz_group_member`) track membership; each member's axis scores are frozen (snapshotted) at join time, exactly like `quiz_pair.scores` is frozen at duo-match time. A new pure engine (`lib/quiz/groupEngine.ts`) ports KimLIFF's composition-based archetype-matching (condition DSL over axis distribution) from `~/Desktop/Codera/KimLIFF/laan-kijjakam/src/services/group.ts`. Four new LIFF-facing routes (create/join/get/add-pairs) reuse the existing LIFF auth/CORS/`loadQuizActivity` plumbing from the solo/duo slice.

**Tech Stack:** Next.js App Router, `postgres` tagged-template client, Zod, Vitest (unit + `tests/*.integration.test.ts` for real-DB tests) — same as the solo/duo slice this extends.

**Spec:** `docs/superpowers/specs/2026-08-25-quiz-group-mode-design.md` — every task below implements one numbered section of it; read the relevant section before starting a task. That spec itself extends `docs/superpowers/specs/2026-08-24-native-quiz-engine-design.md`.

## Global Constraints

- `topAxis` for any quiz participant/member is **always** computed with `strongestAxis(cfg, scores)` from `lib/quiz/engine.ts`, **never** `dominantAxis` — `dominantAxis` returns a compound type-code across *all* axes (e.g. `"ES"`), while `strongestAxis` returns a single axis id (e.g. `"ei"`). The group condition DSL (`hasAxes`, `topAxes`, etc.) compares against single axis ids only. Verified directly against KimLIFF's `buddyQuiz.ts`, whose `dominantAxis` is the single-axis-id function (LineKit's `strongestAxis` is its equivalent, added during the duo work) — see spec §4.
- Server Actions never throw/redirect across the boundary — return `ActionResult` (`lib/actions/result.ts`). `saveQuizConfigAction` (`app/(admin)/campaigns/[id]/activities/[activityId]/quiz/actions.ts`) already validates+saves the *whole* `QuizConfig` generically via `QuizConfig.parse` — it needs **no changes** for this slice, since `group` is just another optional field on the same schema.
- DB access goes through `db()` from `@/lib/db/client` (`Queryable` type = `postgres.Sql | postgres.TransactionSql`), tagged-template SQL — never string-concatenate SQL.
- Multi-statement writes that must succeed or fail together use `sql.begin(async (tx) => { ... })` — precedent: `lib/db/quizPairs.ts:80` (`matchQuizPair`).
- Concurrent-safe counting against a cap: lock the parent row with `SELECT ... FOR UPDATE` inside the transaction *before* counting — this plan introduces the pattern for `quiz_group` (no prior precedent in the quiz layer; `matchQuizPair`'s race-safety instead relies on a unique index, which doesn't apply here since there's no natural unique key to race on for "is the group full").
- Unit tests: co-located `*.test.ts` next to the file, run by default `npx vitest run`. DB-integration tests: `tests/*.integration.test.ts`, run via `npx vitest run tests/*.integration.test.ts` (excluded from the default run) — existing examples for this exact slice's conventions: `tests/quiz-pairs.integration.test.ts` (DB-layer fixture pattern), `tests/quiz-liff-duo-routes.integration.test.ts` (route-handler-import + `vi.mock('@/lib/db/client', ...)` pattern).
- Before any task is considered done: `npx tsc --noEmit` and `npx vitest run` (full unit suite).
- LIFF auth: `resolveLiffParticipant(sql, liffId, request)` from `@/lib/liff/auth` — returns `{ok:true, participantId, liffApp} | {ok:false, status:401|404, reason:string}`.
- CORS: every LIFF-facing route returns `LIFF_CORS_HEADERS` (from `@/lib/liff/cors`) on every response and implements `OPTIONS` via `liffOptionsResponse()`.
- `loadQuizActivity(sql, channelId, activityCode)` from `@/lib/quiz/loadActivity` already resolves + validates the activity (published campaign, enabled, in-window, `input_type = 'personality_quiz'`) and parses `input_config` into `QuizConfig` — it does **not** check `config.mode` or `config.group`, since group is orthogonal to mode. Every group route must separately check `activity.config.group?.enabled` and 404 if falsy.
- `activity.code` pattern / Postgres unique-violation code / campaign-live lookup SQL — unchanged from the original quiz-engine plan's Global Constraints; not touched by this slice.

---

### Task 1: Migration — `quiz_group` + `quiz_group_member`

**Files:**
- Create: `supabase/migrations/0015_quiz_group.sql`
- Modify: `package.json` (append the new migration to the `db:reset` chain)
- Modify: `scripts/check-schema-vs-doc.mjs` (register both new tables in `LOCAL_TABLES`)
- Test: `tests/db.integration.test.ts` (extend — this file already asserts on `quiz_pair`'s CHECK constraint in the same style)

**Interfaces:**
- Produces: tables `quiz_group(id, activity_id, created_by, locked_archetype_code, locked_at, created_at)`; `quiz_group_member(group_id, participant_id, top_axis, axis_scores, joined_at)` PK `(group_id, participant_id)`.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/0015_quiz_group.sql

CREATE TABLE quiz_group (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id            UUID NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
  created_by             UUID NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
  locked_archetype_code  TEXT,
  locked_at              TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

- [ ] **Step 2: Append the migration to `db:reset` and register the tables in `db:check`**

In `package.json`, the `db:reset` script is one long `&&`-chained string ending in
`... supabase/migrations/0014_quiz_engine.sql"`. Append, right before the closing quote:

```
 && psql -q -v ON_ERROR_STOP=1 -d linekit_test -f supabase/migrations/0015_quiz_group.sql
```

In `scripts/check-schema-vs-doc.mjs`, add two entries to the `LOCAL_TABLES` object (after the
existing `quiz_pair` entry, following that entry's exact comment style):

```javascript
  // Native Quiz Engine — Group Mode · กลุ่มที่สร้างขึ้น (ใครสร้าง) และสมาชิกแต่ละคนพร้อม
  // top_axis/axis_scores ที่แช่แข็งไว้ตอนเข้ากลุ่ม — schema จริงอยู่ที่
  // docs/superpowers/specs/2026-08-25-quiz-group-mode-design.md §3
  quiz_group: 'Native Quiz Engine Group Mode — groups players form on top of a quiz activity',
  quiz_group_member: 'Native Quiz Engine Group Mode — frozen per-member axis scores, snapshotted at join time',
```

- [ ] **Step 3: Run the migration locally**

Run: `npm run db:reset`
Expected: applies with no error (this rebuilds the whole `linekit_test` database from all 15 migrations in order).

- [ ] **Step 4: Extend `tests/db.integration.test.ts`**

Add this test inside the existing `describe('quiz engine schema', ...)` block, right after the
`'quiz_pair with participant_a = participant_b fails CHECK'` test:

```typescript
  it('quiz_group_member round-trips a frozen snapshot', async () => {
    const s = await seed(sql)
    const [group] = await sql<{ id: string }[]>`
      INSERT INTO quiz_group (activity_id, created_by) VALUES (${s.activityId}, ${s.participantIds[0]})
      RETURNING id`
    await sql`
      INSERT INTO quiz_group_member (group_id, participant_id, top_axis, axis_scores)
      VALUES (${group.id}, ${s.participantIds[0]}, 'ei', '{"ei":3,"sn":-1}'::jsonb)`
    const [member] = await sql<{ top_axis: string; axis_scores: Record<string, number> }[]>`
      SELECT top_axis, axis_scores FROM quiz_group_member WHERE group_id = ${group.id}`
    expect(member.top_axis).toBe('ei')
    expect(member.axis_scores).toEqual({ ei: 3, sn: -1 })
  })
```

`seed(sql)` (already imported at the top of this file from `./helpers/seed`) gives one `activityId`
and one `participantIds[0]` — see `tests/helpers/seed.ts` if you need to check its exact shape.

- [ ] **Step 5: Run the integration test**

Run: `npx vitest run tests/db.integration.test.ts`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 6: Run `db:check`**

Run: `npm run db:check`
Expected: `✅ ตรงกันทั้งหมด` — both new tables listed under "ข้ามการตรวจ" (skipped, documented in `LOCAL_TABLES`), 39 tables in the database total.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0015_quiz_group.sql package.json scripts/check-schema-vs-doc.mjs tests/db.integration.test.ts
git commit -m "feat: add quiz_group/quiz_group_member tables for group mode"
```

---

### Task 2: `lib/quiz/schema.ts` — `GroupCondition`/`GroupArchetype`/`GroupConfig`

**Files:**
- Modify: `lib/quiz/schema.ts`
- Test: `lib/quiz/schema.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: `GroupCondition`, `GroupArchetype`, `GroupConfig` (Zod schemas + inferred types), and adds an optional `group: GroupConfig.optional()` field to the existing `QuizConfig` schema. Task 3 (`groupEngine.ts`) and Task 4/5 (`lib/db/quizGroups.ts`) import `GroupArchetype`/`GroupConfig`/their types from this file.

- [ ] **Step 1: Write the failing test**

Add this to the end of `lib/quiz/schema.test.ts` (new `describe` block):

```typescript
describe('GroupConfig', () => {
  const validGroupConfig = {
    enabled: true,
    minMembers: 2,
    maxMembers: 10,
    resultLocksAt: 0,
    archetypes: [
      { code: 'balanced', title: 'สมดุล', body: 'ทุกแกนพอๆ กัน', minGroupSize: 2, condition: { isBalanced: true }, fallback: false },
      { code: 'mixed', title: 'ปนกัน', body: 'fallback', minGroupSize: 2, fallback: true },
    ],
    fallbackArchetype: 'mixed',
  }

  it('accepts a valid group config', () => {
    expect(GroupConfig.safeParse(validGroupConfig).success).toBe(true)
  })

  it('rejects when fallbackArchetype has no matching archetype code', () => {
    const cfg = { ...validGroupConfig, fallbackArchetype: 'nope' }
    expect(GroupConfig.safeParse(cfg).success).toBe(false)
  })

  it('rejects when a min_group_size tier has no fallback archetype', () => {
    const cfg = {
      ...validGroupConfig,
      archetypes: [
        { code: 'small', title: 't', body: 'b', minGroupSize: 2, fallback: false, condition: { isBalanced: true } },
        { code: 'big', title: 't', body: 'b', minGroupSize: 5, fallback: true },
      ],
      fallbackArchetype: 'big',
    }
    expect(GroupConfig.safeParse(cfg).success).toBe(false)
  })

  it('rejects maxMembers < minMembers', () => {
    const cfg = { ...validGroupConfig, minMembers: 10, maxMembers: 5 }
    expect(GroupConfig.safeParse(cfg).success).toBe(false)
  })

  it('accepts a full GroupCondition with every field set', () => {
    const cfg = {
      ...validGroupConfig,
      archetypes: [
        {
          code: 'full', title: 't', body: 'b', minGroupSize: 3, maxGroupSize: 20, fallback: false,
          condition: {
            hasAxes: ['ei'], hasMode: 'all' as const, topAxes: ['ei', 'sn'], topN: 2,
            isBalanced: true, dominantThreshold: 0.6, minMembersWithAxis: 2, maxDistinct: 3,
          },
        },
        { code: 'mixed', title: 'ปนกัน', body: 'fallback', minGroupSize: 2, fallback: true },
      ],
    }
    expect(GroupConfig.safeParse(cfg).success).toBe(true)
  })

  it('QuizConfig.group is optional — a config with no group field is still valid', () => {
    const cfg = {
      mode: 'solo' as const,
      axes: [{ id: 'ei', label: 'E/I', poles: ['E', 'I'] as [string, string] }],
      questions: [
        { id: 'q1', text: 'q1', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
        { id: 'q2', text: 'q2', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
        { id: 'q3', text: 'q3', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
      ],
      results: [{ code: 'E', title: 't', body: 'b' }, { code: 'I', title: 't', body: 'b' }],
      fallbackResultCode: 'E',
    }
    expect(QuizConfig.safeParse(cfg).success).toBe(true)
  })

  it('QuizConfig accepts group alongside duo mode', () => {
    const cfg = {
      mode: 'duo' as const,
      axes: [{ id: 'ei', label: 'E/I', poles: ['E', 'I'] as [string, string] }],
      questions: [
        { id: 'q1', text: 'q1', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
        { id: 'q2', text: 'q2', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
        { id: 'q3', text: 'q3', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
      ],
      results: [{ code: 'E', title: 't', body: 'b' }, { code: 'I', title: 't', body: 'b' }],
      fallbackResultCode: 'E',
      group: validGroupConfig,
    }
    expect(QuizConfig.safeParse(cfg).success).toBe(true)
  })
})
```

Add `GroupConfig` to the existing `import { QuizConfig } from './schema'` line at the top of the
test file (it currently imports only `QuizConfig` — change to `import { GroupConfig, QuizConfig } from './schema'`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/quiz/schema.test.ts`
Expected: FAIL — `GroupConfig` is not exported from `./schema` yet.

- [ ] **Step 3: Write the implementation**

Append to `lib/quiz/schema.ts`, after the existing `QuizConfig` block (after its closing
`export type QuizConfig = z.infer<typeof QuizConfig>` line):

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

Then add `group: GroupConfig.optional(),` as a new line inside the existing `QuizConfig` object
schema, right after `fallbackResultCode: z.string().min(1),` (before the closing `})`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/quiz/schema.test.ts`
Expected: PASS (all tests in the file, old and new)

- [ ] **Step 5: Commit**

```bash
git add lib/quiz/schema.ts lib/quiz/schema.test.ts
git commit -m "feat: add GroupCondition/GroupArchetype/GroupConfig to QuizConfig"
```

---

### Task 3: `lib/quiz/groupEngine.ts` — composition-based archetype matching

**Files:**
- Create: `lib/quiz/groupEngine.ts`
- Test: `lib/quiz/groupEngine.test.ts`

**Interfaces:**
- Consumes: `QuizConfig`, `GroupArchetype`, `GroupCondition` types from `./schema` (Task 2).
- Produces:
  - `type GroupMember = { topAxis: string; axisScores: Record<string, number> }`
  - `axisCountsFromMembers(members: GroupMember[]): Record<string, number>`
  - `avgScoresFromMembers(members: GroupMember[]): Record<string, number>`
  - `matchesGroupCondition(cond: GroupCondition, axisCounts: Record<string, number>, avgNorm: Record<string, number>): boolean`
  - `evaluateGroupArchetype(cfg: QuizConfig, members: GroupMember[]): GroupArchetype | null` — assumes `cfg.group` is present (caller's responsibility, same convention as `resolvePair` assuming `cfg.mode === 'duo'`); returns `null` if `members.length < cfg.group.minMembers`.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/quiz/groupEngine.test.ts
import { describe, expect, it } from 'vitest'
import { avgScoresFromMembers, axisCountsFromMembers, evaluateGroupArchetype, matchesGroupCondition } from './groupEngine'
import type { QuizConfig } from './schema'

const baseCfg: QuizConfig = {
  mode: 'solo',
  axes: [
    { id: 'ei', label: 'E/I', poles: ['E', 'I'] },
    { id: 'sn', label: 'S/N', poles: ['S', 'N'] },
  ],
  questions: [{ id: 'q1', text: 'q1', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] }],
  results: [{ code: 'E', title: 't', body: 'b' }],
  fallbackResultCode: 'E',
  group: {
    enabled: true, minMembers: 2, maxMembers: 50, resultLocksAt: 0,
    archetypes: [{ code: 'fallback', title: 't', body: 'b', minGroupSize: 2, fallback: true }],
    fallbackArchetype: 'fallback',
  },
}

const member = (topAxis: string, axisScores: Record<string, number>) => ({ topAxis, axisScores })

describe('axisCountsFromMembers', () => {
  it('counts how many members have each topAxis', () => {
    const counts = axisCountsFromMembers([member('ei', {}), member('ei', {}), member('sn', {})])
    expect(counts).toEqual({ ei: 2, sn: 1 })
  })
})

describe('avgScoresFromMembers', () => {
  it('normalises each member (clamping negatives to 0, summing to 1) then averages', () => {
    // member A: ei=4, sn=0 -> normalised {ei:1, sn:0}. member B: ei=0, sn=4 -> normalised {ei:0, sn:1}.
    // average: {ei: 0.5, sn: 0.5}
    const avg = avgScoresFromMembers([member('ei', { ei: 4, sn: 0 }), member('sn', { ei: 0, sn: 4 })])
    expect(avg.ei).toBeCloseTo(0.5)
    expect(avg.sn).toBeCloseTo(0.5)
  })

  it('a member whose raw scores sum to 0 (or all-negative) is left as-is rather than divide-by-zero', () => {
    const avg = avgScoresFromMembers([member('ei', { ei: 0, sn: 0 })])
    expect(avg).toEqual({ ei: 0, sn: 0 })
  })
})

describe('matchesGroupCondition', () => {
  it('hasAxes + hasMode "any": true if at least one listed axis has a member', () => {
    expect(matchesGroupCondition(
      { hasAxes: ['ei', 'sn'], hasMode: 'any', topN: 1, dominantThreshold: 0.5 },
      { ei: 1, foo: 3 }, {},
    )).toBe(true)
  })

  it('hasAxes + hasMode "all": false unless every listed axis has a member', () => {
    expect(matchesGroupCondition(
      { hasAxes: ['ei', 'sn'], hasMode: 'all', topN: 1, dominantThreshold: 0.5 },
      { ei: 1 }, {},
    )).toBe(false)
  })

  it('topAxes + topN: true if the group\'s top-N axes by member count overlap the list', () => {
    // axisCounts sorted desc: ei(5), sn(3), tf(1) — top 2 = [ei, sn]
    expect(matchesGroupCondition(
      { topAxes: ['sn'], topN: 2, hasMode: 'any', dominantThreshold: 0.5 },
      { ei: 5, sn: 3, tf: 1 }, {},
    )).toBe(true)
    expect(matchesGroupCondition(
      { topAxes: ['tf'], topN: 2, hasMode: 'any', dominantThreshold: 0.5 },
      { ei: 5, sn: 3, tf: 1 }, {},
    )).toBe(false)
  })

  it('isBalanced: true only if every axis average is below dominantThreshold', () => {
    expect(matchesGroupCondition(
      { isBalanced: true, hasMode: 'any', topN: 1, dominantThreshold: 0.5 },
      {}, { ei: 0.4, sn: 0.4 },
    )).toBe(true)
    expect(matchesGroupCondition(
      { isBalanced: true, hasMode: 'any', topN: 1, dominantThreshold: 0.5 },
      {}, { ei: 0.6, sn: 0.4 },
    )).toBe(false)
  })

  it('minMembersWithAxis: requires at least N members on that one axis', () => {
    expect(matchesGroupCondition(
      { hasAxes: ['ei'], hasMode: 'any', minMembersWithAxis: 3, topN: 1, dominantThreshold: 0.5 },
      { ei: 2 }, {},
    )).toBe(false)
    expect(matchesGroupCondition(
      { hasAxes: ['ei'], hasMode: 'any', minMembersWithAxis: 2, topN: 1, dominantThreshold: 0.5 },
      { ei: 2 }, {},
    )).toBe(true)
  })

  it('maxDistinct: caps the number of distinct axes present', () => {
    expect(matchesGroupCondition(
      { maxDistinct: 1, hasMode: 'any', topN: 1, dominantThreshold: 0.5 },
      { ei: 3, sn: 2 }, {},
    )).toBe(false)
    expect(matchesGroupCondition(
      { maxDistinct: 2, hasMode: 'any', topN: 1, dominantThreshold: 0.5 },
      { ei: 3, sn: 2 }, {},
    )).toBe(true)
  })

  it('a condition with every field unset matches unconditionally', () => {
    expect(matchesGroupCondition({ hasMode: 'any', topN: 1, dominantThreshold: 0.5 }, {}, {})).toBe(true)
  })
})

describe('evaluateGroupArchetype', () => {
  it('returns null when member count is below group.minMembers', () => {
    const cfg = { ...baseCfg, group: { ...baseCfg.group!, minMembers: 3 } }
    expect(evaluateGroupArchetype(cfg, [member('ei', {}), member('ei', {})])).toBeNull()
  })

  it('picks the highest min_group_size tier the group qualifies for, most-specific condition first', () => {
    const cfg: QuizConfig = {
      ...baseCfg,
      group: {
        enabled: true, minMembers: 2, maxMembers: 50, resultLocksAt: 0,
        fallbackArchetype: 'small-fallback',
        archetypes: [
          { code: 'small-fallback', title: 't', body: 'b', minGroupSize: 2, fallback: true },
          { code: 'big-special', title: 't', body: 'b', minGroupSize: 4, fallback: false, condition: { isBalanced: true, hasMode: 'any', topN: 1, dominantThreshold: 0.5 } },
          { code: 'big-fallback', title: 't', body: 'b', minGroupSize: 4, fallback: true },
        ],
      },
    }
    // 4 balanced members (ei/sn 50-50 each) — qualifies for the size-4 tier, matches big-special
    const members = [
      member('ei', { ei: 2, sn: 2 }), member('sn', { ei: 2, sn: 2 }),
      member('ei', { ei: 2, sn: 2 }), member('sn', { ei: 2, sn: 2 }),
    ]
    expect(evaluateGroupArchetype(cfg, members)?.code).toBe('big-special')
  })

  it('falls back to the fallback archetype of the highest qualifying tier when no condition matches', () => {
    const cfg: QuizConfig = {
      ...baseCfg,
      group: {
        enabled: true, minMembers: 2, maxMembers: 50, resultLocksAt: 0,
        fallbackArchetype: 'small-fallback',
        archetypes: [
          { code: 'small-fallback', title: 't', body: 'b', minGroupSize: 2, fallback: true },
          { code: 'big-special', title: 't', body: 'b', minGroupSize: 4, fallback: false, condition: { hasAxes: ['tf'], hasMode: 'any', topN: 1, dominantThreshold: 0.5 } },
          { code: 'big-fallback', title: 't', body: 'b', minGroupSize: 4, fallback: true },
        ],
      },
    }
    const members = [member('ei', {}), member('sn', {}), member('ei', {}), member('sn', {})]
    expect(evaluateGroupArchetype(cfg, members)?.code).toBe('big-fallback')
  })

  it('a non-fallback archetype with no condition is never matched (dead entry, same as KimLIFF)', () => {
    const cfg: QuizConfig = {
      ...baseCfg,
      group: {
        enabled: true, minMembers: 2, maxMembers: 50, resultLocksAt: 0,
        fallbackArchetype: 'fallback',
        archetypes: [
          { code: 'conditionless', title: 't', body: 'b', minGroupSize: 2, fallback: false },
          { code: 'fallback', title: 't', body: 'b', minGroupSize: 2, fallback: true },
        ],
      },
    }
    expect(evaluateGroupArchetype(cfg, [member('ei', {}), member('sn', {})])?.code).toBe('fallback')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/quiz/groupEngine.test.ts`
Expected: FAIL — `lib/quiz/groupEngine.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/quiz/groupEngine.ts
import type { GroupArchetype, GroupCondition, QuizConfig } from './schema'

export type GroupMember = { topAxis: string; axisScores: Record<string, number> }

export function axisCountsFromMembers(members: GroupMember[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const m of members) counts[m.topAxis] = (counts[m.topAxis] ?? 0) + 1
  return counts
}

/** Clamp negatives to 0, normalise to sum=1 · a member whose scores sum to 0 is left as-is (no div-by-zero) */
function normaliseScores(raw: Record<string, number>): Record<string, number> {
  const total = Object.values(raw).reduce((s, v) => s + Math.max(0, v), 0)
  if (total === 0) return raw
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Math.max(0, v) / total]))
}

export function avgScoresFromMembers(members: GroupMember[]): Record<string, number> {
  if (members.length === 0) return {}
  const sums: Record<string, number> = {}
  for (const m of members) {
    const norm = normaliseScores(m.axisScores)
    for (const [k, v] of Object.entries(norm)) sums[k] = (sums[k] ?? 0) + v
  }
  return Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, v / members.length]))
}

export function matchesGroupCondition(
  cond: GroupCondition, axisCounts: Record<string, number>, avgNorm: Record<string, number>,
): boolean {
  if (cond.hasAxes && cond.hasAxes.length > 0) {
    const present = cond.hasAxes.map((ax) => (axisCounts[ax] ?? 0) > 0)
    if (cond.hasMode === 'all' && !present.every(Boolean)) return false
    if (cond.hasMode === 'any' && !present.some(Boolean)) return false

    if (cond.minMembersWithAxis !== undefined && cond.hasAxes.length === 1) {
      if ((axisCounts[cond.hasAxes[0]] ?? 0) < cond.minMembersWithAxis) return false
    }
  }

  if (cond.topAxes && cond.topAxes.length > 0) {
    const sorted = Object.entries(axisCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, cond.topN)
      .map(([ax]) => ax)
    if (!cond.topAxes.some((ax) => sorted.includes(ax))) return false
  }

  if (cond.isBalanced === true) {
    if (!Object.values(avgNorm).every((v) => v < cond.dominantThreshold)) return false
  }

  if (cond.maxDistinct !== undefined) {
    const distinctCount = Object.keys(axisCounts).filter((ax) => (axisCounts[ax] ?? 0) > 0).length
    if (distinctCount > cond.maxDistinct) return false
  }

  return true
}

/** Assumes cfg.group is set — caller's responsibility, same convention as resolvePair assuming cfg.mode === 'duo' */
export function evaluateGroupArchetype(cfg: QuizConfig, members: GroupMember[]): GroupArchetype | null {
  const groupCfg = cfg.group!
  const n = members.length
  if (n < groupCfg.minMembers) return null

  const axisCounts = axisCountsFromMembers(members)
  const avgNorm = avgScoresFromMembers(members)

  const eligible = groupCfg.archetypes.filter((a) => {
    if (a.minGroupSize > n) return false
    if (a.maxGroupSize !== undefined && a.maxGroupSize < n) return false
    return true
  })
  eligible.sort((a, b) => b.minGroupSize - a.minGroupSize)

  for (const arch of eligible) {
    if (arch.fallback) continue
    if (!arch.condition) continue
    if (matchesGroupCondition(arch.condition, axisCounts, avgNorm)) return arch
  }

  for (const arch of eligible) {
    if (arch.fallback) return arch
  }

  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/quiz/groupEngine.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add lib/quiz/groupEngine.ts lib/quiz/groupEngine.test.ts
git commit -m "feat: add group archetype-matching engine (ported from KimLIFF group.ts)"
```

---

### Task 4: `lib/db/quizGroups.ts` — create + join (transactional writes)

**Files:**
- Create: `lib/db/quizGroups.ts`
- Test: `tests/quiz-groups.integration.test.ts`

**Interfaces:**
- Consumes: `Queryable`/nothing special from `@/lib/db/client` (uses `postgres.Sql` directly like `quizPairs.ts` does, since `.begin()` is needed). `loadQuizAnswers` (`./quizAnswers`). `scoreAnswers`, `strongestAxis` (`../quiz/engine`). `QuizConfig` (`../quiz/schema`).
- Produces (this task):
  - `createQuizGroup(sql: postgres.Sql, cfg: QuizConfig, activityId: string, creatorParticipantId: string): Promise<{ groupId: string }>` — throws a plain `Error('ยังไม่ได้ตอบควิซ')` if the creator has no saved answers.
  - `joinQuizGroup(sql: postgres.Sql, cfg: QuizConfig, activityId: string, groupId: string, participantId: string): Promise<{ ok: true }>` — idempotent if already a member; throws `Error('ไม่พบกลุ่มนี้')`, `Error('ยังไม่ได้ตอบควิซ')`, or `Error('กลุ่มนี้เต็มแล้ว')`.
  - Both assume `cfg.group` is set (caller's responsibility — same convention as `evaluateGroupArchetype`, Task 3).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/quiz-groups.integration.test.ts
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDb } from '../lib/db/client'
import { createQuizGroup, joinQuizGroup } from '../lib/db/quizGroups'
import { saveQuizAnswers } from '../lib/db/quizAnswers'
import type { QuizConfig } from '../lib/quiz/schema'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'
let sql: Awaited<ReturnType<typeof testDb>>
let channelId: string
let activityId: string
let participantA: string
let participantB: string
let participantC: string

const cfg: QuizConfig = {
  mode: 'solo',
  axes: [{ id: 'ei', label: 'E/I', poles: ['E', 'I'] }],
  questions: [{ id: 'q1', text: 'q1', options: [
    { id: 'a', label: 'A', scores: { ei: 3 } },
    { id: 'b', label: 'B', scores: { ei: -3 } },
  ] }],
  results: [{ code: 'E', title: 't', body: 'b' }],
  fallbackResultCode: 'E',
  group: {
    enabled: true, minMembers: 2, maxMembers: 3, resultLocksAt: 0,
    archetypes: [{ code: 'fallback', title: 't', body: 'b', minGroupSize: 2, fallback: true }],
    fallbackArchetype: 'fallback',
  },
}

beforeAll(async () => {
  sql = testDb(url)
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`quizgroup-${randomBytes(4).toString('hex')}@example.com`}, 'configurator')
    RETURNING id`
  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (name, channel_type, created_by) VALUES ('Quiz groups seed', 'preview', ${user.id}) RETURNING id`
  channelId = channel.id
  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES ('Quiz groups seed', ${`qg${randomBytes(4).toString('hex')}`}, now(), now() + interval '30 days', ${user.id})
    RETURNING id`
  const [activity] = await sql<{ id: string }[]>`
    INSERT INTO activity (campaign_id, code, name, input_type, resolve_method)
    VALUES (${campaign.id}, ${`quizg${randomBytes(4).toString('hex')}`}, 'Group quiz', 'personality_quiz', NULL)
    RETURNING id`
  activityId = activity.id
  const ids: string[] = []
  for (let i = 0; i < 3; i++) {
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO participant (channel_id, line_uid) VALUES (${channelId}, ${`U-${randomBytes(4).toString('hex')}`}) RETURNING id`
    ids.push(p.id)
  }
  ;[participantA, participantB, participantC] = ids
})

afterAll(async () => {
  await sql`DELETE FROM activity WHERE id = ${activityId}`
  await sql`DELETE FROM channel WHERE id = ${channelId}`
  await sql.end()
})

describe('createQuizGroup', () => {
  it('rejects when the creator has not answered yet', async () => {
    await expect(createQuizGroup(sql, cfg, activityId, participantA)).rejects.toThrow('ยังไม่ได้ตอบควิซ')
  })

  it('creates the group with the creator as its first member', async () => {
    await saveQuizAnswers(sql, activityId, participantA, [{ questionId: 'q1', optionId: 'a' }])
    const { groupId } = await createQuizGroup(sql, cfg, activityId, participantA)
    expect(groupId).toBeTruthy()
    const members = await sql`SELECT participant_id, top_axis FROM quiz_group_member WHERE group_id = ${groupId}`
    expect(members).toHaveLength(1)
    expect(members[0].participant_id).toBe(participantA)
    expect(members[0].top_axis).toBe('ei')
  })
})

describe('joinQuizGroup', () => {
  it('rejects when the joiner has not answered yet', async () => {
    const { groupId } = await createQuizGroup(sql, cfg, activityId, participantA)
    await expect(joinQuizGroup(sql, cfg, activityId, groupId, participantB)).rejects.toThrow('ยังไม่ได้ตอบควิซ')
  })

  it('adds a second member', async () => {
    const { groupId } = await createQuizGroup(sql, cfg, activityId, participantA)
    await saveQuizAnswers(sql, activityId, participantB, [{ questionId: 'q1', optionId: 'b' }])
    await joinQuizGroup(sql, cfg, activityId, groupId, participantB)
    const members = await sql`SELECT participant_id FROM quiz_group_member WHERE group_id = ${groupId}`
    expect(members).toHaveLength(2)
  })

  it('is idempotent — joining a group you are already in does not duplicate the row', async () => {
    const { groupId } = await createQuizGroup(sql, cfg, activityId, participantA)
    await joinQuizGroup(sql, cfg, activityId, groupId, participantA)
    const members = await sql`SELECT participant_id FROM quiz_group_member WHERE group_id = ${groupId}`
    expect(members).toHaveLength(1)
  })

  it('rejects once the group reaches max_members (3, per this test\'s cfg)', async () => {
    const { groupId } = await createQuizGroup(sql, cfg, activityId, participantA)
    await joinQuizGroup(sql, cfg, activityId, groupId, participantB)
    await saveQuizAnswers(sql, activityId, participantC, [{ questionId: 'q1', optionId: 'a' }])
    await joinQuizGroup(sql, cfg, activityId, groupId, participantC)
    const [pFourth] = await sql<{ id: string }[]>`
      INSERT INTO participant (channel_id, line_uid) VALUES (${channelId}, ${`U-${randomBytes(4).toString('hex')}`}) RETURNING id`
    await saveQuizAnswers(sql, activityId, pFourth.id, [{ questionId: 'q1', optionId: 'a' }])
    await expect(joinQuizGroup(sql, cfg, activityId, groupId, pFourth.id)).rejects.toThrow('กลุ่มนี้เต็มแล้ว')
  })

  it('rejects joining a group that does not exist', async () => {
    await expect(joinQuizGroup(sql, cfg, activityId, crypto.randomUUID(), participantA)).rejects.toThrow('ไม่พบกลุ่มนี้')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quiz-groups.integration.test.ts`
Expected: FAIL — `lib/db/quizGroups.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/db/quizGroups.ts
import type postgres from 'postgres'
import { loadQuizAnswers } from './quizAnswers'
import { scoreAnswers, strongestAxis } from '../quiz/engine'
import type { QuizConfig } from '../quiz/schema'

/**
 * สร้างกลุ่มใหม่ ใส่ creator เป็นสมาชิกคนแรกในธุรกรรมเดียว — คะแนนของ creator
 * แช่แข็ง (snapshot) ตอนนี้เลย ตรงกับพฤติกรรม quiz_pair.scores ของ duo (lib/db/quizPairs.ts)
 */
export async function createQuizGroup(
  sql: postgres.Sql, cfg: QuizConfig, activityId: string, creatorParticipantId: string,
): Promise<{ groupId: string }> {
  const answers = await loadQuizAnswers(sql, activityId, creatorParticipantId)
  if (answers.length === 0) throw new Error('ยังไม่ได้ตอบควิซ')

  const scores = scoreAnswers(cfg, answers)
  const topAxis = strongestAxis(cfg, scores)

  return sql.begin(async (tx) => {
    const [group] = await tx<{ id: string }[]>`
      INSERT INTO quiz_group (activity_id, created_by) VALUES (${activityId}, ${creatorParticipantId})
      RETURNING id`
    await tx`
      INSERT INTO quiz_group_member (group_id, participant_id, top_axis, axis_scores)
      VALUES (${group.id}, ${creatorParticipantId}, ${topAxis}, ${tx.json(scores)})`
    return { groupId: group.id }
  })
}

/**
 * เข้ากลุ่มผ่านลิงก์ — ล็อกแถว quiz_group ด้วย FOR UPDATE ก่อนนับสมาชิก กัน race ที่สอง
 * request join พร้อมกันตอนกลุ่มเหลือที่ 1 ที่นั่งสุดท้ายจะนับผ่านทั้งคู่แล้วเกิน max_members
 * (ไม่มี unique index ให้พึ่งแบบ matchQuizPair — ที่นี่ "เต็มหรือยัง" ต้องนับสมาชิกจริง
 * จึงต้องล็อกแถวพ่อแม่ให้ transaction ที่สองรอ transaction แรก commit ก่อนแล้วค่อยนับ)
 */
export async function joinQuizGroup(
  sql: postgres.Sql, cfg: QuizConfig, activityId: string, groupId: string, participantId: string,
): Promise<{ ok: true }> {
  const groupCfg = cfg.group!
  const answers = await loadQuizAnswers(sql, activityId, participantId)
  if (answers.length === 0) throw new Error('ยังไม่ได้ตอบควิซ')

  const scores = scoreAnswers(cfg, answers)
  const topAxis = strongestAxis(cfg, scores)

  return sql.begin(async (tx) => {
    const [group] = await tx<{ id: string }[]>`
      SELECT id FROM quiz_group WHERE id = ${groupId} AND activity_id = ${activityId} FOR UPDATE`
    if (!group) throw new Error('ไม่พบกลุ่มนี้')

    const [existing] = await tx`
      SELECT 1 FROM quiz_group_member WHERE group_id = ${groupId} AND participant_id = ${participantId}`
    if (existing) return { ok: true as const }

    const [{ count }] = await tx<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM quiz_group_member WHERE group_id = ${groupId}`
    if (count >= groupCfg.maxMembers) throw new Error('กลุ่มนี้เต็มแล้ว')

    await tx`
      INSERT INTO quiz_group_member (group_id, participant_id, top_axis, axis_scores)
      VALUES (${groupId}, ${participantId}, ${topAxis}, ${tx.json(scores)})`
    return { ok: true as const }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/quiz-groups.integration.test.ts`
Expected: PASS (7/7)

- [ ] **Step 5: Commit**

```bash
git add lib/db/quizGroups.ts tests/quiz-groups.integration.test.ts
git commit -m "feat: add createQuizGroup/joinQuizGroup (transaction-safe, freezes member snapshot)"
```

---

### Task 5: `lib/db/quizGroups.ts` — get (with lock) + add-pairs

**Files:**
- Modify: `lib/db/quizGroups.ts`
- Modify: `tests/quiz-groups.integration.test.ts` (extend)

**Interfaces:**
- Consumes: `evaluateGroupArchetype` (`../quiz/groupEngine`, Task 3). `Queryable` (`./client`). Everything `createQuizGroup`/`joinQuizGroup` already import (Task 4).
- Produces:
  - `type QuizGroupMember = { participantId: string; topAxis: string; joinedAt: Date }`
  - `type QuizGroupView = { groupId: string; totalMembers: number; minMembers: number; maxMembers: number; members: QuizGroupMember[]; result: { code: string; title: string; body: string; imageUrl?: string } | null; isLocked: boolean }` — field is `groupId`, not `id`, to match the spec §5 GET response shape verbatim (`{ groupId, totalMembers, ... }`)
  - `getQuizGroup(sql: Queryable, cfg: QuizConfig, activityId: string, groupId: string): Promise<QuizGroupView | null>` — computes the archetype live from current members, and *persists* a lock (`locked_archetype_code`/`locked_at`) the first time `totalMembers >= resultLocksAt > 0`; once locked, always returns the locked archetype without recomputing.
  - `addPairsToQuizGroup(sql: postgres.Sql, cfg: QuizConfig, activityId: string, groupId: string, creatorParticipantId: string, pairIds: string[]): Promise<{ added: number }>` — throws `Error('ไม่พบกลุ่มนี้')` or `Error('ไม่ใช่ผู้สร้างกลุ่มนี้')`; silently skips any `pairId` that doesn't belong to this activity, doesn't have the creator on either side, is already a member, or would exceed `maxMembers`.

- [ ] **Step 1: Write the failing test**

Append to `tests/quiz-groups.integration.test.ts` — first add this import line alongside the
existing ones at the top of the file:

```typescript
import { addPairsToQuizGroup, createQuizGroup, getQuizGroup, joinQuizGroup } from '../lib/db/quizGroups'
import { matchQuizPair } from '../lib/db/quizPairs'
```

Then append these `describe` blocks at the end of the file:

```typescript
describe('getQuizGroup', () => {
  it('returns null for a group that does not exist', async () => {
    expect(await getQuizGroup(sql, cfg, activityId, crypto.randomUUID())).toBeNull()
  })

  it('result is null until minMembers is reached, then reflects live composition', async () => {
    const { groupId } = await createQuizGroup(sql, cfg, activityId, participantA)
    const soloView = await getQuizGroup(sql, cfg, activityId, groupId)
    expect(soloView?.totalMembers).toBe(1)
    expect(soloView?.result).toBeNull() // minMembers is 2

    await saveQuizAnswers(sql, activityId, participantB, [{ questionId: 'q1', optionId: 'a' }])
    await joinQuizGroup(sql, cfg, activityId, groupId, participantB)
    const pairView = await getQuizGroup(sql, cfg, activityId, groupId)
    expect(pairView?.totalMembers).toBe(2)
    expect(pairView?.result?.code).toBe('fallback')
    expect(pairView?.isLocked).toBe(false)
  })

  it('locks the result once resultLocksAt is reached, and stops recomputing after', async () => {
    const lockingCfg: QuizConfig = { ...cfg, group: { ...cfg.group!, minMembers: 2, resultLocksAt: 2 } }
    const { groupId } = await createQuizGroup(sql, lockingCfg, activityId, participantA)
    await saveQuizAnswers(sql, activityId, participantC, [{ questionId: 'q1', optionId: 'a' }])
    await joinQuizGroup(sql, lockingCfg, activityId, groupId, participantC)

    const locked = await getQuizGroup(sql, lockingCfg, activityId, groupId)
    expect(locked?.isLocked).toBe(true)
    expect(locked?.result?.code).toBe('fallback')

    const [row] = await sql<{ locked_archetype_code: string }[]>`
      SELECT locked_archetype_code FROM quiz_group WHERE id = ${groupId}`
    expect(row.locked_archetype_code).toBe('fallback')
  })
})

describe('addPairsToQuizGroup', () => {
  it('rejects when the caller is not the group creator', async () => {
    const { groupId } = await createQuizGroup(sql, cfg, activityId, participantA)
    await expect(addPairsToQuizGroup(sql, cfg, activityId, groupId, participantB, ['whatever']))
      .rejects.toThrow('ไม่ใช่ผู้สร้างกลุ่มนี้')
  })

  it('adds the duo partner (not the creator) from a real quiz_pair, computing topAxis via strongestAxis', async () => {
    const duoCfg: QuizConfig = { ...cfg, mode: 'duo', results: [{ code: 'PAIR', title: 't', body: 'b' }], fallbackResultCode: 'PAIR' }
    const pair = await matchQuizPair(sql, duoCfg, activityId, participantA, participantB, [{ questionId: 'q1', optionId: 'b' }])

    const { groupId } = await createQuizGroup(sql, cfg, activityId, participantA)
    const result = await addPairsToQuizGroup(sql, cfg, activityId, groupId, participantA, [pair.id])
    expect(result.added).toBe(1)
    const members = await sql`SELECT participant_id FROM quiz_group_member WHERE group_id = ${groupId} AND participant_id = ${participantB}`
    expect(members).toHaveLength(1)
  })

  it('silently skips a pairId that does not belong to this activity/creator', async () => {
    const { groupId } = await createQuizGroup(sql, cfg, activityId, participantA)
    const result = await addPairsToQuizGroup(sql, cfg, activityId, groupId, participantA, [crypto.randomUUID()])
    expect(result.added).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quiz-groups.integration.test.ts`
Expected: FAIL — `getQuizGroup`/`addPairsToQuizGroup` are not exported from `lib/db/quizGroups.ts` yet.

- [ ] **Step 3: Write the implementation**

Append to `lib/db/quizGroups.ts` (add `evaluateGroupArchetype` to the existing imports —
change the `../quiz/engine` import line to also import from `../quiz/groupEngine`, and add
`Queryable` to the `./client` import):

```typescript
import type { Queryable } from './client'
import { evaluateGroupArchetype } from '../quiz/groupEngine'
```

Then append:

```typescript
export type QuizGroupMember = { participantId: string; topAxis: string; joinedAt: Date }
export type QuizGroupView = {
  id: string
  totalMembers: number
  minMembers: number
  maxMembers: number
  members: QuizGroupMember[]
  result: { code: string; title: string; body: string; imageUrl?: string } | null
  isLocked: boolean
}

/**
 * ผลลัพธ์คำนวณสดจากสมาชิกปัจจุบันทุกครั้งที่เรียก จนกว่าจะถึง resultLocksAt แล้ว
 * "แช่แข็ง" ผลไว้ถาวรใน quiz_group.locked_archetype_code — ตรงกับพฤติกรรมของ
 * getGroup ใน KimLIFF's group.ts ทุกประการ (รวมถึงการที่ endpoint นี้ทำ UPDATE ได้
 * แม้จะเป็น GET ในทาง HTTP ก็ตาม — เขียนแค่ครั้งเดียวตอนข้ามเกณฑ์ล็อกพอดี)
 */
export async function getQuizGroup(
  sql: Queryable, cfg: QuizConfig, activityId: string, groupId: string,
): Promise<QuizGroupView | null> {
  const groupCfg = cfg.group!

  const [group] = await sql<{ id: string; locked_archetype_code: string | null }[]>`
    SELECT id, locked_archetype_code FROM quiz_group WHERE id = ${groupId} AND activity_id = ${activityId}`
  if (!group) return null

  const memberRows = await sql<{ participant_id: string; top_axis: string; axis_scores: Record<string, number>; joined_at: Date }[]>`
    SELECT participant_id, top_axis, axis_scores, joined_at FROM quiz_group_member
     WHERE group_id = ${groupId} ORDER BY joined_at ASC`

  const members = memberRows.map((m) => ({ topAxis: m.top_axis, axisScores: m.axis_scores }))
  const total = memberRows.length

  let archetype = null as ReturnType<typeof evaluateGroupArchetype>
  let isLocked = false

  if (group.locked_archetype_code) {
    isLocked = true
    archetype = groupCfg.archetypes.find((a) => a.code === group.locked_archetype_code) ?? null
  } else {
    archetype = evaluateGroupArchetype(cfg, members)
    if (groupCfg.resultLocksAt > 0 && total >= groupCfg.resultLocksAt && archetype) {
      await sql`UPDATE quiz_group SET locked_archetype_code = ${archetype.code}, locked_at = now() WHERE id = ${groupId}`
      isLocked = true
    }
  }

  return {
    groupId: group.id, totalMembers: total, minMembers: groupCfg.minMembers, maxMembers: groupCfg.maxMembers,
    members: memberRows.map((m) => ({ participantId: m.participant_id, topAxis: m.top_axis, joinedAt: m.joined_at })),
    result: archetype ? { code: archetype.code, title: archetype.title, body: archetype.body, imageUrl: archetype.imageUrl } : null,
    isLocked,
  }
}

/**
 * ทางลัดให้ creator เติมคู่ duo ที่จับคู่สำเร็จแล้วเข้ากลุ่มโดยตรง — ไม่ห่อทั้งชุดใน
 * transaction เดียว (ต่างจาก createQuizGroup/joinQuizGroup) เพราะ creator-only action
 * นี้ไม่มีคู่แข่ง concurrent เหมือนสถานการณ์ join ผ่านลิงก์สาธารณะ แต่ละ pairId เช็ค/
 * เขียนเป็นก้อนอิสระ ข้ามเงียบๆ ถ้าไม่ถูกต้อง แทนที่จะทำให้ทั้งคำขอ throw (spec §5/§6)
 */
export async function addPairsToQuizGroup(
  sql: postgres.Sql, cfg: QuizConfig, activityId: string, groupId: string,
  creatorParticipantId: string, pairIds: string[],
): Promise<{ added: number }> {
  const groupCfg = cfg.group!

  const [group] = await sql<{ created_by: string }[]>`
    SELECT created_by FROM quiz_group WHERE id = ${groupId} AND activity_id = ${activityId}`
  if (!group) throw new Error('ไม่พบกลุ่มนี้')
  if (group.created_by !== creatorParticipantId) throw new Error('ไม่ใช่ผู้สร้างกลุ่มนี้')

  let added = 0
  for (const pairId of pairIds) {
    const [pair] = await sql<{ participant_a: string; participant_b: string; scores: { a: Record<string, number>; b: Record<string, number> } }[]>`
      SELECT participant_a, participant_b, scores FROM quiz_pair WHERE id = ${pairId} AND activity_id = ${activityId}`
    if (!pair) continue

    let partnerId: string
    let partnerScores: Record<string, number>
    if (pair.participant_a === creatorParticipantId) {
      partnerId = pair.participant_b
      partnerScores = pair.scores.b
    } else if (pair.participant_b === creatorParticipantId) {
      partnerId = pair.participant_a
      partnerScores = pair.scores.a
    } else {
      continue
    }

    const [existing] = await sql`SELECT 1 FROM quiz_group_member WHERE group_id = ${groupId} AND participant_id = ${partnerId}`
    if (existing) continue

    const [{ count }] = await sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM quiz_group_member WHERE group_id = ${groupId}`
    if (count >= groupCfg.maxMembers) continue

    const topAxis = strongestAxis(cfg, partnerScores)
    await sql`
      INSERT INTO quiz_group_member (group_id, participant_id, top_axis, axis_scores)
      VALUES (${groupId}, ${partnerId}, ${topAxis}, ${sql.json(partnerScores)})`
    added++
  }

  return { added }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/quiz-groups.integration.test.ts`
Expected: PASS (all tests, old and new — 12/12)

- [ ] **Step 5: Commit**

```bash
git add lib/db/quizGroups.ts tests/quiz-groups.integration.test.ts
git commit -m "feat: add getQuizGroup (with result locking) and addPairsToQuizGroup"
```

---

### Task 6: LIFF API — create + join

**Files:**
- Create: `app/api/liff/[liffId]/quiz/[activityCode]/group/create/route.ts`
- Create: `app/api/liff/[liffId]/quiz/[activityCode]/group/[groupId]/join/route.ts`
- Test: `tests/quiz-liff-group-routes.integration.test.ts`

**Interfaces:**
- Consumes: `resolveLiffParticipant` (`@/lib/liff/auth`), `LIFF_CORS_HEADERS`/`liffOptionsResponse` (`@/lib/liff/cors`), `db()` (`@/lib/db/client`), `loadQuizActivity` (`@/lib/quiz/loadActivity`), `createQuizGroup`/`joinQuizGroup` (`@/lib/db/quizGroups`, Task 4).
- Produces:
  - `POST /api/liff/{liffId}/quiz/{activityCode}/group/create` → `{ groupId, shareUrl }`
  - `POST /api/liff/{liffId}/quiz/{activityCode}/group/{groupId}/join` → `{ ok: true }`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/quiz-liff-group-routes.integration.test.ts
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import { testDb } from '../lib/db/client'
import { createLiffApp } from '../lib/db/liffApps'
import type { QuizConfig } from '../lib/quiz/schema'

let sql: postgres.Sql

vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/db/client')>()),
  db: () => sql,
}))

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'
let channelId: string
let campaignId: string
let liffId: string
let activityCode: string
let lineUidA: string
let lineUidB: string
let lineUidC: string
const apiKey = 'sk_quiz_liff_group_test'

const cfg: QuizConfig = {
  mode: 'solo',
  axes: [{ id: 'ei', label: 'E/I', poles: ['E', 'I'] }],
  questions: [{ id: 'q1', text: 'q1', options: [
    { id: 'a', label: 'A', scores: { ei: 3 } },
    { id: 'b', label: 'B', scores: { ei: -3 } },
  ] }],
  results: [{ code: 'E', title: 't', body: 'b' }],
  fallbackResultCode: 'E',
  group: {
    enabled: true, minMembers: 2, maxMembers: 2, resultLocksAt: 0,
    archetypes: [{ code: 'fallback', title: 't', body: 'b', minGroupSize: 2, fallback: true }],
    fallbackArchetype: 'fallback',
  },
}

beforeAll(async () => {
  process.env.SECRET_KEY_V1 = randomBytes(32).toString('base64')
  sql = testDb(url)

  const tag = randomBytes(4).toString('hex')
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`quizliffgroup-${tag}@example.com`}, 'configurator')
    RETURNING id`
  const lineChannelId = `9${randomBytes(4).readUInt32BE(0)}`
  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (name, channel_type, line_channel_id, created_by)
    VALUES ('Quiz LIFF group seed', 'preview', ${lineChannelId}, ${user.id}) RETURNING id`
  channelId = channel.id

  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES ('Quiz LIFF group seed', ${`qliffgrp${tag}`}, now(), now() + interval '30 days', ${user.id})
    RETURNING id`
  campaignId = campaign.id
  await sql`
    INSERT INTO campaign_channel (campaign_id, channel_id, is_published, published_at)
    VALUES (${campaignId}, ${channelId}, true, now())`

  activityCode = `quizgrp${tag}`
  await sql`
    INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, input_config)
    VALUES (${campaignId}, ${activityCode}, 'Personality quiz group', 'personality_quiz', NULL, ${sql.json(cfg as never)})`

  const app = await createLiffApp(sql, {
    name: 'Quiz LIFF group', liffId: `2012-${tag}`,
    lineLoginChannelId: '2012037337', channelId, apiKey, createdBy: user.id,
  })
  liffId = app.liffId
  lineUidA = `U-quizliffgroup-a-${tag}`
  lineUidB = `U-quizliffgroup-b-${tag}`
  lineUidC = `U-quizliffgroup-c-${tag}`
})

afterAll(async () => {
  await sql`DELETE FROM campaign WHERE id = ${campaignId}`
  await sql`DELETE FROM channel WHERE id = ${channelId}`
  await sql.end()
})

function authHeaders(lineUid: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, 'X-Line-User-Id': lineUid }
}

const { POST: postSoloAnswer } = await import('../app/api/liff/[liffId]/quiz/[activityCode]/solo/answer/route')
const { POST: postCreate } = await import('../app/api/liff/[liffId]/quiz/[activityCode]/group/create/route')
const { POST: postJoin } = await import('../app/api/liff/[liffId]/quiz/[activityCode]/group/[groupId]/join/route')

async function answerSolo(lineUid: string): Promise<void> {
  const request = new Request('https://example.com', {
    method: 'POST', headers: { ...authHeaders(lineUid), 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers: [{ questionId: 'q1', optionId: 'a' }] }),
  })
  const response = await postSoloAnswer(request, { params: Promise.resolve({ liffId, activityCode }) })
  expect(response.status).toBe(200)
}

describe('group create + join', () => {
  it('rejects create when the caller never answered', async () => {
    const request = new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidC) })
    const response = await postCreate(request, { params: Promise.resolve({ liffId, activityCode }) })
    expect(response.status).toBe(400)
  })

  it('creates a group and returns a shareUrl containing the groupId', async () => {
    await answerSolo(lineUidA)
    const request = new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidA) })
    const response = await postCreate(request, { params: Promise.resolve({ liffId, activityCode }) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.groupId).toBeTruthy()
    expect(body.shareUrl).toContain(`https://liff.line.me/${liffId}`)
    expect(body.shareUrl).toContain(`groupId=${body.groupId}`)
  })

  it('B joins via the groupId from the shareUrl', async () => {
    await answerSolo(lineUidA)
    const createRequest = new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidA) })
    const createResponse = await postCreate(createRequest, { params: Promise.resolve({ liffId, activityCode }) })
    const { groupId } = await createResponse.json()

    await answerSolo(lineUidB)
    const joinRequest = new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidB) })
    const joinResponse = await postJoin(joinRequest, { params: Promise.resolve({ liffId, activityCode, groupId }) })
    expect(joinResponse.status).toBe(200)
    const joinBody = await joinResponse.json()
    expect(joinBody.ok).toBe(true)
  })

  it('join fails with 400 once the group is full (max_members is 2 in this fixture)', async () => {
    await answerSolo(lineUidA)
    const createRequest = new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidA) })
    const { groupId } = await (await postCreate(createRequest, { params: Promise.resolve({ liffId, activityCode }) })).json()

    await answerSolo(lineUidB)
    await postJoin(
      new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidB) }),
      { params: Promise.resolve({ liffId, activityCode, groupId }) },
    )

    await answerSolo(lineUidC)
    const response = await postJoin(
      new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidC) }),
      { params: Promise.resolve({ liffId, activityCode, groupId }) },
    )
    expect(response.status).toBe(400)
  })

  it('join returns 404 for a group id that does not exist', async () => {
    await answerSolo(lineUidC)
    const response = await postJoin(
      new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidC) }),
      { params: Promise.resolve({ liffId, activityCode, groupId: crypto.randomUUID() }) },
    )
    expect(response.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quiz-liff-group-routes.integration.test.ts`
Expected: FAIL — the two route files don't exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// app/api/liff/[liffId]/quiz/[activityCode]/group/create/route.ts
import { db } from '@/lib/db/client'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from '@/lib/liff/cors'
import { resolveLiffParticipant } from '@/lib/liff/auth'
import { createQuizGroup } from '@/lib/db/quizGroups'
import { loadQuizActivity } from '@/lib/quiz/loadActivity'

export async function POST(
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
  if (!activity.config.group?.enabled) {
    return Response.json({ error: 'ควิซนี้ไม่เปิดผลลัพธ์กลุ่ม' }, { status: 404, headers: LIFF_CORS_HEADERS })
  }

  try {
    const { groupId } = await createQuizGroup(sql, activity.config, activity.id, auth.participantId)
    const shareUrl = `https://liff.line.me/${auth.liffApp.liffId}?groupId=${groupId}&activityCode=${activityCode}`
    return Response.json({ groupId, shareUrl }, { headers: LIFF_CORS_HEADERS })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message === 'ยังไม่ได้ตอบควิซ') {
      return Response.json({ error: message }, { status: 400, headers: LIFF_CORS_HEADERS })
    }
    return Response.json({ error: 'สร้างกลุ่มไม่สำเร็จ' }, { status: 500, headers: LIFF_CORS_HEADERS })
  }
}

export async function OPTIONS(): Promise<Response> {
  return liffOptionsResponse()
}
```

```typescript
// app/api/liff/[liffId]/quiz/[activityCode]/group/[groupId]/join/route.ts
import { db } from '@/lib/db/client'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from '@/lib/liff/cors'
import { resolveLiffParticipant } from '@/lib/liff/auth'
import { joinQuizGroup } from '@/lib/db/quizGroups'
import { loadQuizActivity } from '@/lib/quiz/loadActivity'

export async function POST(
  request: Request, { params }: { params: Promise<{ liffId: string; activityCode: string; groupId: string }> },
): Promise<Response> {
  const { liffId, activityCode, groupId } = await params
  const sql = db()
  const auth = await resolveLiffParticipant(sql, liffId, request)
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status, headers: LIFF_CORS_HEADERS })
  }

  const activity = await loadQuizActivity(sql, auth.liffApp.channelId, activityCode)
  if (!activity) {
    return Response.json({ error: 'ไม่พบควิซนี้' }, { status: 404, headers: LIFF_CORS_HEADERS })
  }
  if (!activity.config.group?.enabled) {
    return Response.json({ error: 'ควิซนี้ไม่เปิดผลลัพธ์กลุ่ม' }, { status: 404, headers: LIFF_CORS_HEADERS })
  }

  try {
    const result = await joinQuizGroup(sql, activity.config, activity.id, groupId, auth.participantId)
    return Response.json(result, { headers: LIFF_CORS_HEADERS })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message === 'ไม่พบกลุ่มนี้') {
      return Response.json({ error: message }, { status: 404, headers: LIFF_CORS_HEADERS })
    }
    if (message === 'ยังไม่ได้ตอบควิซ' || message === 'กลุ่มนี้เต็มแล้ว') {
      return Response.json({ error: message }, { status: 400, headers: LIFF_CORS_HEADERS })
    }
    return Response.json({ error: 'เข้ากลุ่มไม่สำเร็จ' }, { status: 500, headers: LIFF_CORS_HEADERS })
  }
}

export async function OPTIONS(): Promise<Response> {
  return liffOptionsResponse()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/quiz-liff-group-routes.integration.test.ts`
Expected: PASS (5/5)

- [ ] **Step 5: Commit**

```bash
git add app/api/liff/\[liffId\]/quiz/\[activityCode\]/group/create/route.ts \
        app/api/liff/\[liffId\]/quiz/\[activityCode\]/group/\[groupId\]/join/route.ts \
        tests/quiz-liff-group-routes.integration.test.ts
git commit -m "feat: add LIFF-facing group create/join API"
```

---

### Task 7: LIFF API — get + add-pairs

**Files:**
- Create: `app/api/liff/[liffId]/quiz/[activityCode]/group/[groupId]/route.ts`
- Create: `app/api/liff/[liffId]/quiz/[activityCode]/group/[groupId]/add-pairs/route.ts`
- Test: `tests/quiz-liff-group-routes.integration.test.ts` (extend)

**Interfaces:**
- Consumes: everything Task 6 imports, plus `getQuizGroup`/`addPairsToQuizGroup` (`@/lib/db/quizGroups`, Task 5).
- Produces:
  - `GET /api/liff/{liffId}/quiz/{activityCode}/group/{groupId}` → `QuizGroupView & { amIMember: boolean; canJoin: boolean }`
  - `POST /api/liff/{liffId}/quiz/{activityCode}/group/{groupId}/add-pairs` body `{ pairIds: string[] }` → `{ added: number }`

- [ ] **Step 1: Write the failing test**

Append to `tests/quiz-liff-group-routes.integration.test.ts` — add this import near the top of the
file, alongside the existing `createLiffApp` import:

```typescript
import { matchQuizPair } from '../lib/db/quizPairs'
```

And add these route imports alongside the existing route imports near the top of the file:

```typescript
const { POST: postDuoAnswer } = await import('../app/api/liff/[liffId]/quiz/[activityCode]/duo/answer/route')
const { GET: getGroup } = await import('../app/api/liff/[liffId]/quiz/[activityCode]/group/[groupId]/route')
const { POST: postAddPairs } = await import('../app/api/liff/[liffId]/quiz/[activityCode]/group/[groupId]/add-pairs/route')
```

Then append this `describe` block at the end of the file:

```typescript
describe('group get + add-pairs', () => {
  it('GET reflects live composition, amIMember, and canJoin', async () => {
    await answerSolo(lineUidA)
    const { groupId } = await (await postCreate(
      new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidA) }),
      { params: Promise.resolve({ liffId, activityCode }) },
    )).json()

    const asCreator = await getGroup(
      new Request('https://example.com', { headers: authHeaders(lineUidA) }),
      { params: Promise.resolve({ liffId, activityCode, groupId }) },
    )
    expect(asCreator.status).toBe(200)
    const creatorBody = await asCreator.json()
    expect(creatorBody.groupId).toBe(groupId)
    expect(creatorBody.totalMembers).toBe(1)
    expect(creatorBody.result).toBeNull() // minMembers is 2
    expect(creatorBody.amIMember).toBe(true)
    expect(creatorBody.canJoin).toBe(false) // already a member

    await answerSolo(lineUidC)
    const asStranger = await getGroup(
      new Request('https://example.com', { headers: authHeaders(lineUidC) }),
      { params: Promise.resolve({ liffId, activityCode, groupId }) },
    )
    const strangerBody = await asStranger.json()
    expect(strangerBody.amIMember).toBe(false)
    expect(strangerBody.canJoin).toBe(true)
  })

  it('GET returns 404 for a group id that does not exist', async () => {
    await answerSolo(lineUidA)
    const response = await getGroup(
      new Request('https://example.com', { headers: authHeaders(lineUidA) }),
      { params: Promise.resolve({ liffId, activityCode, groupId: crypto.randomUUID() }) },
    )
    expect(response.status).toBe(404)
  })

  it('add-pairs by the creator adds a real duo partner, then GET shows 2 members and a result', async () => {
    // reuse the duo flow (Task 6/7 of the original quiz-engine plan) to get a real quiz_pair —
    // this cfg is solo-mode for create/join but duo pairing is orthogonal to it (Global Constraints)
    const duoResponse = await postDuoAnswer(
      new Request('https://example.com', {
        method: 'POST', headers: { ...authHeaders(lineUidA), 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: [{ questionId: 'q1', optionId: 'a' }] }),
      }),
      { params: Promise.resolve({ liffId, activityCode }) },
    )
    // duo/answer requires config.mode === 'duo', but this fixture's cfg.mode is 'solo' — expect
    // a 400 here confirms group and duo really are independent; get a real quiz_pair a different
    // way instead: call matchQuizPair (lib/db/quizPairs.ts) directly. It never checks cfg.mode —
    // duo pairing and this fixture's group config are simply two unrelated features of the same
    // activity — so this produces a real, correctly-computed quiz_pair row without going through
    // a route that only exists for mode: 'duo' activities.
    expect(duoResponse.status).toBe(400)

    await answerSolo(lineUidA)
    await answerSolo(lineUidB)
    const { groupId } = await (await postCreate(
      new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidA) }),
      { params: Promise.resolve({ liffId, activityCode }) },
    )).json()

    const [activityRow] = await sql<{ id: string }[]>`SELECT id FROM activity WHERE code = ${activityCode} AND campaign_id = ${campaignId}`
    const [participantRowA] = await sql<{ id: string }[]>`SELECT id FROM participant WHERE line_uid = ${lineUidA}`
    const [participantRowB] = await sql<{ id: string }[]>`SELECT id FROM participant WHERE line_uid = ${lineUidB}`
    const pair = await matchQuizPair(sql, cfg, activityRow.id, participantRowA.id, participantRowB.id, [{ questionId: 'q1', optionId: 'b' }])

    const addResponse = await postAddPairs(
      new Request('https://example.com', {
        method: 'POST', headers: { ...authHeaders(lineUidA), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairIds: [pair.id] }),
      }),
      { params: Promise.resolve({ liffId, activityCode, groupId }) },
    )
    expect(addResponse.status).toBe(200)
    const addBody = await addResponse.json()
    expect(addBody.added).toBe(1)

    const finalView = await getGroup(
      new Request('https://example.com', { headers: authHeaders(lineUidA) }),
      { params: Promise.resolve({ liffId, activityCode, groupId }) },
    )
    const finalBody = await finalView.json()
    expect(finalBody.totalMembers).toBe(2)
    expect(finalBody.result?.code).toBe('fallback')
  })

  it('add-pairs by a non-creator returns 403', async () => {
    await answerSolo(lineUidA)
    const { groupId } = await (await postCreate(
      new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidA) }),
      { params: Promise.resolve({ liffId, activityCode }) },
    )).json()

    await answerSolo(lineUidB)
    const response = await postAddPairs(
      new Request('https://example.com', {
        method: 'POST', headers: { ...authHeaders(lineUidB), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairIds: [crypto.randomUUID()] }),
      }),
      { params: Promise.resolve({ liffId, activityCode, groupId }) },
    )
    expect(response.status).toBe(403)
  })
})
```

Note on the "duo/answer requires mode duo" assertion in the test above: it's there to make the
orthogonality between `mode` and `group` explicit and machine-checked, not just documented — this
fixture's `cfg.mode` is `'solo'`, so `POST .../duo/answer` correctly 400s even though `group.enabled`
is `true` for the same activity.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quiz-liff-group-routes.integration.test.ts`
Expected: FAIL — the two new route files don't exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// app/api/liff/[liffId]/quiz/[activityCode]/group/[groupId]/route.ts
import { db } from '@/lib/db/client'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from '@/lib/liff/cors'
import { resolveLiffParticipant } from '@/lib/liff/auth'
import { getQuizGroup } from '@/lib/db/quizGroups'
import { loadQuizActivity } from '@/lib/quiz/loadActivity'

export async function GET(
  request: Request, { params }: { params: Promise<{ liffId: string; activityCode: string; groupId: string }> },
): Promise<Response> {
  const { liffId, activityCode, groupId } = await params
  const sql = db()
  const auth = await resolveLiffParticipant(sql, liffId, request)
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status, headers: LIFF_CORS_HEADERS })
  }

  const activity = await loadQuizActivity(sql, auth.liffApp.channelId, activityCode)
  if (!activity) {
    return Response.json({ error: 'ไม่พบควิซนี้' }, { status: 404, headers: LIFF_CORS_HEADERS })
  }
  if (!activity.config.group?.enabled) {
    return Response.json({ error: 'ควิซนี้ไม่เปิดผลลัพธ์กลุ่ม' }, { status: 404, headers: LIFF_CORS_HEADERS })
  }

  const view = await getQuizGroup(sql, activity.config, activity.id, groupId)
  if (!view) {
    return Response.json({ error: 'ไม่พบกลุ่มนี้' }, { status: 404, headers: LIFF_CORS_HEADERS })
  }

  const amIMember = view.members.some((m) => m.participantId === auth.participantId)
  const canJoin = view.totalMembers < view.maxMembers && !amIMember

  return Response.json({ ...view, amIMember, canJoin }, { headers: LIFF_CORS_HEADERS })
}

export async function OPTIONS(): Promise<Response> {
  return liffOptionsResponse()
}
```

```typescript
// app/api/liff/[liffId]/quiz/[activityCode]/group/[groupId]/add-pairs/route.ts
import { db } from '@/lib/db/client'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from '@/lib/liff/cors'
import { resolveLiffParticipant } from '@/lib/liff/auth'
import { addPairsToQuizGroup } from '@/lib/db/quizGroups'
import { loadQuizActivity } from '@/lib/quiz/loadActivity'

export async function POST(
  request: Request, { params }: { params: Promise<{ liffId: string; activityCode: string; groupId: string }> },
): Promise<Response> {
  const { liffId, activityCode, groupId } = await params
  const sql = db()

  let body: { pairIds?: string[] }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'อ่าน request body ไม่ได้ — ต้องเป็น JSON' }, { status: 400, headers: LIFF_CORS_HEADERS })
  }

  const auth = await resolveLiffParticipant(sql, liffId, request)
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status, headers: LIFF_CORS_HEADERS })
  }

  const activity = await loadQuizActivity(sql, auth.liffApp.channelId, activityCode)
  if (!activity) {
    return Response.json({ error: 'ไม่พบควิซนี้' }, { status: 404, headers: LIFF_CORS_HEADERS })
  }
  if (!activity.config.group?.enabled) {
    return Response.json({ error: 'ควิซนี้ไม่เปิดผลลัพธ์กลุ่ม' }, { status: 404, headers: LIFF_CORS_HEADERS })
  }

  const pairIds = body.pairIds ?? []
  if (!Array.isArray(pairIds) || pairIds.length === 0) {
    return Response.json({ error: 'pairIds ต้องเป็น array ที่ไม่ว่าง' }, { status: 422, headers: LIFF_CORS_HEADERS })
  }

  try {
    const result = await addPairsToQuizGroup(sql, activity.config, activity.id, groupId, auth.participantId, pairIds)
    return Response.json(result, { headers: LIFF_CORS_HEADERS })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message === 'ไม่พบกลุ่มนี้') {
      return Response.json({ error: message }, { status: 404, headers: LIFF_CORS_HEADERS })
    }
    if (message === 'ไม่ใช่ผู้สร้างกลุ่มนี้') {
      return Response.json({ error: message }, { status: 403, headers: LIFF_CORS_HEADERS })
    }
    return Response.json({ error: 'เติมสมาชิกไม่สำเร็จ' }, { status: 500, headers: LIFF_CORS_HEADERS })
  }
}

export async function OPTIONS(): Promise<Response> {
  return liffOptionsResponse()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/quiz-liff-group-routes.integration.test.ts`
Expected: PASS (all tests, old and new — 9/9)

- [ ] **Step 5: Commit**

```bash
git add "app/api/liff/[liffId]/quiz/[activityCode]/group/[groupId]/route.ts" \
        "app/api/liff/[liffId]/quiz/[activityCode]/group/[groupId]/add-pairs/route.ts" \
        tests/quiz-liff-group-routes.integration.test.ts
git commit -m "feat: add LIFF-facing group get/add-pairs API"
```

---

### Task 8: Admin UI — group settings + archetype editor

**Files:**
- Create: `app/(admin)/campaigns/[id]/activities/[activityId]/quiz/GroupConfigEditor.tsx`
- Modify: `app/(admin)/campaigns/[id]/activities/[activityId]/quiz/QuizConfigForm.tsx`
- Test: `app/(admin)/campaigns/[id]/activities/[activityId]/quiz/GroupConfigEditor.test.tsx`

**Interfaces:**
- Consumes: `GroupConfig`, `GroupArchetype`, `GroupCondition`, `QuizAxis` types from `../../../../../../../lib/quiz/schema` (Task 2) — real relative depth from this file is `@/lib/quiz/schema`, use that alias like the rest of the codebase. `replaceAt`, `removeAt`, `uniqueId`, `boxStyle`, `rowStyle`, `smallLabelStyle`, `noteStyle` exported from `./QuizConfigForm` (this task exports them — they exist there today without `export`).
- Produces: `GroupConfigEditor` component — `{ group: GroupConfig | undefined; axes: QuizAxis[]; canEdit: boolean; onChange: (group: GroupConfig | undefined) => void }`. `QuizConfigForm.tsx` renders it as one more `Panel` and folds its output into `draft.group` the same way every other section folds into `draft`.

- [ ] **Step 1: Export the shared helpers `GroupConfigEditor.tsx` needs**

In `QuizConfigForm.tsx`, add the `export` keyword to these five existing declarations (no other
change to their bodies): `boxStyle`, `rowStyle`, `smallLabelStyle`, `noteStyle`, the `replaceAt`
function, the `removeAt` function, and the `uniqueId` function. (`boxStyle`/`rowStyle`/
`smallLabelStyle`/`noteStyle` are `const` declarations near the top of the file; `replaceAt`/
`removeAt`/`uniqueId` are the three helper functions defined above `AxisRow`.)

- [ ] **Step 2: Write the failing test**

```typescript
// @vitest-environment jsdom
// app/(admin)/campaigns/[id]/activities/[activityId]/quiz/GroupConfigEditor.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GroupConfigEditor } from './GroupConfigEditor'
import type { GroupConfig, QuizAxis } from '@/lib/quiz/schema'

afterEach(cleanup)

const axes: QuizAxis[] = [{ id: 'ei', label: 'E/I', poles: ['E', 'I'] }, { id: 'sn', label: 'S/N', poles: ['S', 'N'] }]

const fullGroup: GroupConfig = {
  enabled: true, minMembers: 2, maxMembers: 10, resultLocksAt: 0,
  archetypes: [
    { code: 'balanced', title: 'สมดุล', body: 'b', minGroupSize: 2, fallback: false, condition: { hasMode: 'any', topN: 1, dominantThreshold: 0.5, isBalanced: true } },
    { code: 'mixed', title: 'ปนกัน', body: 'b', minGroupSize: 2, fallback: true },
  ],
  fallbackArchetype: 'mixed',
}

describe('GroupConfigEditor', () => {
  it('shows only the enable checkbox when group is undefined', () => {
    render(<GroupConfigEditor group={undefined} axes={axes} canEdit onChange={vi.fn()} />)
    expect(screen.getByLabelText(/เปิดใช้งานผลลัพธ์กลุ่ม/)).not.toBeChecked()
    expect(screen.queryByText(/archetype/i)).not.toBeInTheDocument()
  })

  it('checking the enable box calls onChange with a minimal default GroupConfig', () => {
    const onChange = vi.fn()
    render(<GroupConfigEditor group={undefined} axes={axes} canEdit onChange={onChange} />)
    fireEvent.click(screen.getByLabelText(/เปิดใช้งานผลลัพธ์กลุ่ม/))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }))
  })

  it('renders every archetype row and lets you edit a title', () => {
    const onChange = vi.fn()
    render(<GroupConfigEditor group={fullGroup} axes={axes} canEdit onChange={onChange} />)
    const titleInputs = screen.getAllByDisplayValue(/สมดุล|ปนกัน/)
    expect(titleInputs).toHaveLength(2)
    fireEvent.change(titleInputs[0], { target: { value: 'สมดุลใหม่' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      archetypes: expect.arrayContaining([expect.objectContaining({ title: 'สมดุลใหม่' })]),
    }))
  })

  it('adding an archetype uses a code that does not collide with existing ones', () => {
    const onChange = vi.fn()
    render(<GroupConfigEditor group={fullGroup} axes={axes} canEdit onChange={onChange} />)
    fireEvent.click(screen.getByText('＋ เพิ่ม archetype'))
    const call = onChange.mock.calls[0][0] as GroupConfig
    const codes = call.archetypes.map((a) => a.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('warns when a non-fallback archetype has no condition set (dead entry, never matches)', () => {
    const deadGroup: GroupConfig = {
      ...fullGroup,
      archetypes: [{ code: 'dead', title: 'ตาย', body: 'b', minGroupSize: 2, fallback: false }, fullGroup.archetypes[1]],
    }
    render(<GroupConfigEditor group={deadGroup} axes={axes} canEdit onChange={vi.fn()} />)
    expect(screen.getByText(/ไม่มีเงื่อนไข.*ไม่มีวันถูกใช้/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run "app/(admin)/campaigns/[id]/activities/[activityId]/quiz/GroupConfigEditor.test.tsx"`
Expected: FAIL — `GroupConfigEditor.tsx` does not exist yet.

- [ ] **Step 4: Write the implementation**

```typescript
// app/(admin)/campaigns/[id]/activities/[activityId]/quiz/GroupConfigEditor.tsx
'use client'

import { Button, Field, Note, Panel } from '@/components/ui'
import type { GroupArchetype, GroupCondition, GroupConfig, QuizAxis } from '@/lib/quiz/schema'
import { boxStyle, noteStyle, removeAt, replaceAt, rowStyle, smallLabelStyle, uniqueId } from './QuizConfigForm'

const DEFAULT_GROUP: GroupConfig = {
  enabled: true, minMembers: 2, maxMembers: 50, resultLocksAt: 0,
  archetypes: [{ code: 'default', title: '', body: '', minGroupSize: 2, fallback: true }],
  fallbackArchetype: 'default',
}

function ConditionEditor({ condition, canEdit, onChange }: {
  condition: GroupCondition | null | undefined
  canEdit: boolean
  onChange: (condition: GroupCondition | undefined) => void
}) {
  const cond = condition ?? { hasMode: 'any' as const, topN: 1, dominantThreshold: 0.5 }
  const patch = (p: Partial<GroupCondition>) => onChange({ ...cond, ...p })

  return (
    <div style={{ ...boxStyle, background: 'var(--panel-2, transparent)' }}>
      <span style={smallLabelStyle}>เงื่อนไของค์ประกอบกลุ่ม (ไม่ตั้งข้อไหนเลย = ไม่กรองข้อนั้น)</span>
      <div style={rowStyle}>
        <Field id="cond-has-axes" label="มีแกน (คั่นด้วย ,)" hint="เว้นว่าง = ไม่เช็ค">
          <input
            value={(cond.hasAxes ?? []).join(',')} disabled={!canEdit}
            onChange={(e) => {
              const list = e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
              patch({ hasAxes: list.length > 0 ? list : undefined })
            }}
            style={{ fontFamily: 'var(--mono)', width: 140 }}
          />
        </Field>
        <Field id="cond-has-mode" label="แบบ">
          <select value={cond.hasMode} disabled={!canEdit} onChange={(e) => patch({ hasMode: e.target.value as 'any' | 'all' })}>
            <option value="any">มีสักคน (any)</option>
            <option value="all">ต้องมีครบ (all)</option>
          </select>
        </Field>
        <Field id="cond-min-members-with-axis" label="อย่างน้อยกี่คนในแกนนั้น" hint="มีความหมายเมื่อ 'มีแกน' ระบุแกนเดียว">
          <input
            type="number" min={1} disabled={!canEdit}
            value={cond.minMembersWithAxis ?? ''}
            onChange={(e) => patch({ minMembersWithAxis: e.target.value ? Number(e.target.value) : undefined })}
            style={{ width: 64, textAlign: 'right' }}
          />
        </Field>
      </div>
      <div style={rowStyle}>
        <Field id="cond-top-axes" label="อยู่ใน top-N แกน (คั่นด้วย ,)" hint="เว้นว่าง = ไม่เช็ค">
          <input
            value={(cond.topAxes ?? []).join(',')} disabled={!canEdit}
            onChange={(e) => {
              const list = e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
              patch({ topAxes: list.length > 0 ? list : undefined })
            }}
            style={{ fontFamily: 'var(--mono)', width: 140 }}
          />
        </Field>
        <Field id="cond-top-n" label="N">
          <input
            type="number" min={1} max={5} disabled={!canEdit} value={cond.topN}
            onChange={(e) => patch({ topN: Number(e.target.value) })}
            style={{ width: 56, textAlign: 'right' }}
          />
        </Field>
      </div>
      <div style={rowStyle}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <input
            type="checkbox" checked={cond.isBalanced ?? false} disabled={!canEdit}
            onChange={(e) => patch({ isBalanced: e.target.checked || undefined })}
          />
          ไม่มีแกนไหนครองเกิน threshold (สมดุล)
        </label>
        <Field id="cond-threshold" label="threshold">
          <input
            type="number" min={0.3} max={0.9} step={0.05} disabled={!canEdit} value={cond.dominantThreshold}
            onChange={(e) => patch({ dominantThreshold: Number(e.target.value) })}
            style={{ width: 64, textAlign: 'right' }}
          />
        </Field>
        <Field id="cond-max-distinct" label="จำกัดจำนวนแกนต่างกัน" hint="เว้นว่าง = ไม่จำกัด">
          <input
            type="number" min={1} max={6} disabled={!canEdit}
            value={cond.maxDistinct ?? ''}
            onChange={(e) => patch({ maxDistinct: e.target.value ? Number(e.target.value) : undefined })}
            style={{ width: 56, textAlign: 'right' }}
          />
        </Field>
      </div>
    </div>
  )
}

function ArchetypeRow({ archetype, index, canEdit, onChange, onRemove }: {
  archetype: GroupArchetype
  index: number
  canEdit: boolean
  onChange: (patch: Partial<GroupArchetype>) => void
  onRemove: () => void
}) {
  const isDeadNonFallback = !archetype.fallback && !archetype.condition

  return (
    <div style={boxStyle} data-archetype={index}>
      <div style={rowStyle}>
        <Field id={`arch-code-${index}`} label="รหัส">
          <input
            value={archetype.code} maxLength={30} disabled={!canEdit}
            onChange={(e) => onChange({ code: e.target.value })}
            style={{ fontFamily: 'var(--mono)', width: 120 }}
          />
        </Field>
        <div style={{ flex: 1, minWidth: 180 }}>
          <Field id={`arch-title-${index}`} label="หัวข้อ">
            <input
              value={archetype.title} maxLength={120} disabled={!canEdit}
              onChange={(e) => onChange({ title: e.target.value })}
              style={{ width: '100%' }}
            />
          </Field>
        </div>
        <Field id={`arch-min-size-${index}`} label="ขนาดกลุ่มขั้นต่ำ">
          <input
            type="number" min={2} max={200} disabled={!canEdit} value={archetype.minGroupSize}
            onChange={(e) => onChange({ minGroupSize: Number(e.target.value) })}
            style={{ width: 64, textAlign: 'right' }}
          />
        </Field>
        <Field id={`arch-max-size-${index}`} label="ขนาดกลุ่มสูงสุด" hint="เว้นว่าง = ไม่จำกัด">
          <input
            type="number" min={2} max={200} disabled={!canEdit}
            value={archetype.maxGroupSize ?? ''}
            onChange={(e) => onChange({ maxGroupSize: e.target.value ? Number(e.target.value) : undefined })}
            style={{ width: 64, textAlign: 'right' }}
          />
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <input
            type="checkbox" checked={archetype.fallback ?? false} disabled={!canEdit}
            onChange={(e) => onChange({ fallback: e.target.checked })}
          />
          fallback
        </label>
        {canEdit && <Button type="button" variant="ghost" onClick={onRemove}>ลบ</Button>}
      </div>

      <Field id={`arch-body-${index}`} label="เนื้อหา">
        <textarea
          value={archetype.body} maxLength={600} disabled={!canEdit} rows={2}
          onChange={(e) => onChange({ body: e.target.value })}
          style={{ width: '100%' }}
        />
      </Field>

      {!archetype.fallback && (
        <ConditionEditor
          condition={archetype.condition}
          canEdit={canEdit}
          onChange={(condition) => onChange({ condition: condition ?? null })}
        />
      )}

      {isDeadNonFallback && (
        <Note tone="warn">
          archetype นี้ไม่ใช่ fallback แต่ไม่มีเงื่อนไขตั้งไว้เลย — จะไม่มีวันถูกใช้ (ไม่มีเงื่อนไขก็ไม่มีวันตรง)
        </Note>
      )}
    </div>
  )
}

export type GroupConfigEditorProps = {
  group: GroupConfig | undefined
  axes: QuizAxis[]
  canEdit: boolean
  onChange: (group: GroupConfig | undefined) => void
}

export function GroupConfigEditor({ group, axes: _axes, canEdit, onChange }: GroupConfigEditorProps) {
  if (!group) {
    return (
      <Panel style={{ marginTop: 14, padding: 18 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input
            id="group-enabled" type="checkbox" checked={false} disabled={!canEdit}
            onChange={(e) => onChange(e.target.checked ? DEFAULT_GROUP : undefined)}
          />
          เปิดใช้งานผลลัพธ์กลุ่ม
        </label>
      </Panel>
    )
  }

  const addArchetype = () => {
    const code = uniqueId(group.archetypes.map((a) => a.code), 'archetype')
    onChange({ ...group, archetypes: [...group.archetypes, { code, title: '', body: '', minGroupSize: 2, fallback: false }] })
  }
  const updateArchetype = (index: number, patch: Partial<GroupArchetype>) => {
    onChange({ ...group, archetypes: replaceAt(group.archetypes, index, patch) })
  }
  const removeArchetype = (index: number) => {
    const removedCode = group.archetypes[index]?.code
    const archetypes = removeAt(group.archetypes, index)
    const fallbackArchetype = group.fallbackArchetype === removedCode
      ? (archetypes[0]?.code ?? '')
      : group.fallbackArchetype
    onChange({ ...group, archetypes, fallbackArchetype })
  }

  return (
    <Panel style={{ marginTop: 14 }}>
      <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--rule)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input
            id="group-enabled" type="checkbox" checked={group.enabled} disabled={!canEdit}
            onChange={(e) => onChange(e.target.checked ? group : undefined)}
          />
          เปิดใช้งานผลลัพธ์กลุ่ม
        </label>
      </div>

      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={rowStyle}>
          <Field id="group-min-members" label="จำนวนสมาชิกขั้นต่ำ">
            <input
              type="number" min={2} max={200} disabled={!canEdit} value={group.minMembers}
              onChange={(e) => onChange({ ...group, minMembers: Number(e.target.value) })}
              style={{ width: 64, textAlign: 'right' }}
            />
          </Field>
          <Field id="group-max-members" label="จำนวนสมาชิกสูงสุด">
            <input
              type="number" min={2} max={200} disabled={!canEdit} value={group.maxMembers}
              onChange={(e) => onChange({ ...group, maxMembers: Number(e.target.value) })}
              style={{ width: 64, textAlign: 'right' }}
            />
          </Field>
          <Field id="group-result-locks-at" label="ล็อกผลเมื่อครบกี่คน" hint="0 = ไม่ล็อก">
            <input
              type="number" min={0} max={200} disabled={!canEdit} value={group.resultLocksAt}
              onChange={(e) => onChange({ ...group, resultLocksAt: Number(e.target.value) })}
              style={{ width: 64, textAlign: 'right' }}
            />
          </Field>
        </div>

        <span style={smallLabelStyle}>Archetype (ผลลัพธ์ตามองค์ประกอบกลุ่ม) · ตอนนี้มี {group.archetypes.length}</span>
        {group.archetypes.map((archetype, index) => (
          <ArchetypeRow
            key={index}
            archetype={archetype}
            index={index}
            canEdit={canEdit}
            onChange={(patch) => updateArchetype(index, patch)}
            onRemove={() => removeArchetype(index)}
          />
        ))}
        {canEdit && (
          <div>
            <Button type="button" variant="ghost" onClick={addArchetype}>＋ เพิ่ม archetype</Button>
          </div>
        )}

        <Field id="group-fallback-archetype" label="Fallback archetype หลัก" hint="ต้องเป็นรหัสที่มีอยู่จริงในรายการข้างบน">
          <select
            value={group.fallbackArchetype} disabled={!canEdit}
            onChange={(e) => onChange({ ...group, fallbackArchetype: e.target.value })}
          >
            <option value="">— เลือก —</option>
            {group.archetypes.map((a, i) => (
              <option key={i} value={a.code}>{a.code || '(ยังไม่ตั้งรหัส)'}</option>
            ))}
          </select>
        </Field>
        <span style={noteStyle}>ตัวเลือกแกนที่มีอยู่: {_axes.map((a) => a.id).join(', ') || '(ยังไม่มีแกน)'}</span>
      </div>
    </Panel>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run "app/(admin)/campaigns/[id]/activities/[activityId]/quiz/GroupConfigEditor.test.tsx"`
Expected: PASS (all tests)

- [ ] **Step 6: Wire it into `QuizConfigForm.tsx`**

In `QuizConfigForm.tsx`: add `import { GroupConfigEditor } from './GroupConfigEditor'` at the top,
then add this `Panel` right after the closing `</Panel>` of the "ผลลัพธ์ (Results)" block (i.e.
right before the `{validation.success ? (` line):

```typescript
        <GroupConfigEditor
          group={draft.group}
          axes={draft.axes}
          canEdit={canEdit}
          onChange={(group) => setDraft((d) => ({ ...d, group }))}
        />
```

- [ ] **Step 7: Manually verify in the browser**

Run: `npm run dev`, log in, open a `personality_quiz` activity's quiz content screen
(`/campaigns/[id]/activities/[activityId]/quiz`). Confirm: checking "เปิดใช้งานผลลัพธ์กลุ่ม" reveals
the group panel; adding/editing archetypes and their conditions works; saving persists correctly
(reload the page and see the same config); the whole form's existing solo/duo behavior (axes,
questions, results) is unaffected.

- [ ] **Step 8: Run the full unit suite and typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean — this is the point where `GroupConfigEditor.tsx`'s types get checked
against everything else, and where an accidentally-broken existing `QuizConfigForm.test.tsx` would surface.

- [ ] **Step 9: Commit**

```bash
git add "app/(admin)/campaigns/[id]/activities/[activityId]/quiz/GroupConfigEditor.tsx" \
        "app/(admin)/campaigns/[id]/activities/[activityId]/quiz/GroupConfigEditor.test.tsx" \
        "app/(admin)/campaigns/[id]/activities/[activityId]/quiz/QuizConfigForm.tsx"
git commit -m "feat: add group settings + archetype editor to the quiz content screen"
```

---

### Task 9: Whole-branch regression pass

**Files:** none new — verification only.

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Full unit suite**

Run: `npx vitest run`
Expected: all passing, including every test added in Tasks 1-8.

- [ ] **Step 3: Full integration suite** (needs a real Postgres — run `npm run db:reset` first if
the local `linekit_test` database doesn't already have migration `0015` applied)

Run: `npx vitest run tests/*.integration.test.ts`
Expected: all passing.

- [ ] **Step 4: `db:check`**

Run: `npm run db:check`
Expected: `✅ ตรงกันทั้งหมด` — `quiz_group`/`quiz_group_member` listed under skipped/documented tables.

- [ ] **Step 5: Production build**

Run: `npx next build`
Expected: clean — this codebase has a known history of unit-tests-pass-but-production-build-fails
bugs (see Global Constraints of the original quiz-engine plan).

- [ ] **Step 6: Manually verify the existing (untouched) solo/duo flows still work**

Open a solo-mode and a duo-mode `personality_quiz` activity that does **not** have `group.enabled`
set. Confirm both still answer/pair exactly as before this slice — group is additive, and
`loadQuizActivity` never gained a `group`-related check that could reject a config lacking it.
