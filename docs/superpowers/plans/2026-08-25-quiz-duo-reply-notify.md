# Duo Match Notification (Reply) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Never modify anything under `~/Desktop/Codera/KimLIFF` — it is reference-only.**

**Goal:** When B completes a duo quiz match (`POST .../duo/match`), push a LINE message to A (the inviter) automatically, server-side, using a card the admin configured — no LIFF client involvement at all.

**Architecture:** A new optional `replies.duoMatchNotifyCardId` field on `QuizConfig` names a card. After `matchQuizPair` succeeds inside the `duo/match` route, a new best-effort helper (`sendDuoMatchNotify`) loads that card via the existing `loadCards`/`renderCard` pipeline (the same one greeting messages and keyword replies already use) and pushes it to A via `pushMessage`, using a new `push_notify` token-access purpose for a clean audit trail. A new standalone admin page (`.../quiz/replies`) lets the admin pick the card, submitting through the existing `saveQuizConfigAction` (no new server action).

**Tech Stack:** Next.js App Router, `postgres` tagged-template client, Zod, Vitest (unit + `tests/*.integration.test.ts` for real-DB tests) — same as the two prior quiz-engine slices this extends.

**Spec:** `docs/superpowers/specs/2026-08-25-quiz-duo-reply-notify-design.md` — every task below implements one numbered section of it; read the relevant section before starting a task.

## Global Constraints

