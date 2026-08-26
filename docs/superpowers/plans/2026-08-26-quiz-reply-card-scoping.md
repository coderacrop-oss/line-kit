# Quiz Reply Card Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cards created for a quiz activity's reply notification belong to that activity alone — selectable only from its own `.../quiz/replies` page, invisible to every other card picker in the platform (keyword rules, activity entry/outcome/fallback, channel default/greeting card, rich menu buttons).

**Architecture:** Add a nullable `card.owner_activity_id` FK column (`NULL` = general campaign card, unchanged behavior everywhere; set = belongs to exactly one activity). Extend the existing `used_by`/orphan-tracking mechanism in `lib/db/cards.ts` to also detect `replies.duoMatchNotifyCardId` references. Reuse the existing Card Builder editor and creation wizard unchanged — thread an optional `ownerActivityId` through the creation path and make the editor's "back" link context-aware.

**Tech Stack:** Next.js App Router, `postgres` tagged-template client, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-26-quiz-reply-card-scoping-design.md`

## Global Constraints

- **NEVER modify anything under `~/Desktop/Codera/KimLIFF`** — separate, real, production reference repo. Read-only, out of scope entirely.
- Migration must be appended to `db:reset`'s chain in `package.json` (a regression class this repo's history has hit twice before — do not repeat it a third time).
- The behavior of general cards (`owner_activity_id IS NULL`) must not change in any way, at any of the 6 existing picker/catalogue surfaces. Every existing test for those surfaces must keep passing unmodified.
- Reuse the existing Card Builder editor (`app/(admin)/campaigns/[id]/cards/[cardId]`) and creation wizard (`app/(admin)/campaigns/[id]/cards/new`) as-is — no new/duplicate editor UI.

---

### Task 1: Migration — `card.owner_activity_id`

**Files:**
- Create: `supabase/migrations/0017_card_owner_activity.sql`
- Modify: `package.json` (append to the `db:reset` script's `&&`-chain, after `0016_push_notify_token_purpose.sql`)
- Test: `tests/cards-delete.integration.test.ts` (extend)

**Interfaces:**
- Produces: `card.owner_activity_id UUID NULL REFERENCES activity(id) ON DELETE CASCADE` — every later task in this plan depends on this column existing.

- [ ] **Step 1: Write the failing tests**

Append to `tests/cards-delete.integration.test.ts` (uses the file's existing `scene()`/`aCard()`/`cardExists()` helpers and `sql`/`tag()` already defined at the top of that file):

```typescript
describe('card.owner_activity_id · cascade ลบ (migration 0017)', () => {
  it('ลบ activity ที่เป็นเจ้าของการ์ด → การ์ดถูกลบตามไปด้วย', async () => {
    const s = await scene()
    const [activity] = await sql<{ id: string }[]>`
      INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, input_config)
      VALUES (${s.campaignId}, ${`quiz_${tag()}`}, 'ควิซทดสอบ', 'personality_quiz', NULL,
              ${sql.json({
                mode: 'duo', axes: [], questions: [], results: [], fallbackResultCode: '',
              } as never)})
      RETURNING id`
    const [card] = await sql<{ id: string }[]>`
      INSERT INTO card (campaign_id, code, owner_activity_id)
      VALUES (${s.campaignId}, ${`owned_${tag()}`}, ${activity.id})
      RETURNING id`

    await sql`DELETE FROM activity WHERE id = ${activity.id}`

    expect(await cardExists(card.id)).toBe(false)
  })

  it('การ์ดทั่วไป (owner_activity_id เป็น NULL) ไม่ถูกลบตอนลบ activity อื่น', async () => {
    const s = await scene()
    const cardId = await aCard(s.campaignId)
    const [activity] = await sql<{ id: string }[]>`
      INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, input_config)
      VALUES (${s.campaignId}, ${`quiz_${tag()}`}, 'ควิซทดสอบ', 'personality_quiz', NULL,
              ${sql.json({
                mode: 'duo', axes: [], questions: [], results: [], fallbackResultCode: '',
              } as never)})
      RETURNING id`

    await sql`DELETE FROM activity WHERE id = ${activity.id}`

    expect(await cardExists(cardId)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cards-delete.integration.test.ts`
Expected: FAIL — `column "owner_activity_id" does not exist` (the `INSERT INTO card (..., owner_activity_id)` statement errors against the current schema).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/0017_card_owner_activity.sql
--
-- การ์ดที่สร้างจากหน้า quiz replies ต้องเป็นของ activity นั้นเพียงจุดเดียว — ไม่โผล่ใน
-- ตัวเลือกของ keyword rule, entry/outcome/fallback card ของ activity อื่น, การ์ด default/
-- greeting ของ channel, หรือปุ่ม rich menu (docs/superpowers/specs/2026-08-26-quiz-reply-
-- card-scoping-design.md §3) NULL คือการ์ดทั่วไปของแคมเปญเหมือนเดิมทุกประการ — คอลัมน์นี้
-- ไม่เปลี่ยนพฤติกรรมของการ์ดที่มีอยู่แล้วสักใบ
--
-- ON DELETE CASCADE: ลบ activity ทั้งอัน → การ์ดที่เป็นของมันถูกลบตามไปด้วยอัตโนมัติ
-- (card_block ของการ์ดนั้นก็ตามไปอีกทอด ผ่าน card_block.card_id ON DELETE CASCADE ที่มีอยู่
-- แล้วจาก 0001_init.sql)

ALTER TABLE card
  ADD COLUMN owner_activity_id UUID REFERENCES activity(id) ON DELETE CASCADE;
```

- [ ] **Step 4: Append to `db:reset`'s chain**

In `package.json`, find the `db:reset` script (a single `&&`-chained line of `psql` commands ending in
`... -f supabase/migrations/0016_push_notify_token_purpose.sql`). Append:

```
 && psql -q -v ON_ERROR_STOP=1 -d linekit_test -f supabase/migrations/0017_card_owner_activity.sql
```

- [ ] **Step 5: Run `db:reset` then the tests again**

Run: `npm run db:reset && npx vitest run tests/cards-delete.integration.test.ts`
Expected: PASS (all tests in the file, including the two new ones).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0017_card_owner_activity.sql package.json tests/cards-delete.integration.test.ts
git commit -m "feat: add card.owner_activity_id column with cascade delete"
```

---

### Task 2: `lib/db/cards.ts` — ownership fields, used_by branch, new list functions

**Files:**
- Modify: `lib/db/cards.ts`
- Test: `lib/db/cards.test.ts` (extend), `tests/cards.integration.test.ts` (extend), `tests/cards-delete.integration.test.ts` (extend)

**Interfaces:**
- Consumes: `card.owner_activity_id` (Task 1).
- Produces:
  - `CardView.ownerActivityId: string | null`, `CardView.ownerActivityName: string | null` — consumed by Task 5 (breadcrumb) and Task 5 (catalogue badge).
  - `listCardsForActivity(sql: postgres.Sql, activityId: string): Promise<CardView[]>` — consumed by Task 6 (replies page).
  - `listUnownedCards(sql: postgres.Sql, campaignId: string): Promise<CardView[]>` — consumed by Task 3 (channel/rich menu pickers).

The current full content of `lib/db/cards.ts` (read it before editing — this is the file you're modifying, quoted here so the diff below is unambiguous):

```typescript
import type postgres from 'postgres'

export const CARD_RENDER_TYPES = [
  'flex_bubble', 'flex_carousel', 'imagemap', 'imagemap_video', 'text',
] as const
export type CardRenderType = (typeof CARD_RENDER_TYPES)[number]

export const CARD_RENDER_NAME: Record<CardRenderType, string> = {
  flex_bubble: 'การ์ดเดี่ยว',
  flex_carousel: 'การ์ดปัดได้',
  imagemap: 'ริชเมสเสจ',
  imagemap_video: 'ริชวิดีโอ',
  text: 'ข้อความล้วน',
}

export const CARD_REF_KINDS = [
  'activity', 'keyword', 'channel', 'carousel', 'stamp', 'richmenu',
] as const
export type CardRefKind = (typeof CARD_REF_KINDS)[number]

export type CardRef = { kind: CardRefKind; label: string }

export const CARD_FILTERS = [
  'ทั้งหมด', 'กิจกรรม', 'คีย์เวิร์ด', 'บัญชี LINE', 'ชุดปัด', 'บัตรแสตมป์', 'ริชเมนู', 'ยังไม่ถูกใช้',
] as const
export type CardFilter = (typeof CARD_FILTERS)[number]

const FILTER_KIND: Record<CardFilter, CardRefKind | null> = {
  'ทั้งหมด': null,
  'กิจกรรม': 'activity',
  'คีย์เวิร์ด': 'keyword',
  'บัญชี LINE': 'channel',
  'ชุดปัด': 'carousel',
  'บัตรแสตมป์': 'stamp',
  'ริชเมนู': 'richmenu',
  'ยังไม่ถูกใช้': null,
}

export const asCardFilter = (raw: string | undefined | null): CardFilter =>
  (CARD_FILTERS as readonly string[]).includes(raw ?? '') ? (raw as CardFilter) : 'ทั้งหมด'

export type CardRow = {
  id: string
  code: string
  render_as: CardRenderType
  has_image: boolean
  title_text: string | null
  title_selector: string | null
  used_by: CardRef[]
}

export type CardView = {
  id: string
  code: string
  renderAs: CardRenderType
  renderName: string
  hasImage: boolean
  previewText: string | null
  usedBy: CardRef[]
  isOrphan: boolean
}

export function summarizeCard(row: CardRow): CardView {
  const usedBy = row.used_by ?? []

  return {
    id: row.id,
    code: row.code,
    renderAs: row.render_as,
    renderName: CARD_RENDER_NAME[row.render_as],
    hasImage: row.has_image,
    previewText: row.title_text
      ?? (row.title_selector ? `เลือกจากชุดเนื้อหา "${row.title_selector}"` : null),
    usedBy,
    isOrphan: usedBy.length === 0,
  }
}

export function filterCards(
  cards: readonly CardView[],
  filter: CardFilter = 'ทั้งหมด',
): CardView[] {
  if (filter === 'ทั้งหมด') return [...cards]
  if (filter === 'ยังไม่ถูกใช้') return cards.filter((card) => card.isOrphan)

  const kind = FILTER_KIND[filter]
  return cards.filter((card) => card.usedBy.some((ref) => ref.kind === kind))
}

function selectCards(sql: postgres.Sql, where: postgres.PendingQuery<CardRow[]>) {
  return sql<CardRow[]>`
    SELECT c.id, c.code, c.render_as,
           EXISTS (SELECT 1 FROM card_block b
                    WHERE b.card_id = c.id AND b.block_type = 'image') AS has_image,
           t.content AS title_text,
           t.selector_name AS title_selector,
           used.refs AS used_by
      FROM card c
      LEFT JOIN LATERAL (
        SELECT b.content, sel.name AS selector_name
          FROM card_block b
          LEFT JOIN card_selector sel ON sel.id = b.selector_id
         WHERE b.card_id = c.id AND b.block_type IN ('title', 'body', 'caption')
         ORDER BY (b.block_type <> 'title'), b.sort_order
         LIMIT 1
      ) t ON true
      CROSS JOIN LATERAL (
        SELECT coalesce(
                 jsonb_agg(jsonb_build_object('kind', kind, 'label', label) ORDER BY label),
                 '[]'::jsonb) AS refs
          FROM (
            SELECT 'activity' AS kind, a.name || ' · การ์ดสำรอง' AS label
              FROM activity a
             WHERE a.campaign_id = c.campaign_id AND a.fallback_card_id = c.id
             UNION
            SELECT 'activity', a.name || ' · ผลลัพธ์ "' || coalesce(o->>'id', '') || '"'
              FROM activity a, jsonb_array_elements(coalesce(a.resolve_config->'outcomes',
                                                             '[]'::jsonb)) o
             WHERE a.campaign_id = c.campaign_id AND o->>'cardId' = c.id::text
             UNION
            SELECT 'activity', a.name || ' · กติกาการเข้าเล่น'
              FROM activity a
             WHERE a.campaign_id = c.campaign_id
               AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.entry_rules) e
                            WHERE e->>'cardId' = c.id::text)
             UNION
            SELECT 'keyword', 'คีย์เวิร์ด "' || k.keyword || '"'
              FROM keyword_rule k
             WHERE k.campaign_id = c.campaign_id AND k.target_card_id = c.id
             UNION
            SELECT 'channel', 'บัญชี ' || ch.name || ' · การ์ดตั้งต้น'
              FROM channel ch
              JOIN campaign_channel cc ON cc.channel_id = ch.id
             WHERE cc.campaign_id = c.campaign_id AND ch.default_card_id = c.id
             UNION
            SELECT 'channel', 'บัญชี ' || ch.name || ' · การ์ดทักทาย'
              FROM channel ch
              JOIN campaign_channel cc ON cc.channel_id = ch.id
             WHERE cc.campaign_id = c.campaign_id AND ch.greeting_card_id = c.id
             UNION
            SELECT 'carousel', 'การ์ด ' || p.code || ' · ใบในชุดปัด'
              FROM card p WHERE p.id = c.parent_card_id
             UNION
            SELECT 'stamp', 'บัตรแสตมป์ของค่าสะสม "' || ct.name || '"'
              FROM stamp_card s
              JOIN counter ct ON ct.id = s.counter_id
             WHERE s.campaign_id = c.campaign_id AND s.card_id = c.id
             UNION
            SELECT 'richmenu', 'ริชเมนู "' || rm.alias || '" · ปุ่มบนเมนู'
              FROM rich_menu rm, jsonb_array_elements(rm.areas) area
             WHERE rm.campaign_id = c.campaign_id
               AND area->>'kind' = 'card' AND area->>'target' = c.id::text
          ) refs
      ) used
     ${where}
     ORDER BY c.code`
}

export async function listCards(sql: postgres.Sql, campaignId: string): Promise<CardView[]> {
  const rows = await selectCards(sql, sql<CardRow[]>`WHERE c.campaign_id = ${campaignId}`)
  return rows.map(summarizeCard)
}

export async function loadCard(
  sql: postgres.Sql, campaignId: string, cardId: string,
): Promise<CardView | null> {
  const rows = await selectCards(
    sql, sql<CardRow[]>`WHERE c.campaign_id = ${campaignId} AND c.id = ${cardId}`,
  )
  const [row] = rows
  return row ? summarizeCard(row) : null
}
```

Make these exact changes:

1. `CardRow` gains two fields (right after `render_as`):
   ```typescript
   render_as: CardRenderType
   owner_activity_id: string | null
   owner_activity_name: string | null
   has_image: boolean
   ```

2. `CardView` gains two fields (right after `renderName`):
   ```typescript
   renderName: string
   ownerActivityId: string | null
   ownerActivityName: string | null
   hasImage: boolean
   ```

3. `summarizeCard` maps them through (right after `renderName: CARD_RENDER_NAME[row.render_as],`):
   ```typescript
   renderName: CARD_RENDER_NAME[row.render_as],
   ownerActivityId: row.owner_activity_id,
   ownerActivityName: row.owner_activity_name,
   hasImage: row.has_image,
   ```

4. `selectCards`'s SELECT list and FROM clause: add the owner columns and a join to `activity` for the owner's name, and add a 4th `'activity'`-kind branch to the used_by union (reusing the existing `'activity'` kind — do NOT add a new `CardRefKind`, see the note below):

   ```sql
   SELECT c.id, c.code, c.render_as, c.owner_activity_id, oa.name AS owner_activity_name,
          EXISTS (SELECT 1 FROM card_block b
                   WHERE b.card_id = c.id AND b.block_type = 'image') AS has_image,
          t.content AS title_text,
          t.selector_name AS title_selector,
          used.refs AS used_by
     FROM card c
     LEFT JOIN activity oa ON oa.id = c.owner_activity_id
     LEFT JOIN LATERAL (
   ```

   (the `LEFT JOIN LATERAL (...) t ON true` block and the `CROSS JOIN LATERAL (...) used` block's opening are unchanged — only insert the new `LEFT JOIN activity oa ON oa.id = c.owner_activity_id` line between `FROM card c` and `LEFT JOIN LATERAL (`)

   Inside the `used` subquery's `UNION`-chain, insert a 4th `'activity'`-kind branch immediately after the existing "กติกาการเข้าเล่น" branch and before the `'keyword'` branch:

   ```sql
             UNION
            SELECT 'activity', a.name || ' · กติกาการเข้าเล่น'
              FROM activity a
             WHERE a.campaign_id = c.campaign_id
               AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.entry_rules) e
                            WHERE e->>'cardId' = c.id::text)
             UNION
            SELECT 'activity', a.name || ' · การ์ดแจ้งเตือน duo'
              FROM activity a
             WHERE a.campaign_id = c.campaign_id
               AND a.input_config->'replies'->>'duoMatchNotifyCardId' = c.id::text
             UNION
            SELECT 'keyword', 'คีย์เวิร์ด "' || k.keyword || '"'
   ```

   > **Why reuse `'activity'` instead of a new kind:** `lib/db/cards.test.ts` asserts
   > `CARD_FILTERS.length === CARD_REF_KINDS.length + 2` and that every kind in `CARD_REF_KINDS`
   > has exactly one isolating filter. `CARD_FILTERS`/`CARD_REF_KINDS` are UI concepts (M3-S01's
   > filter chips) with no filter chip for "quiz reply" — this reference is a 4th way an
   > *activity* can point at a card, filed under the same `'activity'` filter chip as the other
   > three. Adding a new `CardRefKind` here breaks that invariant test without adding any real UI
   > value.

5. Add two new exported functions after `loadCard`:

   ```typescript
   /**
    * การ์ดที่เป็นของ activity นี้เท่านั้น — ใช้โดยหน้า quiz replies (docs/superpowers/specs/
    * 2026-08-26-quiz-reply-card-scoping-design.md §4) การ์ดทั่วไป (owner_activity_id เป็น
    * NULL) ไม่โผล่ที่นี่ แม้จะอยู่แคมเปญเดียวกันก็ตาม
    */
   export async function listCardsForActivity(
     sql: postgres.Sql, activityId: string,
   ): Promise<CardView[]> {
     const rows = await selectCards(sql, sql<CardRow[]>`WHERE c.owner_activity_id = ${activityId}`)
     return rows.map(summarizeCard)
   }

   /**
    * การ์ดทั่วไปของแคมเปญเท่านั้น — ไม่รวมการ์ดที่เป็นของ activity ใดๆ ใช้แทน `listCards`
    * ในทุกจุดที่เป็น "ตัวเลือกทั่วไป" (channel default/greeting card, ปุ่ม rich menu) เพื่อ
    * กันการ์ดที่เป็นของ quiz หลุดไปโผล่ที่อื่น (§5 ของสเปกเดียวกัน)
    */
   export async function listUnownedCards(
     sql: postgres.Sql, campaignId: string,
   ): Promise<CardView[]> {
     const rows = await selectCards(
       sql, sql<CardRow[]>`WHERE c.campaign_id = ${campaignId} AND c.owner_activity_id IS NULL`,
     )
     return rows.map(summarizeCard)
   }
   ```

**Note:** `listCards` and `loadCard` are UNCHANGED in behavior — they still return every card in the
campaign regardless of ownership (this is intentional: the general catalogue page, Task 5, still
shows owned cards, just labeled).

- [ ] **Step 1: Write the failing unit tests**

In `lib/db/cards.test.ts`, the `row()` helper (near the top) needs the two new required `CardRow`
fields added to its defaults:

```typescript
const row = (patch: Partial<CardRow> = {}): CardRow => ({
  id: 'c1',
  code: 'win',
  render_as: 'flex_bubble',
  owner_activity_id: null,
  owner_activity_name: null,
  has_image: false,
  title_text: 'ยินดีด้วย {{attr.name}}',
  title_selector: null,
  used_by: [],
  ...patch,
})
```

Add a new `describe` block after `describe('summarizeCard · ข้อความตัวอย่างบนแผ่นการ์ด', ...)`:

```typescript
describe('summarizeCard · เจ้าของการ์ด', () => {
  it('การ์ดทั่วไปไม่มีเจ้าของ', () => {
    expect(view().ownerActivityId).toBeNull()
    expect(view().ownerActivityName).toBeNull()
  })

  it('การ์ดที่เป็นของ activity มี ownerActivityId/ownerActivityName ส่งต่อมาครบ', () => {
    const card = view({ owner_activity_id: 'a1', owner_activity_name: 'ควิซทดสอบ' })
    expect(card.ownerActivityId).toBe('a1')
    expect(card.ownerActivityName).toBe('ควิซทดสอบ')
  })
})
```

- [ ] **Step 2: Run unit tests to verify they fail**

Run: `npx vitest run lib/db/cards.test.ts`
Expected: FAIL — TypeScript error (`CardRow`/`CardView` missing the new fields) surfaces as a test
run failure, or (if TS is lenient at test-runtime) the two new assertions fail with `undefined`
instead of `null`/the expected value.

- [ ] **Step 3: Write the failing integration tests**

Append to `tests/cards.integration.test.ts` (uses the file's existing `scene()`/`tag()`/`sql` already
defined at the top):

```typescript
describe('listCardsForActivity / listUnownedCards', () => {
  it('listCardsForActivity คืนเฉพาะการ์ดที่เป็นของ activity นั้น', async () => {
    const s = await scene()
    const [activity] = await sql<{ id: string }[]>`
      INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, input_config)
      VALUES (${s.campaignId}, ${`quiz_${tag()}`}, 'ควิซ', 'personality_quiz', NULL,
              ${sql.json({
                mode: 'duo', axes: [], questions: [], results: [], fallbackResultCode: '',
              } as never)})
      RETURNING id`
    const [owned] = await sql<{ id: string }[]>`
      INSERT INTO card (campaign_id, code, owner_activity_id)
      VALUES (${s.campaignId}, ${`owned_${tag()}`}, ${activity.id})
      RETURNING id`
    await sql`INSERT INTO card (campaign_id, code) VALUES (${s.campaignId}, ${`general_${tag()}`})`

    const rows = await listCardsForActivity(sql, activity.id)

    expect(rows.map((c) => c.id)).toEqual([owned.id])
  })

  it('listUnownedCards ไม่รวมการ์ดที่เป็นของ activity ใดๆ', async () => {
    const s = await scene()
    const [activity] = await sql<{ id: string }[]>`
      INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, input_config)
      VALUES (${s.campaignId}, ${`quiz_${tag()}`}, 'ควิซ', 'personality_quiz', NULL,
              ${sql.json({
                mode: 'duo', axes: [], questions: [], results: [], fallbackResultCode: '',
              } as never)})
      RETURNING id`
    await sql`
      INSERT INTO card (campaign_id, code, owner_activity_id)
      VALUES (${s.campaignId}, ${`owned_${tag()}`}, ${activity.id})`
    const [general] = await sql<{ id: string }[]>`
      INSERT INTO card (campaign_id, code) VALUES (${s.campaignId}, ${`general_${tag()}`})
      RETURNING id`

    const rows = await listUnownedCards(sql, s.campaignId)

    expect(rows.map((c) => c.id)).toEqual([general.id])
  })
})
```

Add `listCardsForActivity, listUnownedCards` to the existing `import { ... } from '../lib/db/cards'`
at the top of the file.

Append to `tests/cards-delete.integration.test.ts` (models directly on the existing "คีย์เวิร์ดยังชี้มา
หาการ์ดนี้อยู่" test in the same file):

```typescript
it('replies.duoMatchNotifyCardId ของกิจกรรมยังชี้มาหาการ์ดนี้อยู่ — ปฏิเสธ ไม่ใช่ป้ายว่าไม่มีใครใช้', async () => {
  const s = await scene()
  const cardId = await aCard(s.campaignId)
  await sql`
    INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, input_config)
    VALUES (${s.campaignId}, ${`quiz_${tag()}`}, 'ควิซทดสอบ', 'personality_quiz', NULL,
            ${sql.json({
              mode: 'duo', axes: [], questions: [], results: [], fallbackResultCode: '',
              replies: { duoMatchNotifyCardId: cardId },
            } as never)})`

  const result = await deleteCard(s.campaignId, cardId)

  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.message).toContain('การ์ดแจ้งเตือน')
  expect(await cardExists(cardId)).toBe(true)
})
```

Add this inside the existing `describe('deleteCard · ฐานข้อมูลจริง', ...)` block, after the
"คีย์เวิร์ดยังชี้มาหาการ์ดนี้อยู่" test.

- [ ] **Step 4: Run integration tests to verify they fail**

Run: `npx vitest run tests/cards.integration.test.ts tests/cards-delete.integration.test.ts`
Expected: FAIL — `listCardsForActivity`/`listUnownedCards` don't exist yet (import error), and the
replies-branch test fails because `deleteCard` currently returns `{ ok: true }` for that card.

- [ ] **Step 5: Apply the `lib/db/cards.ts` changes from above**

- [ ] **Step 6: Run all four test files to verify they pass**

Run: `npx vitest run lib/db/cards.test.ts tests/cards.integration.test.ts tests/cards-delete.integration.test.ts`
Expected: PASS (all tests, including every pre-existing test in these files — this file's other 8
`used_by` branches, `deleteCard`'s other guards, and `listCards`/`loadCard`'s existing behavior must
be completely unaffected).

- [ ] **Step 7: Run the full unit + integration suite to check for regressions**

Run: `npx tsc --noEmit && npx vitest run && npx vitest run tests/*.integration.test.ts`
Expected: all clean — `CardView`/`CardRow` gained required fields, so every other file that
constructs a `CardRow`/`CardView` literal (if any exist outside `cards.ts`/`cards.test.ts`) would
surface here as a type error.

- [ ] **Step 8: Commit**

```bash
git add lib/db/cards.ts lib/db/cards.test.ts tests/cards.integration.test.ts tests/cards-delete.integration.test.ts
git commit -m "feat: add card ownership fields, replies used_by branch, listCardsForActivity/listUnownedCards"
```

---

### Task 3: Exclude activity-owned cards from the 5 general pickers

**Files:**
- Modify: `lib/db/keywords.ts`, `lib/db/activities.ts`, `app/(admin)/channels/[id]/page.tsx`, `lib/db/richmenu.ts`
- Test: `tests/keywords.integration.test.ts` (extend), `tests/activities.integration.test.ts` (extend)

**Interfaces:**
- Consumes: `listUnownedCards` (Task 2).

- [ ] **Step 1: Write the failing tests**

In `tests/keywords.integration.test.ts` (uses the file's existing `seed` import from
`./helpers/seed` and its own `tag()`), add a new test in the existing top-level `describe` (or a new
one) near the existing card-list test:

```typescript
it('การ์ดที่เป็นของ activity อื่น ไม่โผล่ในรายการให้เลือกเป็นปลายทาง', async () => {
  const s = await seed(sql)
  const [ownedCard] = await sql<{ id: string }[]>`
    INSERT INTO card (campaign_id, code, owner_activity_id)
    VALUES (${s.campaignId}, ${`owned_${tag()}`}, ${s.activityId})
    RETURNING id`

  const data = await loadKeywordScreen(sql, s.campaignId)

  expect(data.cards.map((c) => c.id)).not.toContain(ownedCard.id)
})
```

In `tests/activities.integration.test.ts` (uses the file's existing local `aCampaign()`,
`anActivity(campaignId, patch?)`, `aCard(campaignId, code?)` helpers), add a new test near the
existing "การ์ดของแคมเปญอื่นไม่โผล่ในรายการให้เลือก" test:

```typescript
it('การ์ดที่เป็นของ activity อื่นในแคมเปญเดียวกัน ไม่โผล่ในรายการให้เลือก', async () => {
  const mine = await aCampaign()
  const activityId = await anActivity(mine.campaignId)
  const otherActivityId = await anActivity(mine.campaignId)
  const [ownedCard] = await sql<{ id: string }[]>`
    INSERT INTO card (campaign_id, code, owner_activity_id)
    VALUES (${mine.campaignId}, ${`owned_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`},
            ${otherActivityId})
    RETURNING id`

  const screen = await loadActivity(sql, mine.campaignId, activityId)

  expect(screen?.cards.map((c) => c.id)).not.toContain(ownedCard.id)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/keywords.integration.test.ts tests/activities.integration.test.ts`
Expected: FAIL — both currently return every campaign card regardless of ownership, so the owned
card IS in the result.

- [ ] **Step 3: Fix `lib/db/keywords.ts`**

Find the card query (currently `SELECT id, code FROM card WHERE campaign_id = ${campaignId} ORDER BY code`,
inside `loadKeywordScreen`'s `Promise.all`). Change to:

```typescript
sql<{ id: string; code: string }[]>`
  SELECT id, code FROM card
   WHERE campaign_id = ${campaignId} AND owner_activity_id IS NULL
   ORDER BY code`,
```

- [ ] **Step 4: Fix `lib/db/activities.ts`**

Find the card query (currently `SELECT id, code FROM card WHERE campaign_id = ${campaignId} ORDER BY code`,
typed as `CardOption[]`, inside `loadActivity`'s `Promise.all`). Change to:

```typescript
sql<CardOption[]>`
  SELECT id, code FROM card
   WHERE campaign_id = ${campaignId} AND owner_activity_id IS NULL
   ORDER BY code`,
```

- [ ] **Step 5: Fix `app/(admin)/channels/[id]/page.tsx`**

Change the import of `listCards` from `@/lib/db/cards` to `listUnownedCards`, and change:

```typescript
const greetingCards = channel?.liveCampaignId
  ? await listCards(db(), channel.liveCampaignId)
  : []
```

to:

```typescript
const greetingCards = channel?.liveCampaignId
  ? await listUnownedCards(db(), channel.liveCampaignId)
  : []
```

- [ ] **Step 6: Fix `lib/db/richmenu.ts`**

Change the import of `listCards` from `./cards` (or `@/lib/db/cards`, match whatever the existing
import path in this file is) to `listUnownedCards`, and change the call inside `loadRichMenuScreen`'s
`Promise.all` from `listCards(sql, campaignId)` to `listUnownedCards(sql, campaignId)`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/keywords.integration.test.ts tests/activities.integration.test.ts`
Expected: PASS (all tests in both files, including every pre-existing test).

- [ ] **Step 8: Run the full unit + integration suite to check for regressions**

Run: `npx tsc --noEmit && npx vitest run && npx vitest run tests/*.integration.test.ts`
Expected: all clean — specifically watch `tests/channels.integration.test.ts` and
`tests/richmenu.integration.test.ts`/`tests/richmenu-composition.integration.test.ts` for any
regression, since those exercise the two files changed in Steps 5-6 without a new ownership-specific
test of their own (their existing tests must still pass unmodified, proving the general-card path
through `listUnownedCards` behaves identically to `listCards` for cards with no owner).

- [ ] **Step 9: Commit**

```bash
git add lib/db/keywords.ts lib/db/activities.ts "app/(admin)/channels/[id]/page.tsx" lib/db/richmenu.ts \
        tests/keywords.integration.test.ts tests/activities.integration.test.ts
git commit -m "fix: exclude activity-owned cards from keyword/activity/channel/richmenu pickers"
```

---

### Task 4: Thread `ownerActivityId` through card creation

**Files:**
- Modify: `lib/cards/create.ts`, `app/(admin)/campaigns/[id]/cards/new/actions.ts`, `app/(admin)/campaigns/[id]/cards/new/page.tsx`
- Test: `app/(admin)/campaigns/[id]/cards/new/actions.test.ts` (extend)

**Interfaces:**
- Consumes: `card.owner_activity_id` (Task 1).
- Produces: `CreateCardInput.ownerActivityId?: string` — consumed by Task 6 (the "+ create card" link on
  the replies page links to `.../cards/new?owner=<activityId>&...`).

- [ ] **Step 1: Write the failing test**

In `app/(admin)/campaigns/[id]/cards/new/actions.test.ts`, the shared `sql` mock already exposes
`cardInsert()` (finds the `INSERT INTO card (` statement). Add a new test inside the existing
`describe('สิ่งที่ถูกเขียนลงไป', ...)` block:

```typescript
it('owner_activity_id ที่ส่งมาถูกเขียนลงไปด้วย', async () => {
  signedInAs('configurator')
  await runExpectingRedirect(validForm({ owner_activity_id: 'activity-1' }))

  const insert = cardInsert()
  expect(insert?.text).toContain('owner_activity_id')
  expect(insert?.values).toContain('activity-1')
})

it('ไม่ส่ง owner_activity_id มา → เขียนเป็น NULL (การ์ดทั่วไป)', async () => {
  signedInAs('configurator')
  await runExpectingRedirect(validForm())

  const insert = cardInsert()
  expect(insert?.text).toContain('owner_activity_id')
  expect(insert?.values).toContain(null)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run "app/(admin)/campaigns/[id]/cards/new/actions.test.ts"`
Expected: FAIL — the current `INSERT INTO card (...)` statement has no `owner_activity_id` column at
all, so `insert?.text` doesn't contain it.

- [ ] **Step 3: Extend `lib/cards/create.ts`**

Change `CreateCardInput`:

```typescript
export type CreateCardInput = {
  campaignId: string
  code: string
  sendType: SendType
  templateCode: string
  ownerActivityId?: string
}
```

Change the `INSERT INTO card` statement inside `createCardFromTemplate` (currently
`INSERT INTO card (campaign_id, code, render_as, template_code, has_sample_text) VALUES (${input.campaignId}, ${input.code}, ${input.sendType}, ${template.code}, ${sample}) RETURNING id`):

```typescript
const [card] = await tx<{ id: string }[]>`
  INSERT INTO card (campaign_id, code, render_as, template_code, has_sample_text, owner_activity_id)
  VALUES (${input.campaignId}, ${input.code}, ${input.sendType},
          ${template.code}, ${sample}, ${input.ownerActivityId ?? null})
  RETURNING id`
```

- [ ] **Step 4: Extend `app/(admin)/campaigns/[id]/cards/new/actions.ts`**

In `createCard`, after reading `code`, read the optional owner field and pass it through:

```typescript
const code = trimmed(formData, 'code')
const ownerActivityId = trimmed(formData, 'owner_activity_id') || undefined

const { id } = await createCardFromTemplate(db(), {
  campaignId,
  code,
  sendType,
  templateCode: trimmed(formData, 'template_code'),
  ownerActivityId,
})
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run "app/(admin)/campaigns/[id]/cards/new/actions.test.ts"`
Expected: PASS (all tests, including every pre-existing test in the file).

- [ ] **Step 6: Thread the `owner` query param through the wizard's steps (`new/page.tsx`)**

This step has no dedicated unit test (the wizard page is a Server Component whose href-building is
plain string interpolation) — verify manually per Step 7. In
`app/(admin)/campaigns/[id]/cards/new/page.tsx`:

Read the owner id from `searchParams` (alongside the existing `single('send')`/`single('tpl')`):

```typescript
const single = (key: string) => (typeof query[key] === 'string' ? query[key] : undefined)
const send = asSendType(single('send'))
const ownerActivityId = single('owner')
```

Thread it through both step hrefs and the back-link:

```typescript
const ownerSuffix = ownerActivityId ? `&owner=${encodeURIComponent(ownerActivityId)}` : ''
const cardsHref = ownerActivityId
  ? `/campaigns/${campaign.id}/activities/${ownerActivityId}/quiz/replies`
  : `/campaigns/${campaign.id}/cards`
const stepOneHref = (value: string) => `?send=${encodeURIComponent(value)}${ownerSuffix}`
const stepTwoHref = (code: string) =>
  `?send=${encodeURIComponent(send ?? '')}&tpl=${encodeURIComponent(code)}${ownerSuffix}`
```

Add a hidden input alongside the existing `campaign_id`/`send_type`/`template_code` hidden inputs in
the final `<form action={createCard} ...>`:

```tsx
<input type="hidden" name="campaign_id" value={campaign.id} />
<input type="hidden" name="send_type" value={send} />
<input type="hidden" name="template_code" value={template.code} />
{ownerActivityId && <input type="hidden" name="owner_activity_id" value={ownerActivityId} />}
```

- [ ] **Step 7: Manually verify the wizard end to end**

Run: `npm run dev`, log in as a configurator, navigate to
`/campaigns/<id>/cards/new?owner=<some-real-activity-id>`. Confirm: the "← ..." back-link at the top
points to that activity's `.../quiz/replies` page instead of the general card catalogue; clicking
through step 1 and step 2 preserves `&owner=...` in the URL; after submitting, the newly created
card's row in the database has `owner_activity_id` set to the activity id (spot-check via
`psql linekit_test -c "SELECT code, owner_activity_id FROM card ORDER BY created_at DESC LIMIT 1"`).
Also confirm the unchanged path (`/campaigns/<id>/cards/new`, no `owner` param) still creates a card
with `owner_activity_id` NULL and the back-link still points to the general catalogue.

- [ ] **Step 8: Run the full unit suite and typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean.

- [ ] **Step 9: Commit**

```bash
git add lib/cards/create.ts "app/(admin)/campaigns/[id]/cards/new/actions.ts" \
        "app/(admin)/campaigns/[id]/cards/new/page.tsx" \
        "app/(admin)/campaigns/[id]/cards/new/actions.test.ts"
git commit -m "feat: thread ownerActivityId through card creation wizard"
```

---

### Task 5: Card Builder breadcrumb + catalogue ownership badge

**Files:**
- Modify: `app/(admin)/campaigns/[id]/cards/[cardId]/page.tsx`, `app/(admin)/campaigns/[id]/cards/CardTile.tsx`

**Interfaces:**
- Consumes: `CardView.ownerActivityId`/`ownerActivityName` (Task 2) — flows through `loadCardEditor`
  (`lib/db/cardEditor.ts`) and `listCards` (both already return full `CardView`, no changes needed to
  either of those two functions).

This task is UI-only with no new server logic, so it has no new automated test of its own — it is
verified by the existing `CardTile`/`CardEditPage` structure continuing to render (no test file
currently covers either component's JSX output directly; the pre-existing test suite passing after
this change, plus manual verification in Step 3, is the coverage for this task).

- [ ] **Step 1: Conditional breadcrumb in `app/(admin)/campaigns/[id]/cards/[cardId]/page.tsx`**

Find the back-link near the top of the component (currently):

```tsx
<a
  href={`/campaigns/${id}/cards`}
  style={{ fontSize: 12, color: 'var(--ink-3)', display: 'inline-block', marginBottom: 10 }}
>
  ← การ์ดทั้งหมด
</a>
```

Replace with:

```tsx
<a
  href={
    screen.card.ownerActivityId
      ? `/campaigns/${id}/activities/${screen.card.ownerActivityId}/quiz/replies`
      : `/campaigns/${id}/cards`
  }
  style={{ fontSize: 12, color: 'var(--ink-3)', display: 'inline-block', marginBottom: 10 }}
>
  {screen.card.ownerActivityId ? '← กลับไป Replies' : '← การ์ดทั้งหมด'}
</a>
```

- [ ] **Step 2: Ownership badge in `app/(admin)/campaigns/[id]/cards/CardTile.tsx`**

Find the header row inside the card tile (currently):

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
  <span style={{ fontSize: 13, fontWeight: 600 }}>{card.code}</span>
  <Badge tone="mute">{card.renderName}</Badge>
</div>
```

Add a third badge when the card is owned:

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
  <span style={{ fontSize: 13, fontWeight: 600 }}>{card.code}</span>
  <Badge tone="mute">{card.renderName}</Badge>
  {card.ownerActivityName && <Badge tone="mute">เป็นของ quiz: {card.ownerActivityName}</Badge>}
</div>
```

- [ ] **Step 3: Manually verify**

Run: `npm run dev`, log in, open the general card catalogue (`/campaigns/<id>/cards`) for a campaign
that has at least one activity-owned card (create one via Task 4's flow first, or `UPDATE card SET
owner_activity_id = '<some activity id>' WHERE id = '<some card id>'` directly for a quick check).
Confirm: the owned card's tile shows the "เป็นของ quiz: ..." badge; opening that card's edit page
shows "← กลับไป Replies" instead of "← การ์ดทั้งหมด", and clicking it lands on that activity's
`.../quiz/replies` page; a general (unowned) card's tile and edit-page breadcrumb are both completely
unchanged from before this task.

- [ ] **Step 4: Run the full unit suite and typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/campaigns/[id]/cards/[cardId]/page.tsx" "app/(admin)/campaigns/[id]/cards/CardTile.tsx"
git commit -m "feat: show ownership breadcrumb/badge for activity-owned cards"
```

---

### Task 6: Quiz replies page — scope to owned cards, add create-card link

**Files:**
- Modify: `app/(admin)/campaigns/[id]/activities/[activityId]/quiz/replies/page.tsx`
- Test: `app/(admin)/campaigns/[id]/activities/[activityId]/quiz/replies/RepliesForm.test.tsx` (no
  change needed — `RepliesForm` itself is untouched, see below)

**Interfaces:**
- Consumes: `listCardsForActivity` (Task 2).

`RepliesForm.tsx` itself does not change in this task — it already just renders whatever `cards` prop
it's given (it has no knowledge of where those cards came from). Only `page.tsx` changes: which
function it calls to build that prop, and one new link rendered alongside the form.

The current full content of `app/(admin)/campaigns/[id]/activities/[activityId]/quiz/replies/page.tsx`:

```typescript
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

- [ ] **Step 1: Write the failing test**

There is no existing test file for `page.tsx` itself (it's a Server Component, and the established
convention in this codebase — confirmed across `RepliesForm.test.tsx` and every other `quiz/*`
screen's tests — is to test the client sub-component, not the Server Component page directly). This
task's behavior change (which cards are listed) is proven by Task 2's `listCardsForActivity`
integration test, which already covers the filtering logic this page now delegates to. Skip to Step
2 — there is no new automated test to write for `page.tsx` itself; verify this task via Step 3's
manual check plus the regression suite in Step 4.

- [ ] **Step 2: Apply the changes**

Change the import (remove `listCards`, add `listCardsForActivity`):

```typescript
import { listCardsForActivity } from '@/lib/db/cards'
```

Change how `cards` is built:

```typescript
const cardRows = await listCardsForActivity(sql, row.id)
const cards = cardRows.map((c) => ({ id: c.id, code: c.code }))
```

Add a "+ create card" link inside the `<main>`, after the `PageHead` and before `<RepliesForm .../>`:

```tsx
<PageHead code="M7-S06 · Quiz replies" title={`Replies: ${row.name}`} />

{canEdit && (
  <div style={{ marginBottom: 14 }}>
    <a
      href={`/campaigns/${campaign.id}/cards/new?owner=${encodeURIComponent(row.id)}`}
      style={{ fontSize: 12, color: 'var(--ink-3)' }}
    >
      + สร้างการ์ดใหม่สำหรับ quiz นี้
    </a>
  </div>
)}

<RepliesForm campaignId={campaign.id} activityId={row.id} initial={draft} cards={cards} canEdit={canEdit} />
```

- [ ] **Step 3: Manually verify end to end**

Run: `npm run dev`, log in as a configurator, open a duo-mode quiz activity's `.../quiz/replies`
page. Confirm: with no owned cards yet, the dropdown is empty (only the "— ไม่ใช้การ์ด —" option)
and the "+ สร้างการ์ดใหม่สำหรับ quiz นี้" link is visible; clicking it lands on the creation wizard
with `?owner=<this activity's id>` in the URL (per Task 4); completing the wizard redirects to the
card editor, whose breadcrumb (per Task 5) says "← กลับไป Replies" and returns here; the newly
created card now appears in this page's dropdown; a card created via the general `+ สร้างการ์ด`
button on the main catalogue (no owner) does NOT appear in this dropdown.

- [ ] **Step 4: Run the full unit + integration suite**

Run: `npx tsc --noEmit && npx vitest run && npx vitest run tests/*.integration.test.ts`
Expected: all clean, including `RepliesForm.test.tsx` (unchanged, still passing — it never touches
`page.tsx`'s data-fetching, only `RepliesForm`'s own props).

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/campaigns/[id]/activities/[activityId]/quiz/replies/page.tsx"
git commit -m "feat: scope quiz replies card picker to activity-owned cards, add create-card link"
```

---

### Task 7: Whole-branch regression pass

**Files:** none new — verification only.

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Full unit suite**

Run: `npx vitest run`
Expected: all passing, including every test added in Tasks 1-6.

- [ ] **Step 3: Full integration suite** (needs a real Postgres — run `npm run db:reset` first if the
local `linekit_test` database doesn't already have migration `0017` applied)

Run: `npx vitest run tests/*.integration.test.ts`
Expected: all passing.

- [ ] **Step 4: `db:check`**

Run: `npm run db:check`
Expected: `✅ ตรงกันทั้งหมด` — this slice adds one nullable column to an already-documented table
(`card`), not a new table, so the documented-table count and skip-list should be unaffected.

- [ ] **Step 5: Production build**

Run: `npx next build`
Expected: clean.

- [ ] **Step 6: Manually verify all 6 previously-existing card pickers are unaffected for general cards**

Open, for a campaign with at least one general (unowned) card: the card catalogue
(`/campaigns/<id>/cards`), a keyword rule's target-card dropdown, an activity's entry-rule/outcome/
fallback card dropdowns, a channel's default/greeting card dropdown, and a rich menu button's card
target picker. Confirm every general card still appears in every one of these exactly as it did
before this plan — none should show the new "เป็นของ quiz" badge, none should be missing from any
dropdown.

- [ ] **Step 7: Manually verify the full owned-card lifecycle**

Create a card via the `.../quiz/replies` page's "+ create" link, design a block or two, save, select
it as the notify card, save the replies form. Confirm it does NOT appear in any of the 5 general
pickers from Step 6. Then delete the owning activity entirely and confirm (via
`psql linekit_test -c "SELECT id FROM card WHERE id = '<that card's id>'"`) that the card row is
gone.