- **Never modify KimLIFF.** `~/Desktop/Codera/KimLIFF` is reference-only, read for prior-art comparison, never edited.
- The notify step is **best-effort and must never fail B's own request**. `sendDuoMatchNotify` catches every error internally and never throws — the route always returns B's match result regardless of whether the push succeeded.
- The notify step lives in the **route layer** (`app/api/liff/.../duo/match/route.ts`), not the DB layer (`lib/db/quizPairs.ts`) — DB-layer files stay free of LINE-API/render concerns, matching the existing `lib/engine/`/`lib/render/`/`lib/match/` separation (no DB/network) even though `lib/db/*` files themselves aren't held to that same restriction elsewhere in this codebase; the point here is specifically not to grow `matchQuizPair`'s responsibilities.
- **No dynamic message content.** The pushed card is rendered exactly as the admin built it, with an empty `PlayerState` (`{ attributes: {}, counters: {}, entitlements: [], playCounts: {}, completed: [] }`) — no quiz-result substitution. If the card has counter/attribute-driven content it will show as empty/default; this is a known, accepted limitation (see spec §2).
- `readChannelSecret(sql, opts)` takes `sql: postgres.Sql` (not the wider `Queryable`) — anything calling it must have the pooled/real `postgres.Sql`, not a `TransactionSql`.
- `saveQuizConfigAction` (`app/(admin)/campaigns/[id]/activities/[activityId]/quiz/actions.ts`) needs **zero changes** — it already validates+saves the whole `QuizConfig` generically via `QuizConfig.parse`.
- Server Actions never throw/redirect across the boundary — return `ActionResult` (not touched by this plan — no new Server Action is created).
- Unit tests: co-located `*.test.ts`, run by default `npx vitest run`. DB-integration tests: `tests/*.integration.test.ts`, run via `npx vitest run tests/*.integration.test.ts` (excluded from the default run).
- Before any task is considered done: `npx tsc --noEmit` and `npx vitest run` (full unit suite) at minimum; tasks touching the DB additionally need `npx vitest run tests/*.integration.test.ts` (needs a real local Postgres, already migrated by Task 1's own migration once it lands).
- `card_block.block_type` CHECK constraint values (verified against `supabase/migrations/0001_init.sql:168-171`): `'image','title','body','caption','progress_bar','status_row','stamp_grid','divider','spacer','button','video','stamp_card','progress','reward_button'` — **`'text'` is NOT a valid `block_type`** (that's a `card.render_as` value, a different column on a different table). A simple text notification card uses `card.render_as = 'text'` with a `card_block.block_type = 'body'` row holding the plain text in `content`.

---

### Task 1: Migration — add `push_notify` to `TokenPurpose`

**Files:**
- Create: `supabase/migrations/0016_push_notify_token_purpose.sql`
- Modify: `lib/db/tokens.ts`
- Test: `tests/db.integration.test.ts` (extend)

**Interfaces:**
- Produces: `TokenPurpose` gains a new member `'push_notify'`; `token_access_log.purpose` CHECK constraint accepts it.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/0016_push_notify_token_purpose.sql

ALTER TABLE token_access_log DROP CONSTRAINT token_access_log_purpose_check;
ALTER TABLE token_access_log ADD CONSTRAINT token_access_log_purpose_check
  CHECK (purpose IN ('send_reply','publish','verify_signature','display_last4','test_send','fetch_bot_info','push_notify'));
```

- [ ] **Step 2: Write the failing test — before applying the migration**

Add this to `tests/db.integration.test.ts`, inside the existing `describe('quiz engine schema', ...)` block (or a new sibling `describe`, your choice — match the file's existing style either way):

```typescript
  it('token_access_log accepts push_notify as a purpose', async () => {
    const s = await seed(sql)
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO token_access_log (channel_id, actor_type, purpose)
      VALUES (${s.channelId}, 'system', 'push_notify')
      RETURNING id`
    expect(row.id).toBeDefined()
  })
```

`seed(sql)` (already imported at the top of this file from `./helpers/seed`) gives a `channelId` — check `tests/helpers/seed.ts` if you need to confirm its exact shape (it's the same helper Task 1 of the group-mode slice already used this way).

- [ ] **Step 3: Run test to verify it fails**

Do NOT run `db:reset` yet — the local `linekit_test` database still has whatever migration was last applied before this task started (migration 0015 at the latest, from the prior group-mode slice), so `token_access_log`'s CHECK constraint doesn't accept `'push_notify'` yet.

Run: `npx vitest run tests/db.integration.test.ts`
Expected: FAIL — `new row for relation "token_access_log" violates check constraint "token_access_log_purpose_check"`.

- [ ] **Step 4: Apply the migration**

Run: `npm run db:reset` (rebuilds `linekit_test` from all 16 migrations in order, including Step 1's new file)
Expected: applies with no error.

- [ ] **Step 5: Update `TokenPurpose` and confirm the test passes**

In `lib/db/tokens.ts`, change:

```typescript
export type TokenPurpose =
  | 'send_reply' | 'publish' | 'verify_signature' | 'display_last4' | 'test_send' | 'fetch_bot_info'
```

to:

```typescript
export type TokenPurpose =
  | 'send_reply' | 'publish' | 'verify_signature' | 'display_last4' | 'test_send' | 'fetch_bot_info' | 'push_notify'
```

Also extend the file-header comment block (lines 4-19) with one more short paragraph in the same style as the existing `test_send`/`fetch_bot_info` entries, explaining `push_notify`: it's for server-initiated automated pushes (not a reply to something a player typed, not a manual test-send, not a publish) — first user being the duo-match notify feature in this plan.

Run: `npx vitest run tests/db.integration.test.ts`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0016_push_notify_token_purpose.sql lib/db/tokens.ts tests/db.integration.test.ts
git commit -m "feat: add push_notify token purpose for automated server-side pushes"
```

---

### Task 2: `lib/quiz/schema.ts` — `QuizReplies`

**Files:**
- Modify: `lib/quiz/schema.ts`
- Test: `lib/quiz/schema.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: `QuizReplies` (Zod schema + inferred type), and adds an optional `replies: QuizReplies.optional()` field to the existing `QuizConfig` schema. Task 4 (`sendDuoMatchNotify`) reads `cfg.replies?.duoMatchNotifyCardId`. Task 5 (admin UI) reads/writes the same field.

- [ ] **Step 1: Write the failing test**

Add this to the end of `lib/quiz/schema.test.ts`:

```typescript
describe('QuizReplies', () => {
  it('QuizConfig.replies is optional — a config with no replies field is still valid', () => {
    const cfg = {
      mode: 'duo' as const,
      axes: [
        { id: 'ei', label: 'E/I', poles: ['E', 'I'] as [string, string] },
        { id: 'sn', label: 'S/N', poles: ['S', 'N'] as [string, string] },
      ],
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

  it('accepts a replies object with a valid duoMatchNotifyCardId (UUID)', () => {
    expect(QuizReplies.safeParse({ duoMatchNotifyCardId: '123e4567-e89b-12d3-a456-426614174000' }).success).toBe(true)
  })

  it('accepts an empty replies object (no card configured yet)', () => {
    expect(QuizReplies.safeParse({}).success).toBe(true)
  })

  it('rejects a duoMatchNotifyCardId that is not a valid UUID', () => {
    expect(QuizReplies.safeParse({ duoMatchNotifyCardId: 'not-a-uuid' }).success).toBe(false)
  })
})
```

Add `QuizReplies` to the existing `import { QuizConfig } from './schema'` line at the top of the test file — change to `import { QuizConfig, QuizReplies } from './schema'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/quiz/schema.test.ts`
Expected: FAIL — `QuizReplies` is not exported from `./schema` yet.

- [ ] **Step 3: Write the implementation**

Append to `lib/quiz/schema.ts`, after the existing `QuizConfig` block (after its closing `export type QuizConfig = z.infer<typeof QuizConfig>` line — if Task 2 of the group-mode slice already appended `GroupCondition`/`GroupArchetype`/`GroupConfig` there, add this new block after those, at the end of the file):

```typescript
export const QuizReplies = z.object({
  duoMatchNotifyCardId: z.string().uuid().optional(),  // การ์ดแจ้ง A ตอน B ตอบครบ
})
export type QuizReplies = z.infer<typeof QuizReplies>
```

Then add `replies: QuizReplies.optional(),` as a new line inside the existing `QuizConfig` object schema, right after `fallbackResultCode: z.string().min(1),` (or after `group: GroupConfig.optional(),` if that line is already there from the group-mode slice — either position is fine, just keep it inside the same object literal before the closing `})`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/quiz/schema.test.ts`
Expected: PASS (all tests in the file, old and new)

- [ ] **Step 5: Commit**

```bash
git add lib/quiz/schema.ts lib/quiz/schema.test.ts
git commit -m "feat: add QuizReplies (duoMatchNotifyCardId) to QuizConfig"
```

---

### Task 3: `lib/quiz/loadActivity.ts` extension + `lib/db/quizNotify.ts` — the notify helper

**Files:**
- Modify: `lib/quiz/loadActivity.ts`
- Modify: `lib/db/queries.ts` (export `loadCards`)
- Create: `lib/db/quizNotify.ts`
- Test: `lib/db/quizNotify.test.ts` (unit, with mocked dependencies — this module has real I/O so its correctness is proven by the integration test in Task 4, but a fast unit test locks down the "skip when no card configured" and "skip when card not found" branches without needing Postgres)

**Interfaces:**
- Consumes: `DEFAULT_THEME` and (now-exported) `loadCards` from `../db/queries`; `readChannelSecret` from `./tokens`; `renderCard` from `../render/card`; `type Theme` from `../render/flex`; `pushMessage` from `../line/client`; `type QuizConfig` from `../quiz/schema`.
- Produces:
  - `loadQuizActivity(sql, channelId, activityCode): Promise<{ id: string; config: QuizConfig; campaignId: string; theme: Theme } | null>` — same as before, now also returns `campaignId` and `theme` (both come from the same already-joined query, no extra round trip).
  - `sendDuoMatchNotify(sql: postgres.Sql, opts: { campaignId: string; channelId: string; config: QuizConfig; theme: Theme; inviterParticipantId: string }): Promise<void>` — never throws. Task 4 calls this from the `duo/match` route after `matchQuizPair` succeeds.

- [ ] **Step 1: Export `loadCards` from `lib/db/queries.ts`**

In `lib/db/queries.ts`, change:

```typescript
async function loadCards(sql: Queryable, campaignId: string) {
```

to:

```typescript
export async function loadCards(sql: Queryable, campaignId: string) {
```

No other change to this function — it's purely a visibility change, matching how the group-mode slice exported existing `QuizConfigForm.tsx` helpers the same way.

- [ ] **Step 2: Extend `loadQuizActivity`**

In `lib/quiz/loadActivity.ts`, replace the whole file with:

```typescript
// lib/quiz/loadActivity.ts
import type { Queryable } from '../db/client'
import { DEFAULT_THEME } from '../db/queries'
import type { Theme } from '../render/flex'
import { QuizConfig } from './schema'

/**
 * แปลง (channelId, activityCode) → กิจกรรมควิซของแคมเปญที่ "live" บน LIFF ช่องทางนี้
 * — ต้องผ่าน campaign_channel.is_published เท่านั้น (channel เดียวกันอาจเคยพับลิช
 * แคมเปญเก่าไว้ก็ได้ แต่ที่ live ต้องมีแถวนี้เป็น true) ไม่ใช้ any() หรือ query อื่น
 * เพราะ route ทั้งสองของ Task 7/8 ต้องเห็นกฎเดียวกันเป๊ะๆ ผ่าน helper ตัวนี้ตัวเดียว
 *
 * ต้องเช็ค `a.is_enabled` และช่วงวันของแคมเปญ (`start_at`/`end_at`) ด้วย — เหมือนที่
 * lib/db/queries.ts (findLiveCampaign · `WHERE ... AND is_enabled`) และ
 * lib/engine/entry.ts (`ctx.now < campaignStart || ctx.now > campaignEnd`) บังคับกับ
 * ทุกกิจกรรมที่ chat-triggered engine เล่นได้ — ก่อนแก้ตรงนี้ แอดมินปิดกิจกรรมควิซ
 * หรือช่วงแคมเปญหมดอายุแล้ว LIFF ก็ยังรับเล่นต่อได้เรื่อยๆ (Finding 4)
 *
 * `campaignId`/`theme` เพิ่มเข้ามาสำหรับ duo-match-notify (docs/superpowers/specs/
 * 2026-08-25-quiz-duo-reply-notify-design.md) — มาจากแถวที่ query นี้ join อยู่แล้ว
 * ไม่ต้อง query เพิ่มรอบสอง route อื่นที่เรียก loadQuizActivity() อยู่แล้วไม่ต้องแก้
 * อะไร เพราะ TS structural typing ไม่สนใจฟิลด์เกินที่ไม่ได้ใช้
 */
export async function loadQuizActivity(
  sql: Queryable, channelId: string, activityCode: string,
): Promise<{ id: string; config: QuizConfig; campaignId: string; theme: Theme } | null> {
  const [row] = await sql<{ id: string; input_config: unknown; campaign_id: string; theme: Partial<Theme> }[]>`
    SELECT a.id, a.input_config, a.campaign_id, ca.theme
      FROM activity a
      JOIN campaign_channel cc ON cc.campaign_id = a.campaign_id
      JOIN campaign ca ON ca.id = a.campaign_id
     WHERE cc.channel_id = ${channelId} AND cc.is_published
       AND a.code = ${activityCode} AND a.input_type = 'personality_quiz'
       AND a.is_enabled
       AND now() BETWEEN ca.start_at AND ca.end_at`
  if (!row) return null

  const parsed = QuizConfig.parse(row.input_config) // throws → surfaces as 500; a saved-but-invalid config is a bug, not a client error
  return { id: row.id, config: parsed, campaignId: row.campaign_id, theme: { ...DEFAULT_THEME, ...row.theme } }
}
```

- [ ] **Step 3: Run the full unit suite to confirm the extension didn't break existing callers**

Run: `npx vitest run`
Expected: PASS — `loadQuizActivity`'s existing callers (solo/duo/group routes) destructure `{id, config}` and ignore the two new fields; this is purely additive.

- [ ] **Step 4: Write the failing unit test for `sendDuoMatchNotify`**

```typescript
// lib/db/quizNotify.test.ts
import { describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import { sendDuoMatchNotify } from './quizNotify'
import type { QuizConfig } from '../quiz/schema'

const loadCardsMock = vi.fn()
const readChannelSecretMock = vi.fn()
const pushMessageMock = vi.fn()
const renderCardMock = vi.fn()

vi.mock('./queries', () => ({ loadCards: (...args: unknown[]) => loadCardsMock(...args) }))
vi.mock('./tokens', () => ({ readChannelSecret: (...args: unknown[]) => readChannelSecretMock(...args) }))
vi.mock('../line/client', () => ({ pushMessage: (...args: unknown[]) => pushMessageMock(...args) }))
vi.mock('../render/card', () => ({ renderCard: (...args: unknown[]) => renderCardMock(...args) }))

const baseCfg: QuizConfig = {
  mode: 'duo',
  axes: [{ id: 'ei', label: 'E/I', poles: ['E', 'I'] }],
  questions: [{ id: 'q1', text: 'q1', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] }],
  results: [{ code: 'E', title: 't', body: 'b' }],
  fallbackResultCode: 'E',
}

const theme = { primary: '#000', secondary: '#fff', text: '#111' }

/**
 * ตัว sql ปลอมที่เรียกแบบ tagged template ได้จริง (postgres.Sql ใช้แบบ sql`...`) —
 * ต้อง callable ไม่ใช่แค่ object เฉยๆ เพราะเทสต์ที่สาม (pushMessage reject) เดินโค้ด
 * ไปถึงจุดที่ query หา line_uid ของ participant จริงก่อนจะเรียก pushMessage — สอง
 * เทสต์แรก (no card / card not found) ไม่มีวันไปถึงจุดนั้นเลยเพราะ return ก่อน แต่
 * ใช้ตัวเดียวกันนี้ได้ทั้งสามเทสต์เพื่อไม่ต้องแยกสองแบบ
 */
const fakeSql = (() => Promise.resolve([{ line_uid: 'U-fake' }])) as unknown as postgres.Sql

describe('sendDuoMatchNotify', () => {
  it('does nothing when no card is configured', async () => {
    await sendDuoMatchNotify(fakeSql, {
      campaignId: 'camp-1', channelId: 'chan-1', config: baseCfg, theme, inviterParticipantId: 'p-1',
    })
    expect(loadCardsMock).not.toHaveBeenCalled()
    expect(pushMessageMock).not.toHaveBeenCalled()
  })

  it('skips (does not throw) when the configured card is not found in the campaign', async () => {
    loadCardsMock.mockResolvedValueOnce({}) // empty map — card id not present
    const cfg: QuizConfig = { ...baseCfg, replies: { duoMatchNotifyCardId: 'card-missing' } }
    await expect(sendDuoMatchNotify(fakeSql, {
      campaignId: 'camp-1', channelId: 'chan-1', config: cfg, theme, inviterParticipantId: 'p-1',
    })).resolves.toBeUndefined()
    expect(pushMessageMock).not.toHaveBeenCalled()
  })

  it('swallows the error (does not throw) when pushMessage itself rejects, after actually attempting it', async () => {
    loadCardsMock.mockResolvedValueOnce({ 'card-1': { code: 'notify', renderAs: 'text', blocks: [] } })
    readChannelSecretMock.mockResolvedValueOnce('fake-token')
    renderCardMock.mockReturnValueOnce({ type: 'text', text: 'hi' })
    pushMessageMock.mockRejectedValueOnce(new Error('LINE push failed: 500'))
    const cfg: QuizConfig = { ...baseCfg, replies: { duoMatchNotifyCardId: 'card-1' } }
    await expect(sendDuoMatchNotify(fakeSql, {
      campaignId: 'camp-1', channelId: 'chan-1', config: cfg, theme, inviterParticipantId: 'p-1',
    })).resolves.toBeUndefined()
    // ยืนยันว่าจริงๆ แล้วเดินไปถึงจุด reject จริง ไม่ใช่ resolve เฉยๆ เพราะโค้ด plumbing
    // พังตั้งแต่ก่อนถึงจุดนั้นแล้ว (ถ้า mock ไม่ได้ถูกเรียกเลย เทสต์นี้ก็จะผ่านลอยๆ
    // โดยไม่ได้พิสูจน์อะไรจริง)
    expect(pushMessageMock).toHaveBeenCalledTimes(1)
    expect(pushMessageMock).toHaveBeenCalledWith('fake-token', 'U-fake', { type: 'text', text: 'hi' })
  })
})
```

Note: this unit test intentionally does NOT cover the "successful push" happy path with a real `participant` row from a real DB — that's exactly what Task 4's integration test covers end-to-end. This unit test only locks down the early-exit/error-swallowing branches cheaply, using a minimal callable `sql` stub for the one branch that needs to reach the participant lookup.

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run lib/db/quizNotify.test.ts`
Expected: FAIL — `lib/db/quizNotify.ts` does not exist yet.

- [ ] **Step 6: Write the implementation**

```typescript
// lib/db/quizNotify.ts
import type postgres from 'postgres'
import { loadCards } from './queries'
import { readChannelSecret } from './tokens'
import { renderCard } from '../render/card'
import type { Theme } from '../render/flex'
import { pushMessage } from '../line/client'
import type { QuizConfig } from '../quiz/schema'

const EMPTY_STATE = { attributes: {}, counters: {}, entitlements: [], playCounts: {}, completed: [] }

/**
 * แจ้ง A (ผู้ชวน) ว่า B ตอบครบแล้ว — best-effort เสมอ ไม่ throw ออกไปเด็ดขาด (docs/
 * superpowers/specs/2026-08-25-quiz-duo-reply-notify-design.md §4/§6) เพื่อไม่ให้
 * response ของ B ที่กำลังจะส่งกลับได้รับผลกระทบ — ทุกจุดที่ข้ามจะ log เหตุผลไว้แต่
 * ไม่ throw · ไม่มีการแทรกเนื้อหาผลลัพธ์ควิซแบบไดนามิก การ์ดถูกส่งไปตามที่แอดมิน
 * สร้างไว้ตรงๆ ด้วย state ว่างเปล่า (§2)
 */
export async function sendDuoMatchNotify(
  sql: postgres.Sql,
  opts: {
    campaignId: string
    channelId: string
    config: QuizConfig
    theme: Theme
    inviterParticipantId: string
  },
): Promise<void> {
  const cardId = opts.config.replies?.duoMatchNotifyCardId
  if (!cardId) return

  try {
    const cardsById = await loadCards(sql, opts.campaignId)
    const card = cardsById[cardId]
    if (!card) {
      console.error(`[quiz duo notify] card ${cardId} not found in campaign ${opts.campaignId} — skipping`)
      return
    }

    const [inviter] = await sql<{ line_uid: string }[]>`
      SELECT line_uid FROM participant WHERE id = ${opts.inviterParticipantId}`
    if (!inviter) {
      console.error(`[quiz duo notify] inviter participant ${opts.inviterParticipantId} not found — skipping`)
      return
    }

    const accessToken = await readChannelSecret(sql, {
      channelId: opts.channelId, field: 'token', purpose: 'push_notify', appUserId: null,
    })

    const message = renderCard(card, EMPTY_STATE, opts.theme)
    await pushMessage(accessToken, inviter.line_uid, message)
  } catch (err) {
    console.error(`[quiz duo notify] failed to notify inviter ${opts.inviterParticipantId}:`, err)
  }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run lib/db/quizNotify.test.ts`
Expected: PASS (3/3)

- [ ] **Step 8: Commit**

```bash
git add lib/quiz/loadActivity.ts lib/db/queries.ts lib/db/quizNotify.ts lib/db/quizNotify.test.ts
git commit -m "feat: add sendDuoMatchNotify (render card + push, best-effort)"
```

---

### Task 4: Wire into `duo/match` route

**Files:**
- Modify: `app/api/liff/[liffId]/quiz/[activityCode]/duo/match/route.ts`
- Modify: `tests/quiz-liff-duo-routes.integration.test.ts` (extend)

**Interfaces:**
- Consumes: `sendDuoMatchNotify` from `@/lib/db/quizNotify` (Task 3).
- Produces: no new exports — this task only changes the route's internal behavior.

- [ ] **Step 1: Write the failing test**

In `tests/quiz-liff-duo-routes.integration.test.ts`:

First, add two new mocks near the top of the file, right after the existing `vi.mock('@/lib/db/client', ...)` block (before the `const url = ...` line):

```typescript
const pushMessageMock = vi.fn()
const readChannelSecretMock = vi.fn()

vi.mock('@/lib/line/client', () => ({
  pushMessage: (...args: unknown[]) => pushMessageMock(...args),
}))
vi.mock('@/lib/db/tokens', () => ({
  readChannelSecret: (...args: unknown[]) => readChannelSecretMock(...args),
}))
```

These are file-wide mocks (vitest hoists `vi.mock` regardless of where it's textually placed), but they're inert for the existing `describe('duo flow end to end', ...)` tests below — that block's shared `cfg` has no `replies` field, so `sendDuoMatchNotify` returns before ever calling either mocked function. Confirm this explicitly by adding one new test at the END of the existing `describe('duo flow end to end', ...)` block (after the `'matching against yourself returns 400'` test, before that describe's closing `})`):

```typescript
  it('never attempts a push when the activity has no replies configured', () => {
    expect(pushMessageMock).not.toHaveBeenCalled()
  })
```

Then append a whole new `describe` block at the end of the file (after the existing `describe('duo flow end to end', ...)` block's closing `})`):

```typescript
describe('duo match notify', () => {
  let notifyActivityCode: string
  let notifyCardId: string

  beforeAll(async () => {
    const tag = randomBytes(4).toString('hex')
    const [card] = await sql<{ id: string }[]>`
      INSERT INTO card (campaign_id, code, render_as) VALUES (${campaignId}, ${`notifycard${tag}`}, 'text')
      RETURNING id`
    notifyCardId = card.id
    await sql`
      INSERT INTO card_block (card_id, block_type, sort_order, content)
      VALUES (${notifyCardId}, 'body', 1, 'เพื่อนของคุณตอบครบแล้ว!')`

    notifyActivityCode = `quiznotify${tag}`
    await sql`
      INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, input_config)
      VALUES (${campaignId}, ${notifyActivityCode}, 'Personality quiz duo notify', 'personality_quiz', NULL,
        ${sql.json({ ...cfg, replies: { duoMatchNotifyCardId: notifyCardId } } as never)})`
  })

  it('pushes a notification to the inviter when the match completes', async () => {
    pushMessageMock.mockClear()
    readChannelSecretMock.mockClear()
    readChannelSecretMock.mockResolvedValueOnce('fake-access-token')

    const answerReq = new Request('https://example.com', {
      method: 'POST', headers: { ...authHeaders(`${lineUidA}-notify1`), 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: answersA }),
    })
    const answerRes = await postAnswer(answerReq, { params: Promise.resolve({ liffId, activityCode: notifyActivityCode }) })
    expect(answerRes.status).toBe(200)
    const { shareUrl } = await answerRes.json()
    const inviterParticipantId = new URL(shareUrl).searchParams.get('inviterParticipantId')!
    const [inviterRow] = await sql<{ line_uid: string }[]>`SELECT line_uid FROM participant WHERE id = ${inviterParticipantId}`

    const matchReq = new Request('https://example.com', {
      method: 'POST', headers: { ...authHeaders(`${lineUidB}-notify1`), 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviterParticipantId, answers: answersB }),
    })
    const matchRes = await postMatch(matchReq, { params: Promise.resolve({ liffId, activityCode: notifyActivityCode }) })
    expect(matchRes.status).toBe(200)

    expect(pushMessageMock).toHaveBeenCalledTimes(1)
    expect(pushMessageMock).toHaveBeenCalledWith('fake-access-token', inviterRow.line_uid, expect.anything())
    expect(readChannelSecretMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ purpose: 'push_notify' }))
  })

  it('still returns the match result to B even when the push fails', async () => {
    pushMessageMock.mockClear()
    readChannelSecretMock.mockClear()
    readChannelSecretMock.mockResolvedValueOnce('fake-access-token')
    pushMessageMock.mockRejectedValueOnce(new Error('LINE push failed: 500'))

    const answerReq = new Request('https://example.com', {
      method: 'POST', headers: { ...authHeaders(`${lineUidA}-notify2`), 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: answersA }),
    })
    const answerRes = await postAnswer(answerReq, { params: Promise.resolve({ liffId, activityCode: notifyActivityCode }) })
    const { shareUrl } = await answerRes.json()
    const inviterParticipantId = new URL(shareUrl).searchParams.get('inviterParticipantId')!

    const matchReq = new Request('https://example.com', {
      method: 'POST', headers: { ...authHeaders(`${lineUidB}-notify2`), 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviterParticipantId, answers: answersB }),
    })
    const matchRes = await postMatch(matchReq, { params: Promise.resolve({ liffId, activityCode: notifyActivityCode }) })
    expect(matchRes.status).toBe(200)
    const body = await matchRes.json()
    expect(body.resultCode).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quiz-liff-duo-routes.integration.test.ts`
Expected: FAIL — the route doesn't call `sendDuoMatchNotify` yet, so `pushMessageMock` is never called in the two new "duo match notify" tests.

- [ ] **Step 3: Write the implementation**

In `app/api/liff/[liffId]/quiz/[activityCode]/duo/match/route.ts`, add the import:

```typescript
import { sendDuoMatchNotify } from '@/lib/db/quizNotify'
```

Then, inside the existing `try` block, right after the `const rule = activity.config.results.find((r) => r.code === pair.resultCode)!` line and before the `return Response.json({...})` line, insert:

```typescript
    // แจ้ง A แบบ best-effort ก่อน return — await ไว้เพื่อให้ทำงานจบก่อน route handler
    // จบ (Next.js/serverless อาจ freeze function หลัง response ถูกส่งแล้ว) sendDuoMatchNotify
    // ไม่ throw ออกมาเองอยู่แล้วไม่ว่ากรณีไหน จึงไม่กระทบ response ของ B (spec §4/§6)
    await sendDuoMatchNotify(sql, {
      campaignId: activity.campaignId, channelId: auth.liffApp.channelId,
      config: activity.config, theme: activity.theme, inviterParticipantId: pair.participantA,
    })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/quiz-liff-duo-routes.integration.test.ts`
Expected: PASS (all tests in the file, old and new)

- [ ] **Step 5: Run the full unit + integration suites**

Run: `npx vitest run && npx vitest run tests/*.integration.test.ts`
Expected: both clean — this confirms the `loadQuizActivity` extension (Task 3) and this route change together don't break any other quiz route (solo, duo/answer, duo/my-pairs, group/*) that also calls `loadQuizActivity`.

- [ ] **Step 6: Commit**

```bash
git add "app/api/liff/[liffId]/quiz/[activityCode]/duo/match/route.ts" tests/quiz-liff-duo-routes.integration.test.ts
git commit -m "feat: push a notification to the duo inviter on match completion"
```

---

### Task 5: Admin UI — `.../quiz/replies` page

**Files:**
- Create: `app/(admin)/campaigns/[id]/activities/[activityId]/quiz/replies/page.tsx`
- Create: `app/(admin)/campaigns/[id]/activities/[activityId]/quiz/replies/RepliesForm.tsx`
- Modify: `app/(admin)/campaigns/[id]/activities/[activityId]/quiz/page.tsx` (add a nav link to the new page)
- Test: `app/(admin)/campaigns/[id]/activities/[activityId]/quiz/replies/RepliesForm.test.tsx`

**Interfaces:**
- Consumes: `QuizConfig`/`QuizReplies` from `@/lib/quiz/schema` (Task 2), `saveQuizConfigAction` from `../actions` (existing, unchanged), `listCards` from `@/lib/db/cards` (existing), `loadCampaign` from `@/lib/db/campaigns` (existing), UI components (`Button`, `ErrorModal`, `Field`, `Note`, `Panel`, `PageHead`) from `@/components/ui` (existing).
- Produces: `RepliesForm` component — `{ campaignId: string; activityId: string; initial: QuizConfig; cards: { id: string; code: string }[]; canEdit: boolean }`. `QuizRepliesPage` (default export of `page.tsx`).

- [ ] **Step 1: Write the failing test**

```typescript
// @vitest-environment jsdom
// app/(admin)/campaigns/[id]/activities/[activityId]/quiz/replies/RepliesForm.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RepliesForm } from './RepliesForm'
import type { QuizConfig } from '@/lib/quiz/schema'

afterEach(cleanup)

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const saveQuizConfigAction = vi.fn(
  async (_campaignId: string, _activityId: string, _formData: FormData) => ({ ok: true as const }),
)
vi.mock('../actions', () => ({
  saveQuizConfigAction: (campaignId: string, activityId: string, formData: FormData) =>
    saveQuizConfigAction(campaignId, activityId, formData),
}))

const duoConfig: QuizConfig = {
  mode: 'duo',
  axes: [{ id: 'ei', label: 'E/I', poles: ['E', 'I'] }],
  questions: [
    { id: 'q1', text: 'q1', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
    { id: 'q2', text: 'q2', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
    { id: 'q3', text: 'q3', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
  ],
  results: [{ code: 'E', title: 't', body: 'b' }, { code: 'I', title: 't', body: 'b' }],
  fallbackResultCode: 'E',
}

const soloConfig: QuizConfig = { ...duoConfig, mode: 'solo' }
const cards = [{ id: 'card-1', code: 'notify_card' }, { id: 'card-2', code: 'other_card' }]

describe('RepliesForm', () => {
  it('shows a message instead of a card picker when mode is not duo', () => {
    render(<RepliesForm campaignId="c1" activityId="a1" initial={soloConfig} cards={cards} canEdit />)
    expect(screen.queryByLabelText(/การ์ดแจ้งเตือน/)).not.toBeInTheDocument()
    expect(screen.getByText(/ยังไม่ใช่โหมด duo/)).toBeInTheDocument()
  })

  it('shows the card picker with every campaign card as an option when mode is duo', () => {
    render(<RepliesForm campaignId="c1" activityId="a1" initial={duoConfig} cards={cards} canEdit />)
    const select = screen.getByLabelText(/การ์ดแจ้งเตือน/) as HTMLSelectElement
    expect(select).toBeDefined()
    const optionLabels = Array.from(select.options).map((o) => o.textContent)
    expect(optionLabels).toContain('notify_card')
    expect(optionLabels).toContain('other_card')
  })

  it('preselects the currently configured card', () => {
    const initial: QuizConfig = { ...duoConfig, replies: { duoMatchNotifyCardId: 'card-2' } }
    render(<RepliesForm campaignId="c1" activityId="a1" initial={initial} cards={cards} canEdit />)
    const select = screen.getByLabelText(/การ์ดแจ้งเตือน/) as HTMLSelectElement
    expect(select.value).toBe('card-2')
  })

  it('submitting saves the whole QuizConfig with only the replies field changed', async () => {
    render(<RepliesForm campaignId="c1" activityId="a1" initial={duoConfig} cards={cards} canEdit />)
    const select = screen.getByLabelText(/การ์ดแจ้งเตือน/) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'card-1' } })
    fireEvent.click(screen.getByText('บันทึก Replies'))

    await vi.waitFor(() => expect(saveQuizConfigAction).toHaveBeenCalledTimes(1))
    const [savedCampaignId, savedActivityId, formData] = saveQuizConfigAction.mock.calls[0]
    expect(savedCampaignId).toBe('c1')
    expect(savedActivityId).toBe('a1')
    const saved = JSON.parse(String(formData.get('config')))
    expect(saved.replies.duoMatchNotifyCardId).toBe('card-1')
    expect(saved.mode).toBe('duo') // rest of the config carried through unchanged
    expect(saved.axes).toEqual(duoConfig.axes)
  })
})
```

If `vi.waitFor` isn't already used elsewhere in this codebase's tests, check `QuizConfigForm.test.tsx`/`GroupConfigEditor.test.tsx` for whatever async-assertion helper they use instead (e.g. an `await act(...)` pattern) and match that convention rather than introducing a new one.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "app/(admin)/campaigns/[id]/activities/[activityId]/quiz/replies/RepliesForm.test.tsx"`
Expected: FAIL — `RepliesForm.tsx` does not exist yet.

- [ ] **Step 3: Write `RepliesForm.tsx`**

```typescript
// app/(admin)/campaigns/[id]/activities/[activityId]/quiz/replies/RepliesForm.tsx
'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button, ErrorModal, Field, Note, Panel } from '@/components/ui'
import { QuizConfig } from '@/lib/quiz/schema'
import { saveQuizConfigAction } from '../actions'

export type RepliesFormProps = {
  campaignId: string
  activityId: string
  initial: QuizConfig
  cards: { id: string; code: string }[]
  canEdit: boolean
}

export function RepliesForm({ campaignId, activityId, initial, cards, canEdit }: RepliesFormProps) {
  const router = useRouter()
  const [draft, setDraft] = useState<QuizConfig>(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [savedTick, setSavedTick] = useState(0)

  const validation = QuizConfig.safeParse(draft)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    setBusy(true)
    const formData = new FormData()
    formData.set('config', JSON.stringify(draft))
    try {
      const result = await saveQuizConfigAction(campaignId, activityId, formData)
      if (result.ok) {
        setSavedTick((n) => n + 1)
        router.refresh()
        setBusy(false)
      } else {
        setError(result.message)
        setBusy(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ — ลองใหม่')
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <form onSubmit={(event) => void handleSubmit(event)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <fieldset disabled={!canEdit || busy} style={{ border: 0, margin: 0, padding: 0, display: 'contents' }}>
          <Panel style={{ padding: 18 }}>
            {draft.mode !== 'duo' ? (
              <Note tone="mute">ควิซนี้ยังไม่ใช่โหมด duo — ยังไม่มีจุดแจ้งเตือนให้ตั้งค่า</Note>
            ) : (
              <Field
                id="duo-match-notify-card"
                label="การ์ดแจ้งเตือนตอนจับคู่สำเร็จ"
                hint="ส่งให้ผู้ชวน (A) ทันทีที่อีกฝ่าย (B) ตอบครบ — เว้นว่างไว้ = ไม่ส่งอะไร"
              >
                <select
                  value={draft.replies?.duoMatchNotifyCardId ?? ''}
                  disabled={!canEdit}
                  onChange={(e) => setDraft((d) => ({
                    ...d,
                    replies: { ...d.replies, duoMatchNotifyCardId: e.target.value || undefined },
                  }))}
                >
                  <option value="">— ไม่ใช้การ์ด (ไม่ส่งอะไร) —</option>
                  {cards.map((card) => (
                    <option key={card.id} value={card.id}>{card.code}</option>
                  ))}
                </select>
              </Field>
            )}
          </Panel>

          {validation.success ? (
            <Note tone="ok">กรอกครบและถูกต้องตาม schema แล้ว — บันทึกได้</Note>
          ) : (
            <Note tone="warn">
              <div style={{ fontWeight: 600, marginBottom: 6 }}>ยังบันทึกไม่ได้ — มีข้อผิดพลาดดังนี้</div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {validation.error.issues.map((issue, i) => (
                  <li key={i}>{issue.path.join('.') || '(ทั้งก้อน)'}: {issue.message}</li>
                ))}
              </ul>
            </Note>
          )}

          {canEdit && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
              {savedTick > 0 && !busy && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>บันทึกล่าสุดแล้ว</span>}
              <Button type="submit" disabled={!validation.success}>บันทึก Replies</Button>
            </div>
          )}
          {busy && <p aria-live="polite">กำลังบันทึก…</p>}
        </fieldset>
      </form>

      <ErrorModal message={error} onClose={() => setError(null)} />
    </div>
  )
}
```

Check `components/ui`'s `Field` component (used identically already by `QuizConfigForm.tsx`/`GroupConfigEditor.tsx`) to confirm exactly how its `id` prop associates the label with the `<select>` for `getByLabelText` to find it — if `Field` needs an explicit `htmlFor`-matching `id` on the `<select>` itself (not just the wrapping `Field`), add `id="duo-match-notify-card"` to the `<select>` too, matching whatever pattern `GroupConfigEditor.tsx`'s existing `<select>` fields already use.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "app/(admin)/campaigns/[id]/activities/[activityId]/quiz/replies/RepliesForm.test.tsx"`
Expected: PASS (all tests)

- [ ] **Step 5: Write `page.tsx`**

```typescript
// app/(admin)/campaigns/[id]/activities/[activityId]/quiz/replies/page.tsx
import { notFound, redirect } from 'next/navigation'
import { PageHead } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { loadCampaign } from '@/lib/db/campaigns'
import { listCards } from '@/lib/db/cards'
import { db } from '@/lib/db/client'
import { QuizConfig } from '@/lib/quiz/schema'
import { RepliesForm } from './RepliesForm'

type ActivityRow = { id: string; name: string; input_type: string; input_config: unknown }

export default async function QuizRepliesPage({ params }: {
  params: Promise<{ id: string; activityId: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { id, activityId } = await params
  const sql = db()
  const campaign = await loadCampaign(sql, id)
  if (!campaign) notFound()

  const [row] = await sql<ActivityRow[]>`
    SELECT id, name, input_type, input_config FROM activity
     WHERE id = ${activityId} AND campaign_id = ${campaign.id}`
  if (!row || row.input_type !== 'personality_quiz') notFound()

  const parsed = QuizConfig.safeParse(row.input_config)
  const draft: QuizConfig = parsed.success ? parsed.data : {
    mode: (row.input_config as { mode?: unknown })?.mode === 'duo' ? 'duo' : 'solo',
    axes: [],
    questions: [],
    results: [],
    fallbackResultCode: '',
  }

  const cardRows = await listCards(sql, campaign.id)
  const cards = cardRows.map((c) => ({ id: c.id, code: c.code }))
  const canEdit = session.role === 'configurator'

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 760, margin: '0 auto' }}>
      <a
        href={`/campaigns/${campaign.id}/activities/${row.id}/quiz`}
        style={{ fontSize: 12, color: 'var(--ink-3)' }}
      >
        ← ตั้งค่าควิซ
      </a>

      <PageHead code="M7-S06 · Quiz replies" title={`Replies: ${row.name}`} />

      <RepliesForm campaignId={campaign.id} activityId={row.id} initial={draft} cards={cards} canEdit={canEdit} />
    </main>
  )
}
```

Check `CardView`'s exact shape (`lib/db/cards.ts`) to confirm `id`/`code` are the right property names on what `listCards` returns before finalizing the `.map()` line above — adjust if the real field names differ from this plan's assumption.

- [ ] **Step 6: Add the nav link on the main quiz page**

In `app/(admin)/campaigns/[id]/activities/[activityId]/quiz/page.tsx`, find the `<PageHead ... actions={...} />` block (it currently renders a mode `Badge` and, when `!canEdit`, a "ดูอย่างเดียว" `Badge`). Add a link to the new Replies page inside that `actions` fragment, before the existing badges:

```tsx
<a href={`/campaigns/${campaign.id}/activities/${row.id}/quiz/replies`} style={{ fontSize: 12, color: 'var(--ink-3)' }}>
  Replies →
</a>
```

- [ ] **Step 7: Manually verify in the browser**

Run: `npm run dev`, log in, open a duo-mode `personality_quiz` activity's quiz content screen. Confirm: the "Replies →" link navigates to the new page; the page shows the card picker (populated with real cards from that campaign); selecting a card and saving persists it (reload the page, selection survives); switching the main quiz's mode away from `duo` and back to the Replies page shows the "ยังไม่ใช่โหมด duo" message instead of the picker; the "← ตั้งค่าควิซ" link navigates back correctly.

- [ ] **Step 8: Run the full unit suite and typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean.

- [ ] **Step 9: Commit**

```bash
git add "app/(admin)/campaigns/[id]/activities/[activityId]/quiz/replies/" \
        "app/(admin)/campaigns/[id]/activities/[activityId]/quiz/page.tsx"
git commit -m "feat: add standalone Replies admin page for duo-match notify card"
```

---

### Task 6: Whole-branch regression pass

**Files:** none new — verification only.

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Full unit suite**

Run: `npx vitest run`
Expected: all passing, including every test added in Tasks 1-5.

- [ ] **Step 3: Full integration suite** (needs a real Postgres — run `npm run db:reset` first if the local `linekit_test` database doesn't already have migration `0016` applied)

Run: `npx vitest run tests/*.integration.test.ts`
Expected: all passing.

- [ ] **Step 4: `db:check`**

Run: `npm run db:check`
Expected: `✅ ตรงกันทั้งหมด` — schema unaffected by this slice beyond the `token_access_log` CHECK constraint change (no new/changed tables, so the documented-table count and skip-list stay exactly as they were after the group-mode slice).

- [ ] **Step 5: Production build**

Run: `npx next build`
Expected: clean — this codebase has a known history of unit-tests-pass-but-production-build-fails bugs; confirm the new `/replies` route appears in the build's route table alongside the other quiz routes.

- [ ] **Step 6: Manually verify the existing (untouched) solo/duo/group flows still work**

Open a solo-mode activity, a duo-mode activity with NO replies card configured, and a group-mode activity. Confirm none of their behavior changed — solo answers still work, duo matching still works and (with no card configured) does not error or hang, group create/join still works. This confirms the `loadQuizActivity` signature extension (Task 3) is genuinely additive and didn't silently break any of the other 7 routes that call it.
