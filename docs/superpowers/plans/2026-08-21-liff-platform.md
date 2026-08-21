# LIFF Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a LIFF app (any LIFF that chooses to call it — not KimLIFF, which stays untouched) verify a
player's identity against LineKit and read/write a small JSON blob of its own data, sharing the same
`participant` identity the webhook already uses.

**Architecture:** Two new tables (`liff_app` registry, `liff_session` generic JSON storage) behind two new
API routes (`/api/liff/[liffId]/me`, `/api/liff/[liffId]/session`), guarded by a shared auth resolver that
accepts either a LINE `id_token` (browser calls) or a per-`liff_app` API key (server-to-server calls). A
minimal admin screen registers new LIFF apps. No game logic, no push/notify endpoint — pure identity +
storage, per the approved spec.

**Tech Stack:** Next.js App Router route handlers, Postgres via `postgres` (the `sql` tagged-template client
already used everywhere else), Vitest for unit + integration tests.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-21-liff-platform-design.md` — every task below traces to a section
  of it; re-read the relevant section before starting a task if anything here seems ambiguous.
- Do not touch `KimLIFF/laan-kijjakam` — it is reference material only, not part of this codebase.
- Do not build a notify/push endpoint, a multi-axis quiz engine, rate limiting, or a GIN index on
  `liff_session.data` — all explicitly out of scope per spec §2.
- Secrets (the LIFF API key) are encrypted before storage and never readable back in full after save — same
  rule as `channel` tokens (DD-03), using the existing `lib/crypto/secretbox.ts` (`encryptSecret`,
  `decryptSecret`, `last4`, `CURRENT_KEY_VERSION`).
- Follow existing repo conventions exactly: Thai comments only where the WHY is non-obvious, `ActionResult`
  return shape (never throw across a Server Action boundary — see `app/(admin)/channels/actions.ts` for why),
  ports/adapters style already used in `lib/db/*.ts`.
- Run `npm run typecheck` and `npm test` after every task; run `npm run test:integration` (needs Postgres at
  `TEST_DATABASE_URL`, defaults to `postgres://localhost:5432/linekit_test`, rebuilt via `npm run db:reset`)
  after any task touching real SQL.

---

### Task 1: Migration — `liff_app` and `liff_session` tables

**Files:**
- Create: `supabase/migrations/0013_liff_platform.sql`
- Modify: `package.json:15` (the `db:reset` script — append this migration to the `psql` chain, same pattern
  as the existing eleven)

**Interfaces:**
- Produces: tables `liff_app(id, name, liff_id, line_login_channel_id, channel_id, encrypted_api_key,
  api_key_last4, key_version, created_at, created_by)` and `liff_session(id, liff_app_id, participant_id,
  external_key, data, created_at, updated_at)`, plus the two indexes from spec §4.

- [ ] **Step 1: Write the migration file**

```sql
-- 0013_liff_platform.sql
-- ทะเบียน LIFF ที่ต่อกับ LineKit + ที่เก็บข้อมูลทั่วไปของแต่ละ LIFF
-- ดู docs/superpowers/specs/2026-08-21-liff-platform-design.md §4 สำหรับเหตุผลของทุกคอลัมน์

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

- [ ] **Step 2: Wire it into `db:reset`**

Open `package.json`, find the `db:reset` script (a chain of `psql ... -f supabase/migrations/000N_*.sql &&`
statements ending at `0011_card_imagemap_video.sql` — note migration `0012_fetch_bot_info_token_purpose.sql`
already exists in `supabase/migrations/` but check whether `db:reset` already includes it; if not, add both
`0012` and `0013` in order). Append:

```
&& psql -q -v ON_ERROR_STOP=1 -d linekit_test -f supabase/migrations/0012_fetch_bot_info_token_purpose.sql && psql -q -v ON_ERROR_STOP=1 -d linekit_test -f supabase/migrations/0013_liff_platform.sql
```

(Only add the `0012` segment if it's genuinely missing — check the current script text first with
`grep -o "00[0-9]*_[a-z_]*\.sql" package.json` before editing, so you don't duplicate an entry.)

- [ ] **Step 3: Rebuild the test database and confirm it applies cleanly**

Run: `npm run db:reset`
Expected: no errors; last line shows migration `0013` applied.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0013_liff_platform.sql package.json
git commit -m "feat: add liff_app and liff_session tables"
```

---

### Task 2: Extract a channel-UUID-keyed `ensureParticipant` helper (DRY, shared by webhook and LIFF)

The webhook's existing `ensureParticipant` (inlined in `lib/db/queries.ts`'s `makePorts()`) is keyed by
`channel.line_channel_id` (text), because that's all a LINE webhook payload carries. The LIFF auth path will
already have `channel.id` (UUID) directly from `liff_app.channel_id` — looping it through a `line_channel_id`
text lookup just to get back to the UUID it started with would be silly indirection. Extract the actual
`INSERT ... ON CONFLICT` into a UUID-keyed primitive both paths funnel through, so there is exactly one place
that decides what "the same participant" means (spec §3.1).

**Files:**
- Create: `lib/db/participants.ts`
- Test: `lib/db/participants.test.ts`
- Modify: `lib/db/queries.ts:227-237` (the `ensureParticipant` method body inside `makePorts()`)

**Interfaces:**
- Produces: `ensureParticipantByChannelId(sql: Queryable, channelId: string, lineUid: string): Promise<string>`
- Consumes (by `queries.ts`): the same function, called after resolving `channel.id` from
  `line_channel_id`.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/db/participants.test.ts
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDb } from './client'
import { ensureParticipantByChannelId } from './participants'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'
let sql: Awaited<ReturnType<typeof testDb>>
let channelId: string

beforeAll(async () => {
  sql = testDb(url)
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`participants-${randomBytes(4).toString('hex')}@example.com`}, 'configurator')
    RETURNING id`
  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (name, channel_type, created_by) VALUES ('Seed', 'preview', ${user.id}) RETURNING id`
  channelId = channel.id
})

afterAll(async () => { await sql.end() })

describe('ensureParticipantByChannelId', () => {
  it('creates a participant on first contact', async () => {
    const id = await ensureParticipantByChannelId(sql, channelId, 'U-first')
    const [row] = await sql`SELECT channel_id, line_uid FROM participant WHERE id = ${id}`
    expect(row.channel_id).toBe(channelId)
    expect(row.line_uid).toBe('U-first')
  })

  it('returns the same participant id on repeat contact from the same line_uid', async () => {
    const first = await ensureParticipantByChannelId(sql, channelId, 'U-repeat')
    const second = await ensureParticipantByChannelId(sql, channelId, 'U-repeat')
    expect(second).toBe(first)
  })

  it('bumps last_seen_at on repeat contact', async () => {
    const id = await ensureParticipantByChannelId(sql, channelId, 'U-seen')
    const [before] = await sql`SELECT last_seen_at FROM participant WHERE id = ${id}`
    await new Promise((r) => setTimeout(r, 10))
    await ensureParticipantByChannelId(sql, channelId, 'U-seen')
    const [after] = await sql`SELECT last_seen_at FROM participant WHERE id = ${id}`
    expect(new Date(after.last_seen_at).getTime()).toBeGreaterThan(new Date(before.last_seen_at).getTime())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/db/participants.test.ts`
Expected: FAIL — `Cannot find module './participants'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/db/participants.ts
import type { Queryable } from './client'

/**
 * แถวเดียวใน `participant` ต่อ (channel, line_uid) — ใช้ทั้งจาก webhook (คีย์ด้วย
 * line_channel_id ที่ LINE ส่งมา, แปลงเป็น channel.id ก่อนเรียกที่นี่ ดู queries.ts)
 * และจาก LIFF auth (มี channel.id อยู่ในมือแล้วตรงๆ จาก liff_app.channel_id) — คนละ
 * ทางเข้า แต่ INSERT ... ON CONFLICT เดียวกัน จึงเป็น participant แถวเดียวกันเสมอ
 * ไม่ว่าจะคุยกับบอทผ่านแชทหรือผ่าน LIFF (spec §3.1)
 */
export async function ensureParticipantByChannelId(
  sql: Queryable, channelId: string, lineUid: string,
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO participant (channel_id, line_uid)
    VALUES (${channelId}, ${lineUid})
    ON CONFLICT (channel_id, line_uid)
      DO UPDATE SET last_seen_at = now()
    RETURNING id`
  return row.id
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/db/participants.test.ts`
Expected: PASS (3 tests) — requires Postgres reachable at `TEST_DATABASE_URL`; if unreachable, note that and
move on, come back once a DB is available before Step 6.

- [ ] **Step 5: Delegate to the new helper from the webhook path**

In `lib/db/queries.ts`, find (around line 227):

```typescript
    async ensureParticipant(lineChannelId, lineUid) {
      const target = lineChannelIdOverride ?? lineChannelId
      const [row] = await sql<{ id: string }[]>`
        WITH ch AS (SELECT id FROM channel WHERE line_channel_id = ${target})
        INSERT INTO participant (channel_id, line_uid)
        SELECT ch.id, ${lineUid} FROM ch
        ON CONFLICT (channel_id, line_uid)
          DO UPDATE SET last_seen_at = now()
        RETURNING id`
      return row.id
    },
```

Replace with:

```typescript
    async ensureParticipant(lineChannelId, lineUid) {
      const target = lineChannelIdOverride ?? lineChannelId
      const [ch] = await sql<{ id: string }[]>`SELECT id FROM channel WHERE line_channel_id = ${target}`
      return ensureParticipantByChannelId(sql, ch.id, lineUid)
    },
```

Add the import near the top of `lib/db/queries.ts` (alongside the other local imports):

```typescript
import { ensureParticipantByChannelId } from './participants'
```

- [ ] **Step 6: Confirm nothing else broke**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run test:integration`
Expected: all existing suites still pass, in particular `tests/e2e.integration.test.ts` (it exercises the
webhook's `ensureParticipant` path end to end — this is the regression check that the refactor didn't change
behavior).

- [ ] **Step 7: Commit**

```bash
git add lib/db/participants.ts lib/db/participants.test.ts lib/db/queries.ts
git commit -m "refactor: extract ensureParticipantByChannelId so LIFF auth can share it with the webhook"
```

---

### Task 3: `lib/db/liffApps.ts` — registry read/write + API key verification

**Files:**
- Create: `lib/db/liffApps.ts`
- Test: `lib/db/liffApps.test.ts`

**Interfaces:**
- Consumes: `encryptSecret`, `decryptSecret`, `last4`, `CURRENT_KEY_VERSION` from `lib/crypto/secretbox.ts`
- Produces:
  - `type LiffApp = { id: string; name: string; liffId: string; lineLoginChannelId: string; channelId: string; apiKeyLast4: string; createdAt: Date }`
  - `loadLiffAppByLiffId(sql: Queryable, liffId: string): Promise<LiffApp | null>`
  - `listLiffApps(sql: Queryable): Promise<LiffApp[]>`
  - `createLiffApp(sql: Queryable, input: { name: string; liffId: string; lineLoginChannelId: string; channelId: string; apiKey: string; createdBy: string }): Promise<LiffApp>`
  - `verifyLiffApiKey(sql: Queryable, liffAppId: string, presentedKey: string): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/db/liffApps.test.ts
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDb } from './client'
import { createLiffApp, listLiffApps, loadLiffAppByLiffId, verifyLiffApiKey } from './liffApps'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'
let sql: Awaited<ReturnType<typeof testDb>>
let userId: string
let channelId: string

beforeAll(async () => {
  process.env.SECRET_KEY_V1 = randomBytes(32).toString('base64')
  sql = testDb(url)
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`liffapps-${randomBytes(4).toString('hex')}@example.com`}, 'configurator')
    RETURNING id`
  userId = user.id
  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (name, channel_type, created_by) VALUES ('Seed', 'preview', ${user.id}) RETURNING id`
  channelId = channel.id
})

afterAll(async () => { await sql.end() })

describe('createLiffApp / loadLiffAppByLiffId', () => {
  it('round-trips a created app, never exposing the api key in the returned shape', async () => {
    const created = await createLiffApp(sql, {
      name: 'ทดสอบ', liffId: `2011-${randomBytes(4).toString('hex')}`,
      lineLoginChannelId: '2011037337', channelId, apiKey: 'sk_test_abc123', createdBy: userId,
    })
    expect(created.apiKeyLast4).toBe('3123')
    expect(Object.keys(created).some((k) => /apiKey$|secret|cipher/i.test(k))).toBe(false)

    const loaded = await loadLiffAppByLiffId(sql, created.liffId)
    expect(loaded).toMatchObject({ id: created.id, name: 'ทดสอบ', channelId })
  })

  it('unknown liffId returns null, not a throw', async () => {
    expect(await loadLiffAppByLiffId(sql, 'no-such-liff-id')).toBeNull()
  })
})

describe('listLiffApps', () => {
  it('includes every created app', async () => {
    const created = await createLiffApp(sql, {
      name: 'รายการ', liffId: `2011-${randomBytes(4).toString('hex')}`,
      lineLoginChannelId: '2011037337', channelId, apiKey: 'sk_test_xyz', createdBy: userId,
    })
    const all = await listLiffApps(sql)
    expect(all.map((a) => a.id)).toContain(created.id)
  })
})

describe('verifyLiffApiKey', () => {
  it('accepts the exact key that was set at creation', async () => {
    const created = await createLiffApp(sql, {
      name: 'กุญแจ', liffId: `2011-${randomBytes(4).toString('hex')}`,
      lineLoginChannelId: '2011037337', channelId, apiKey: 'sk_correct', createdBy: userId,
    })
    expect(await verifyLiffApiKey(sql, created.id, 'sk_correct')).toBe(true)
  })

  it('rejects a wrong key', async () => {
    const created = await createLiffApp(sql, {
      name: 'กุญแจผิด', liffId: `2011-${randomBytes(4).toString('hex')}`,
      lineLoginChannelId: '2011037337', channelId, apiKey: 'sk_correct', createdBy: userId,
    })
    expect(await verifyLiffApiKey(sql, created.id, 'sk_wrong')).toBe(false)
  })

  it('rejects for an unknown liffAppId rather than throwing', async () => {
    expect(await verifyLiffApiKey(sql, '00000000-0000-0000-0000-000000000000', 'anything')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/db/liffApps.test.ts`
Expected: FAIL — `Cannot find module './liffApps'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/db/liffApps.ts
import { timingSafeEqual } from 'node:crypto'
import type { Queryable } from './client'
import { CURRENT_KEY_VERSION, decryptSecret, encryptSecret, last4 } from '../crypto/secretbox'

export type LiffApp = {
  id: string
  name: string
  liffId: string
  lineLoginChannelId: string
  channelId: string
  apiKeyLast4: string
  createdAt: Date
}

type LiffAppRow = {
  id: string
  name: string
  liff_id: string
  line_login_channel_id: string
  channel_id: string
  api_key_last4: string
  created_at: Date
}

function toLiffApp(row: LiffAppRow): LiffApp {
  return {
    id: row.id, name: row.name, liffId: row.liff_id,
    lineLoginChannelId: row.line_login_channel_id, channelId: row.channel_id,
    apiKeyLast4: row.api_key_last4, createdAt: row.created_at,
  }
}

const SELECT_COLUMNS = 'id, name, liff_id, line_login_channel_id, channel_id, api_key_last4, created_at'

export async function loadLiffAppByLiffId(sql: Queryable, liffId: string): Promise<LiffApp | null> {
  const [row] = await sql<LiffAppRow[]>`
    SELECT ${sql.unsafe(SELECT_COLUMNS)} FROM liff_app WHERE liff_id = ${liffId}`
  return row ? toLiffApp(row) : null
}

export async function listLiffApps(sql: Queryable): Promise<LiffApp[]> {
  const rows = await sql<LiffAppRow[]>`
    SELECT ${sql.unsafe(SELECT_COLUMNS)} FROM liff_app ORDER BY created_at DESC`
  return rows.map(toLiffApp)
}

/**
 * บันทึกกุญแจแบบเดียวกับที่ channel ทำ (DD-03) — เข้ารหัสก่อนเก็บเสมอ ไม่มีทาง
 * อ่านค่าเต็มกลับได้อีกหลัง insert แม้แต่จากในไฟล์นี้เอง
 */
export async function createLiffApp(
  sql: Queryable,
  input: {
    name: string; liffId: string; lineLoginChannelId: string; channelId: string
    apiKey: string; createdBy: string
  },
): Promise<LiffApp> {
  const encrypted = encryptSecret(input.apiKey)
  const [row] = await sql<LiffAppRow[]>`
    INSERT INTO liff_app
           (name, liff_id, line_login_channel_id, channel_id, encrypted_api_key, api_key_last4, key_version, created_by)
    VALUES (${input.name}, ${input.liffId}, ${input.lineLoginChannelId}, ${input.channelId},
            ${encrypted.cipher}, ${last4(input.apiKey)}, ${encrypted.keyVersion}, ${input.createdBy})
    RETURNING ${sql.unsafe(SELECT_COLUMNS)}`
  return toLiffApp(row)
}

/**
 * เทียบแบบ constant-time เหมือน verifySignature() ของ lib/line/verify.ts — เหตุผล
 * เดียวกัน: เทียบสตริงลับด้วย === ธรรมดารั่วเวลาที่ใช้เทียบออกมาเป็นสัญญาณให้เดา
 * ทีละตัวอักษรได้ ไม่ต่างจากเปรียบเทียบลายเซ็น
 */
export async function verifyLiffApiKey(
  sql: Queryable, liffAppId: string, presentedKey: string,
): Promise<boolean> {
  const [row] = await sql<{ encrypted_api_key: string; key_version: number }[]>`
    SELECT encrypted_api_key, key_version FROM liff_app WHERE id = ${liffAppId}`
  if (!row) return false

  const actual = decryptSecret(row.encrypted_api_key, row.key_version)
  const expected = Buffer.from(actual)
  const received = Buffer.from(presentedKey)
  if (expected.length !== received.length) return false
  return timingSafeEqual(expected, received)
}

export const _unused = CURRENT_KEY_VERSION // re-exported for callers that need the constant; remove if unused elsewhere
```

Before finalizing Step 3, check `lib/db/channels.ts` for the exact shape `encryptSecret()` returns (`{ cipher, keyVersion }` — confirmed already in this codebase) and drop the `_unused` line above if nothing in this file actually needs `CURRENT_KEY_VERSION` directly (it doesn't — remove that import and the trailing export; it was only needed if you later add key rotation, which is out of scope here).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/db/liffApps.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors — in particular, remove the `_unused`/`CURRENT_KEY_VERSION` import if Step 3's note
applies, or typecheck will flag it as unused depending on lint config.

- [ ] **Step 6: Commit**

```bash
git add lib/db/liffApps.ts lib/db/liffApps.test.ts
git commit -m "feat: add liff_app registry reads/writes and API key verification"
```

---

### Task 4: `lib/line/liffVerify.ts` — verify a LIFF `id_token` against LINE

**Files:**
- Create: `lib/line/liffVerify.ts`
- Test: `lib/line/liffVerify.test.ts`

**Interfaces:**
- Produces: `verifyLiffIdToken(idToken: string, lineLoginChannelId: string): Promise<{ ok: true; lineUserId: string } | { ok: false; reason: string }>`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/line/liffVerify.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyLiffIdToken } from './liffVerify'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => { vi.unstubAllGlobals() })

describe('verifyLiffIdToken', () => {
  it('posts to LINE\'s verify endpoint with the token and the LINE Login channel id as client_id', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ sub: 'U1234567890abcdef1234567890abcdef', aud: '2011037337' }),
    })

    await verifyLiffIdToken('id-token-abc', '2011037337')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.line.me/oauth2/v2.1/verify')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    const body = new URLSearchParams(init.body)
    expect(body.get('id_token')).toBe('id-token-abc')
    expect(body.get('client_id')).toBe('2011037337')
  })

  it('returns ok:true with the LINE userId when LINE accepts the token', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ sub: 'U1234567890abcdef1234567890abcdef', aud: '2011037337' }),
    })
    const result = await verifyLiffIdToken('id-token-abc', '2011037337')
    expect(result).toEqual({ ok: true, lineUserId: 'U1234567890abcdef1234567890abcdef' })
  })

  it('returns ok:false when LINE rejects the token (expired/invalid)', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: 'invalid_request', error_description: 'IdToken expired' }),
    })
    const result = await verifyLiffIdToken('stale-token', '2011037337')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toContain('expired')
  })

  it('rejects when the token\'s audience does not match the given LINE Login channel id', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ sub: 'U1234567890abcdef1234567890abcdef', aud: '9999999999' }),
    })
    const result = await verifyLiffIdToken('id-token-abc', '2011037337')
    expect(result).toEqual({ ok: false, reason: 'audience ของ id_token ไม่ตรงกับ LINE Login channel ที่ลงทะเบียนไว้' })
  })

  it('passes an abort signal so a stalled LINE API call cannot hang forever', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ sub: 'U1', aud: '2011037337' }) })
    await verifyLiffIdToken('id-token-abc', '2011037337')
    const [, init] = fetchMock.mock.calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/line/liffVerify.test.ts`
Expected: FAIL — `Cannot find module './liffVerify'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/line/liffVerify.ts
const VERIFY_ENDPOINT = 'https://api.line.me/oauth2/v2.1/verify'

export type LiffVerifyResult =
  | { ok: true; lineUserId: string }
  | { ok: false; reason: string }

/**
 * ยืนยัน id_token ของ LIFF กับ LINE จริงเสมอ ห้ามเชื่อ userId ที่เบราว์เซอร์อ้างมาตรงๆ
 * — LINE เป็นคนเซ็นรับรอง sub (LINE userId) ให้ ไม่ใช่เราถอด JWT เองแล้วเชื่อลอยๆ
 *
 * client_id ที่ส่งไปต้องเป็น Channel ID ของ LINE Login channel ที่ LIFF นั้นขึ้นทะเบียน
 * ไว้ (liff_app.line_login_channel_id) — คนละค่ากับ Messaging API channel เสมอ ส่งผิด
 * ตัวแล้ว LINE จะปฏิเสธ token ทุกใบ
 */
export async function verifyLiffIdToken(
  idToken: string, lineLoginChannelId: string,
): Promise<LiffVerifyResult> {
  const response = await fetch(VERIFY_ENDPOINT, {
    method: 'POST',
    signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: lineLoginChannelId }).toString(),
  })

  const body = await response.json() as { sub?: string; aud?: string; error_description?: string }

  if (!response.ok) {
    return { ok: false, reason: body.error_description ?? `LINE ปฏิเสธ id_token (${response.status})` }
  }
  if (!body.sub) {
    return { ok: false, reason: 'LINE ตอบกลับมาโดยไม่มี sub — token นี้อ่านตัวตนไม่ได้' }
  }
  if (body.aud !== lineLoginChannelId) {
    return { ok: false, reason: 'audience ของ id_token ไม่ตรงกับ LINE Login channel ที่ลงทะเบียนไว้' }
  }

  return { ok: true, lineUserId: body.sub }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/line/liffVerify.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/line/liffVerify.ts lib/line/liffVerify.test.ts
git commit -m "feat: verify LIFF id_token against LINE's oauth2 verify endpoint"
```

---

### Task 5: `lib/db/liffSessions.ts` — session read/upsert

**Files:**
- Create: `lib/db/liffSessions.ts`
- Test: `lib/db/liffSessions.test.ts`

**Interfaces:**
- Produces:
  - `type LiffSession = { id: string; liffAppId: string; participantId: string; externalKey: string | null; data: unknown; createdAt: Date; updatedAt: Date }`
  - `listLiffSessionsForParticipant(sql: Queryable, liffAppId: string, participantId: string): Promise<LiffSession[]>`
  - `findLiffSessionByKey(sql: Queryable, liffAppId: string, externalKey: string): Promise<LiffSession | null>`
  - `upsertLiffSession(sql: Queryable, input: { liffAppId: string; participantId: string; externalKey: string | null; data: unknown }): Promise<LiffSession>`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/db/liffSessions.test.ts
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDb } from './client'
import { createLiffApp } from './liffApps'
import {
  findLiffSessionByKey, listLiffSessionsForParticipant, upsertLiffSession,
} from './liffSessions'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'
let sql: Awaited<ReturnType<typeof testDb>>
let liffAppId: string
let participantA: string
let participantB: string

beforeAll(async () => {
  process.env.SECRET_KEY_V1 = randomBytes(32).toString('base64')
  sql = testDb(url)
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`sessions-${randomBytes(4).toString('hex')}@example.com`}, 'configurator')
    RETURNING id`
  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (name, channel_type, created_by) VALUES ('Seed', 'preview', ${user.id}) RETURNING id`
  const [pA] = await sql<{ id: string }[]>`
    INSERT INTO participant (channel_id, line_uid) VALUES (${channel.id}, 'U-a') RETURNING id`
  const [pB] = await sql<{ id: string }[]>`
    INSERT INTO participant (channel_id, line_uid) VALUES (${channel.id}, 'U-b') RETURNING id`
  participantA = pA.id
  participantB = pB.id
  const app = await createLiffApp(sql, {
    name: 'Sessions test', liffId: `2011-${randomBytes(4).toString('hex')}`,
    lineLoginChannelId: '2011037337', channelId: channel.id, apiKey: 'sk_x', createdBy: user.id,
  })
  liffAppId = app.id
})

afterAll(async () => { await sql.end() })

describe('upsertLiffSession / listLiffSessionsForParticipant', () => {
  it('creates a new row scoped to the given participant when no externalKey exists yet', async () => {
    const created = await upsertLiffSession(sql, {
      liffAppId, participantId: participantA, externalKey: null, data: { score: 1 },
    })
    expect(created.participantId).toBe(participantA)
    expect(created.data).toEqual({ score: 1 })

    const rows = await listLiffSessionsForParticipant(sql, liffAppId, participantA)
    expect(rows.map((r) => r.id)).toContain(created.id)
  })

  it('updates the same row in place when externalKey matches an existing one for this liff_app', async () => {
    const first = await upsertLiffSession(sql, {
      liffAppId, participantId: participantA, externalKey: 'profile', data: { score: 1 },
    })
    const second = await upsertLiffSession(sql, {
      liffAppId, participantId: participantA, externalKey: 'profile', data: { score: 2 },
    })
    expect(second.id).toBe(first.id)
    expect(second.data).toEqual({ score: 2 })
    expect(second.updatedAt.getTime()).toBeGreaterThanOrEqual(first.updatedAt.getTime())
  })

  it('the same externalKey under a different liff_app is a different row (scoped per app)', async () => {
    const otherApp = await createLiffApp(sql, {
      name: 'Other app', liffId: `2011-${randomBytes(4).toString('hex')}`,
      lineLoginChannelId: '2011037337', channelId: (await sql<{ channel_id: string }[]>`SELECT channel_id FROM liff_app WHERE id = ${liffAppId}`)[0].channel_id,
      apiKey: 'sk_y', createdBy: (await sql<{ created_by: string }[]>`SELECT created_by FROM liff_app WHERE id = ${liffAppId}`)[0].created_by,
    })
    const mine = await upsertLiffSession(sql, {
      liffAppId, participantId: participantA, externalKey: 'shared-key', data: { who: 'first app' },
    })
    const theirs = await upsertLiffSession(sql, {
      liffAppId: otherApp.id, participantId: participantA, externalKey: 'shared-key', data: { who: 'other app' },
    })
    expect(theirs.id).not.toBe(mine.id)
  })
})

describe('findLiffSessionByKey', () => {
  it('finds a row by externalKey regardless of which participant created it', async () => {
    const created = await upsertLiffSession(sql, {
      liffAppId, participantId: participantA, externalKey: 'invite-xyz', data: { from: 'A' },
    })
    const found = await findLiffSessionByKey(sql, liffAppId, 'invite-xyz')
    expect(found?.id).toBe(created.id)
    expect(found?.participantId).toBe(participantA) // B can read it, but it still records A as the owner
  })

  it('returns null for an unknown key rather than throwing', async () => {
    expect(await findLiffSessionByKey(sql, liffAppId, 'never-existed')).toBeNull()
  })
})
```

Note: the third test above (`participantB` seeded in `beforeAll`) intentionally isn't the one reading the row
in this version — `findLiffSessionByKey` has no participant filter at all by design (spec §4/§6), so the
"any authenticated caller can read by key" guarantee is enforced at the route layer (Task 8's `GET
session?key=`), not here. Keep `participantB` in the seed for Task 8's route test to reuse this same setup
pattern; it's fine if this file's tests don't all use it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/db/liffSessions.test.ts`
Expected: FAIL — `Cannot find module './liffSessions'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/db/liffSessions.ts
import type { Queryable } from './client'

export type LiffSession = {
  id: string
  liffAppId: string
  participantId: string
  externalKey: string | null
  data: unknown
  createdAt: Date
  updatedAt: Date
}

type LiffSessionRow = {
  id: string
  liff_app_id: string
  participant_id: string
  external_key: string | null
  data: unknown
  created_at: Date
  updated_at: Date
}

function toLiffSession(row: LiffSessionRow): LiffSession {
  return {
    id: row.id, liffAppId: row.liff_app_id, participantId: row.participant_id,
    externalKey: row.external_key, data: row.data,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

export async function listLiffSessionsForParticipant(
  sql: Queryable, liffAppId: string, participantId: string,
): Promise<LiffSession[]> {
  const rows = await sql<LiffSessionRow[]>`
    SELECT * FROM liff_session
     WHERE liff_app_id = ${liffAppId} AND participant_id = ${participantId}
     ORDER BY created_at DESC`
  return rows.map(toLiffSession)
}

/** ไม่กรองด้วย participant_id โดยตั้งใจ — คนละคนที่รู้ external_key เดียวกันอ่านได้ (spec §4/§6) */
export async function findLiffSessionByKey(
  sql: Queryable, liffAppId: string, externalKey: string,
): Promise<LiffSession | null> {
  const [row] = await sql<LiffSessionRow[]>`
    SELECT * FROM liff_session WHERE liff_app_id = ${liffAppId} AND external_key = ${externalKey}`
  return row ? toLiffSession(row) : null
}

/**
 * มี externalKey ที่ตรงกับแถวเดิมของ liff_app นี้ → อัปเดตทับ · ไม่มีหรือไม่ตรง →
 * สร้างแถวใหม่ผูกกับ participant ที่เรียก (spec §6, PUT /session)
 */
export async function upsertLiffSession(
  sql: Queryable,
  input: { liffAppId: string; participantId: string; externalKey: string | null; data: unknown },
): Promise<LiffSession> {
  if (input.externalKey) {
    const existing = await findLiffSessionByKey(sql, input.liffAppId, input.externalKey)
    if (existing) {
      const [row] = await sql<LiffSessionRow[]>`
        UPDATE liff_session
           SET data = ${sql.json(input.data as object)}, updated_at = now()
         WHERE id = ${existing.id}
         RETURNING *`
      return toLiffSession(row)
    }
  }

  const [row] = await sql<LiffSessionRow[]>`
    INSERT INTO liff_session (liff_app_id, participant_id, external_key, data)
    VALUES (${input.liffAppId}, ${input.participantId}, ${input.externalKey}, ${sql.json(input.data as object)})
    RETURNING *`
  return toLiffSession(row)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/db/liffSessions.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/db/liffSessions.ts lib/db/liffSessions.test.ts
git commit -m "feat: add liff_session read/upsert — generic per-app JSON storage"
```

---

### Task 6: `lib/liff/auth.ts` — the shared auth resolver (both paths, one return shape)

**Files:**
- Create: `lib/liff/auth.ts`
- Test: `lib/liff/auth.test.ts`

**Interfaces:**
- Consumes: `loadLiffAppByLiffId`, `verifyLiffApiKey` (Task 3), `verifyLiffIdToken` (Task 4),
  `ensureParticipantByChannelId` (Task 2)
- Produces:
  - `type LiffAuthResult = { ok: true; participantId: string; liffApp: LiffApp } | { ok: false; status: 401 | 404; reason: string }`
  - `resolveLiffParticipant(sql: Queryable, liffId: string, request: Request, body?: { lineUserId?: string }): Promise<LiffAuthResult>`

`body.lineUserId` is only read on the API-key path (there's no browser context to derive identity from
otherwise — spec §5.2); it's ignored entirely on the id_token path, where the verified `sub` is the only
source of truth.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/liff/auth.test.ts
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveLiffParticipant } from './auth'

vi.mock('../db/liffApps', () => ({
  loadLiffAppByLiffId: vi.fn(),
  verifyLiffApiKey: vi.fn(),
}))
vi.mock('../line/liffVerify', () => ({ verifyLiffIdToken: vi.fn() }))
vi.mock('../db/participants', () => ({ ensureParticipantByChannelId: vi.fn() }))

const { loadLiffAppByLiffId, verifyLiffApiKey } = await import('../db/liffApps')
const { verifyLiffIdToken } = await import('../line/liffVerify')
const { ensureParticipantByChannelId } = await import('../db/participants')

const liffApp = {
  id: 'app-1', name: 'Test', liffId: 'liff-1', lineLoginChannelId: '2011037337',
  channelId: 'channel-1', apiKeyLast4: 'abcd', createdAt: new Date(),
}

const sql = {} as never

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { vi.restoreAllMocks() })

describe('resolveLiffParticipant · id_token path', () => {
  it('verifies the token, ensures the participant, and returns it', async () => {
    vi.mocked(loadLiffAppByLiffId).mockResolvedValue(liffApp)
    vi.mocked(verifyLiffIdToken).mockResolvedValue({ ok: true, lineUserId: 'U-player' })
    vi.mocked(ensureParticipantByChannelId).mockResolvedValue('participant-1')

    const request = new Request('https://example.com', { headers: { Authorization: 'Bearer id-token-xyz' } })
    const result = await resolveLiffParticipant(sql, 'liff-1', request)

    expect(result).toEqual({ ok: true, participantId: 'participant-1', liffApp })
    expect(verifyLiffIdToken).toHaveBeenCalledWith('id-token-xyz', '2011037337')
    expect(ensureParticipantByChannelId).toHaveBeenCalledWith(sql, 'channel-1', 'U-player')
  })

  it('401s when LINE rejects the id_token', async () => {
    vi.mocked(loadLiffAppByLiffId).mockResolvedValue(liffApp)
    vi.mocked(verifyLiffIdToken).mockResolvedValue({ ok: false, reason: 'หมดอายุ' })

    const request = new Request('https://example.com', { headers: { Authorization: 'Bearer stale' } })
    const result = await resolveLiffParticipant(sql, 'liff-1', request)

    expect(result).toEqual({ ok: false, status: 401, reason: 'หมดอายุ' })
    expect(ensureParticipantByChannelId).not.toHaveBeenCalled()
  })
})

describe('resolveLiffParticipant · API key path', () => {
  it('verifies the key against this liff_app and uses the lineUserId from the body', async () => {
    vi.mocked(loadLiffAppByLiffId).mockResolvedValue(liffApp)
    vi.mocked(verifyLiffApiKey).mockResolvedValue(true)
    vi.mocked(ensureParticipantByChannelId).mockResolvedValue('participant-2')

    const request = new Request('https://example.com', { headers: { Authorization: 'Bearer api-key-xyz' } })
    const result = await resolveLiffParticipant(sql, 'liff-1', request, { lineUserId: 'U-from-server' })

    expect(result).toEqual({ ok: true, participantId: 'participant-2', liffApp })
    expect(verifyLiffApiKey).toHaveBeenCalledWith(sql, 'app-1', 'api-key-xyz')
    expect(ensureParticipantByChannelId).toHaveBeenCalledWith(sql, 'channel-1', 'U-from-server')
  })

  it('401s when the api key does not match', async () => {
    vi.mocked(loadLiffAppByLiffId).mockResolvedValue(liffApp)
    vi.mocked(verifyLiffApiKey).mockResolvedValue(false)

    const request = new Request('https://example.com', { headers: { Authorization: 'Bearer wrong-key' } })
    const result = await resolveLiffParticipant(sql, 'liff-1', request, { lineUserId: 'U-from-server' })

    expect(result).toEqual({ ok: false, status: 401, reason: 'API key ไม่ถูกต้อง' })
  })

  it('401s when the api key path is used but no lineUserId was given in the body', async () => {
    vi.mocked(loadLiffAppByLiffId).mockResolvedValue(liffApp)
    vi.mocked(verifyLiffApiKey).mockResolvedValue(true)

    const request = new Request('https://example.com', { headers: { Authorization: 'Bearer api-key-xyz' } })
    const result = await resolveLiffParticipant(sql, 'liff-1', request)

    expect(result).toEqual({
      ok: false, status: 401,
      reason: 'เรียกด้วย API key ต้องระบุ lineUserId มาใน body ด้วย — ไม่มีบริบทเบราว์เซอร์ให้เดาตัวตนได้',
    })
  })

  it('picks the API key path over id_token when the key matches — a token verify is never attempted', async () => {
    vi.mocked(loadLiffAppByLiffId).mockResolvedValue(liffApp)
    vi.mocked(verifyLiffApiKey).mockResolvedValue(true)
    vi.mocked(ensureParticipantByChannelId).mockResolvedValue('participant-3')

    const request = new Request('https://example.com', { headers: { Authorization: 'Bearer some-bearer-value' } })
    await resolveLiffParticipant(sql, 'liff-1', request, { lineUserId: 'U-x' })

    expect(verifyLiffIdToken).not.toHaveBeenCalled()
  })
})

describe('resolveLiffParticipant · shared failure modes', () => {
  it('404s when liffId has no registered liff_app', async () => {
    vi.mocked(loadLiffAppByLiffId).mockResolvedValue(null)
    const request = new Request('https://example.com', { headers: { Authorization: 'Bearer x' } })
    const result = await resolveLiffParticipant(sql, 'unknown-liff', request)
    expect(result).toEqual({ ok: false, status: 404, reason: 'ไม่พบ LIFF นี้ในระบบ' })
  })

  it('401s when there is no Authorization header at all', async () => {
    vi.mocked(loadLiffAppByLiffId).mockResolvedValue(liffApp)
    const request = new Request('https://example.com')
    const result = await resolveLiffParticipant(sql, 'liff-1', request)
    expect(result).toEqual({ ok: false, status: 401, reason: 'ไม่มี Authorization header' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/liff/auth.test.ts`
Expected: FAIL — `Cannot find module './auth'`

- [ ] **Step 3: Write the implementation**

The API-key path is distinguished from the id_token path by trying the API key check first (both are opaque
bearer strings from the header's point of view — there is no format difference to branch on), falling back to
id_token verification only if the key doesn't match. This is why the test above asserts "matches the API key
→ `verifyLiffIdToken` is never called."

```typescript
// lib/liff/auth.ts
import type { Queryable } from '../db/client'
import { loadLiffAppByLiffId, verifyLiffApiKey, type LiffApp } from '../db/liffApps'
import { ensureParticipantByChannelId } from '../db/participants'
import { verifyLiffIdToken } from '../line/liffVerify'

export type LiffAuthResult =
  | { ok: true; participantId: string; liffApp: LiffApp }
  | { ok: false; status: 401 | 404; reason: string }

function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization')
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length)
}

/**
 * จุดเดียวที่ทั้งสองทางตรวจตัวตน (id_token จากเบราว์เซอร์ / API key จาก server-to-
 * server) มาบรรจบกัน — คืนรูปร่างเดียวกันเสมอ ให้ route ที่เรียกใช้ไม่ต้องรู้เลยว่า
 * ทางไหนผ่านมา (spec §5)
 *
 * ลองทาง API key ก่อนเสมอ เพราะ bearer token ทั้งสองแบบหน้าตาเหมือนกันจากมุมมองของ
 * header — ตรงกับกุญแจที่ลงทะเบียนไว้ก็จบที่ทางนี้เลย ไม่เรียก LINE verify endpoint
 * โดยไม่จำเป็น (ประหยัด round-trip และไม่เผลอ log เป็น "id_token ไม่ถูกต้อง" ผิดเรื่อง)
 */
export async function resolveLiffParticipant(
  sql: Queryable, liffId: string, request: Request, body?: { lineUserId?: string },
): Promise<LiffAuthResult> {
  const liffApp = await loadLiffAppByLiffId(sql, liffId)
  if (!liffApp) return { ok: false, status: 404, reason: 'ไม่พบ LIFF นี้ในระบบ' }

  const token = bearerToken(request)
  if (!token) return { ok: false, status: 401, reason: 'ไม่มี Authorization header' }

  const keyMatches = await verifyLiffApiKey(sql, liffApp.id, token)
  if (keyMatches) {
    if (!body?.lineUserId) {
      return {
        ok: false, status: 401,
        reason: 'เรียกด้วย API key ต้องระบุ lineUserId มาใน body ด้วย — ไม่มีบริบทเบราว์เซอร์ให้เดาตัวตนได้',
      }
    }
    const participantId = await ensureParticipantByChannelId(sql, liffApp.channelId, body.lineUserId)
    return { ok: true, participantId, liffApp }
  }

  const verified = await verifyLiffIdToken(token, liffApp.lineLoginChannelId)
  if (!verified.ok) return { ok: false, status: 401, reason: verified.reason }

  const participantId = await ensureParticipantByChannelId(sql, liffApp.channelId, verified.lineUserId)
  return { ok: true, participantId, liffApp }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/liff/auth.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/liff/auth.ts lib/liff/auth.test.ts
git commit -m "feat: add resolveLiffParticipant — shared id_token/API key auth for LIFF routes"
```

---

### Task 7: `lib/liff/cors.ts` — shared CORS headers

**Files:**
- Create: `lib/liff/cors.ts`
- Test: `lib/liff/cors.test.ts`

**Interfaces:**
- Produces: `LIFF_CORS_HEADERS: Record<string, string>`, `liffOptionsResponse(): Response`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/liff/cors.test.ts
import { describe, expect, it } from 'vitest'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from './cors'

describe('LIFF CORS', () => {
  it('allows any origin — auth is the real gate, not origin (spec §8)', () => {
    expect(LIFF_CORS_HEADERS['Access-Control-Allow-Origin']).toBe('*')
  })

  it('allows the Authorization and Content-Type headers a LIFF call needs', () => {
    expect(LIFF_CORS_HEADERS['Access-Control-Allow-Headers']).toContain('Authorization')
    expect(LIFF_CORS_HEADERS['Access-Control-Allow-Headers']).toContain('Content-Type')
  })

  it('liffOptionsResponse answers preflight with 204 and the same headers', async () => {
    const response = liffOptionsResponse()
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/liff/cors.test.ts`
Expected: FAIL — `Cannot find module './cors'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/liff/cors.ts

/**
 * LIFF อยู่คนละโดเมนเสมอ (เช่น dew-liff.vercel.app เรียก line-kit-bice.vercel.app)
 * เปิดกว้างไว้ก่อน — ตัวป้องกันจริงคือการตรวจตัวตนใน lib/liff/auth.ts ไม่ใช่ origin
 * (spec §8) คุมเข้มเป็นต่อ-liff_app ทีหลังได้ถ้าจำเป็นจริง
 */
export const LIFF_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

export function liffOptionsResponse(): Response {
  return new Response(null, { status: 204, headers: LIFF_CORS_HEADERS })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/liff/cors.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/liff/cors.ts lib/liff/cors.test.ts
git commit -m "feat: add shared CORS headers for LIFF-facing routes"
```

---

### Task 8: `app/api/liff/[liffId]/me/route.ts` and `.../session/route.ts`

**Files:**
- Create: `app/api/liff/[liffId]/me/route.ts`
- Create: `app/api/liff/[liffId]/session/route.ts`
- Test: `app/api/liff/[liffId]/me/route.test.ts`
- Test: `app/api/liff/[liffId]/session/route.test.ts`

**Interfaces:**
- Consumes: `resolveLiffParticipant` (Task 6), `LIFF_CORS_HEADERS`/`liffOptionsResponse` (Task 7),
  `listLiffSessionsForParticipant`/`findLiffSessionByKey`/`upsertLiffSession` (Task 5), `db()` from
  `lib/db/client`

- [ ] **Step 1: Write the failing tests**

```typescript
// app/api/liff/[liffId]/me/route.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ db: () => ({}) }))
vi.mock('@/lib/liff/auth', () => ({ resolveLiffParticipant: vi.fn() }))

const { resolveLiffParticipant } = await import('@/lib/liff/auth')
const { GET, OPTIONS } = await import('./route')

describe('GET /api/liff/[liffId]/me', () => {
  it('returns participantId and the LINE userId is not re-derivable from it (opaque id only)', async () => {
    vi.mocked(resolveLiffParticipant).mockResolvedValue({
      ok: true, participantId: 'participant-1',
      liffApp: {
        id: 'app-1', name: 'Test', liffId: 'liff-1', lineLoginChannelId: '2011037337',
        channelId: 'channel-1', apiKeyLast4: 'abcd', createdAt: new Date(),
      },
    })
    const request = new Request('https://example.com/api/liff/liff-1/me', {
      headers: { Authorization: 'Bearer x' },
    })
    const response = await GET(request, { params: Promise.resolve({ liffId: 'liff-1' }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ participantId: 'participant-1' })
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('passes through the auth failure status and reason', async () => {
    vi.mocked(resolveLiffParticipant).mockResolvedValue({ ok: false, status: 401, reason: 'หมดอายุ' })
    const request = new Request('https://example.com/api/liff/liff-1/me', {
      headers: { Authorization: 'Bearer x' },
    })
    const response = await GET(request, { params: Promise.resolve({ liffId: 'liff-1' }) })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'หมดอายุ' })
  })

  it('OPTIONS answers preflight', async () => {
    const response = await OPTIONS()
    expect(response.status).toBe(204)
  })
})
```

```typescript
// app/api/liff/[liffId]/session/route.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ db: () => ({}) }))
vi.mock('@/lib/liff/auth', () => ({ resolveLiffParticipant: vi.fn() }))
vi.mock('@/lib/db/liffSessions', () => ({
  listLiffSessionsForParticipant: vi.fn(),
  findLiffSessionByKey: vi.fn(),
  upsertLiffSession: vi.fn(),
}))

const { resolveLiffParticipant } = await import('@/lib/liff/auth')
const { listLiffSessionsForParticipant, findLiffSessionByKey, upsertLiffSession } =
  await import('@/lib/db/liffSessions')
const { GET, PUT } = await import('./route')

const liffApp = {
  id: 'app-1', name: 'Test', liffId: 'liff-1', lineLoginChannelId: '2011037337',
  channelId: 'channel-1', apiKeyLast4: 'abcd', createdAt: new Date(),
}
const okAuth = { ok: true as const, participantId: 'participant-1', liffApp }

describe('GET /api/liff/[liffId]/session', () => {
  it('without ?key — returns every row for the resolved participant', async () => {
    vi.mocked(resolveLiffParticipant).mockResolvedValue(okAuth)
    vi.mocked(listLiffSessionsForParticipant).mockResolvedValue([
      { id: 's1', liffAppId: 'app-1', participantId: 'participant-1', externalKey: null, data: { a: 1 }, createdAt: new Date(), updatedAt: new Date() },
    ])
    const request = new Request('https://example.com/api/liff/liff-1/session', {
      headers: { Authorization: 'Bearer x' },
    })
    const response = await GET(request, { params: Promise.resolve({ liffId: 'liff-1' }) })
    expect(response.status).toBe(200)
    const body = await response.json() as { sessions: unknown[] }
    expect(body.sessions).toHaveLength(1)
    expect(listLiffSessionsForParticipant).toHaveBeenCalledWith({}, 'app-1', 'participant-1')
  })

  it('with ?key — looks up by key, not by participant, and 404s when missing', async () => {
    vi.mocked(resolveLiffParticipant).mockResolvedValue(okAuth)
    vi.mocked(findLiffSessionByKey).mockResolvedValue(null)
    const request = new Request('https://example.com/api/liff/liff-1/session?key=invite-xyz', {
      headers: { Authorization: 'Bearer x' },
    })
    const response = await GET(request, { params: Promise.resolve({ liffId: 'liff-1' }) })
    expect(response.status).toBe(404)
    expect(findLiffSessionByKey).toHaveBeenCalledWith({}, 'app-1', 'invite-xyz')
  })

  it('propagates a 401 from auth without touching the database', async () => {
    vi.mocked(resolveLiffParticipant).mockResolvedValue({ ok: false, status: 401, reason: 'ไม่มี Authorization header' })
    const request = new Request('https://example.com/api/liff/liff-1/session')
    const response = await GET(request, { params: Promise.resolve({ liffId: 'liff-1' }) })
    expect(response.status).toBe(401)
    expect(listLiffSessionsForParticipant).not.toHaveBeenCalled()
  })
})

describe('PUT /api/liff/[liffId]/session', () => {
  it('upserts using the resolved participant, ignoring any participantId the body might try to set', async () => {
    vi.mocked(resolveLiffParticipant).mockResolvedValue(okAuth)
    vi.mocked(upsertLiffSession).mockResolvedValue({
      id: 's1', liffAppId: 'app-1', participantId: 'participant-1', externalKey: 'k1',
      data: { score: 5 }, createdAt: new Date(), updatedAt: new Date(),
    })
    const request = new Request('https://example.com/api/liff/liff-1/session', {
      method: 'PUT',
      headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalKey: 'k1', data: { score: 5 }, participantId: 'someone-elses-id' }),
    })
    const response = await PUT(request, { params: Promise.resolve({ liffId: 'liff-1' }) })
    expect(response.status).toBe(200)
    expect(upsertLiffSession).toHaveBeenCalledWith({}, {
      liffAppId: 'app-1', participantId: 'participant-1', externalKey: 'k1', data: { score: 5 },
    })
  })

  it('rejects a body with no data field', async () => {
    vi.mocked(resolveLiffParticipant).mockResolvedValue(okAuth)
    const request = new Request('https://example.com/api/liff/liff-1/session', {
      method: 'PUT',
      headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalKey: 'k1' }),
    })
    const response = await PUT(request, { params: Promise.resolve({ liffId: 'liff-1' }) })
    expect(response.status).toBe(400)
    expect(upsertLiffSession).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run "app/api/liff/[liffId]"`
Expected: FAIL — `Cannot find module './route'` (both files)

- [ ] **Step 3: Write the implementations**

```typescript
// app/api/liff/[liffId]/me/route.ts
import { db } from '@/lib/db/client'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from '@/lib/liff/cors'
import { resolveLiffParticipant } from '@/lib/liff/auth'

export async function GET(
  request: Request, { params }: { params: Promise<{ liffId: string }> },
): Promise<Response> {
  const { liffId } = await params
  const auth = await resolveLiffParticipant(db(), liffId, request)
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status, headers: LIFF_CORS_HEADERS })
  }
  return Response.json({ participantId: auth.participantId }, { headers: LIFF_CORS_HEADERS })
}

export async function OPTIONS(): Promise<Response> {
  return liffOptionsResponse()
}
```

```typescript
// app/api/liff/[liffId]/session/route.ts
import { db } from '@/lib/db/client'
import {
  findLiffSessionByKey, listLiffSessionsForParticipant, upsertLiffSession,
} from '@/lib/db/liffSessions'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from '@/lib/liff/cors'
import { resolveLiffParticipant } from '@/lib/liff/auth'

/**
 * body สำหรับทาง API key ต้องมี lineUserId (spec §5.2) — สำหรับทาง id_token ช่องนี้
 * ถูกละเว้นเสมอ (resolveLiffParticipant อ่านตัวตนจาก token ที่ verify แล้วเท่านั้น)
 * ส่ง body?.lineUserId ให้ resolveLiffParticipant เผื่อไว้ทั้งสองทาง โดยไม่ต้องรู้ว่า
 * ทางไหนจะถูกใช้จริง
 */
async function readLineUserIdFromBody(request: Request): Promise<string | undefined> {
  try {
    const body = await request.clone().json() as { lineUserId?: string }
    return body.lineUserId
  } catch {
    return undefined
  }
}

export async function GET(
  request: Request, { params }: { params: Promise<{ liffId: string }> },
): Promise<Response> {
  const { liffId } = await params
  const sql = db()
  const auth = await resolveLiffParticipant(sql, liffId, request, { lineUserId: await readLineUserIdFromBody(request) })
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status, headers: LIFF_CORS_HEADERS })
  }

  const key = new URL(request.url).searchParams.get('key')
  if (key) {
    const session = await findLiffSessionByKey(sql, auth.liffApp.id, key)
    if (!session) return Response.json({ error: 'ไม่พบข้อมูลของ key นี้' }, { status: 404, headers: LIFF_CORS_HEADERS })
    return Response.json({ session }, { headers: LIFF_CORS_HEADERS })
  }

  const sessions = await listLiffSessionsForParticipant(sql, auth.liffApp.id, auth.participantId)
  return Response.json({ sessions }, { headers: LIFF_CORS_HEADERS })
}

export async function PUT(
  request: Request, { params }: { params: Promise<{ liffId: string }> },
): Promise<Response> {
  const { liffId } = await params
  const sql = db()
  const rawBody = await request.json() as { externalKey?: string; data?: unknown; lineUserId?: string }

  const auth = await resolveLiffParticipant(sql, liffId, request, { lineUserId: rawBody.lineUserId })
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status, headers: LIFF_CORS_HEADERS })
  }

  if (rawBody.data === undefined) {
    return Response.json({ error: 'ต้องมีช่อง data' }, { status: 400, headers: LIFF_CORS_HEADERS })
  }

  const session = await upsertLiffSession(sql, {
    liffAppId: auth.liffApp.id, participantId: auth.participantId,
    externalKey: rawBody.externalKey ?? null, data: rawBody.data,
  })
  return Response.json({ session }, { headers: LIFF_CORS_HEADERS })
}

export async function OPTIONS(): Promise<Response> {
  return liffOptionsResponse()
}
```

Note the `GET` handler reads a body for `lineUserId` even though GET requests don't typically carry one —
this only matters for the API-key path, where a server-to-server caller has no other way to say "on behalf of
whom." A browser calling via id_token never sends a body on GET and `readLineUserIdFromBody` safely returns
`undefined` when there is none (the try/catch around a body-less GET's `.json()` call handles that).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run "app/api/liff/[liffId]"`
Expected: PASS (all tests across both files)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "app/api/liff/[liffId]/me/route.ts" "app/api/liff/[liffId]/me/route.test.ts" "app/api/liff/[liffId]/session/route.ts" "app/api/liff/[liffId]/session/route.test.ts"
git commit -m "feat: add /api/liff/[liffId]/me and /session routes"
```

**Note on the "regression" tier from spec §10:** this project's regression tests snapshot LINE-facing JSON
(`renderCard()` output) because that shape is deeply nested and hand-writing every expected variant would be
unwieldy — see `tests/*.test.ts` snapshots. These routes' responses are flat and few-fielded, and Step 1's
tests already assert full-body `.toEqual()` (not `.toMatchObject()`), which catches an added/removed/renamed
field exactly as a snapshot would. No separate snapshot file is added here; the existing tests already serve
that role for this endpoint shape.

---

### Task 9: Admin screen — register a new LIFF app

**Files:**
- Create: `app/(admin)/liff-apps/actions.ts`
- Create: `app/(admin)/liff-apps/page.tsx`
- Test: `app/(admin)/liff-apps/actions.test.ts`
- Modify: `components/layout/GlobalNav.tsx:11-14` (add a nav entry)

**Interfaces:**
- Consumes: `createLiffApp`, `listLiffApps` (Task 3), `requireRole` (`lib/auth/require.ts`), `db()`
  (`lib/db/client`), `type ActionResult` (`lib/actions/result.ts`), existing UI primitives from
  `components/ui` (`Badge`, `Button`, `Field`, `Note`, `PageHead`, `Panel` — same set `/channels` uses)
- Produces: server action `createLiffAppAction(formData: FormData): Promise<ActionResult>`

- [ ] **Step 1: Write the failing test**

```typescript
// app/(admin)/liff-apps/actions.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let sessionRole: 'configurator' | 'content_editor' | null = 'configurator'

vi.mock('@/lib/auth/session', () => ({
  getSession: async () => (sessionRole ? { userId: 'u1', role: sessionRole } : null),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ db: () => ({}) }))
vi.mock('@/lib/db/liffApps', () => ({ createLiffApp: vi.fn() }))

const { createLiffApp } = await import('@/lib/db/liffApps')
const { createLiffAppAction } = await import('./actions')

beforeEach(() => { sessionRole = 'configurator' })
afterEach(() => { vi.clearAllMocks() })

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

describe('createLiffAppAction', () => {
  it('rejects a non-configurator', async () => {
    sessionRole = 'content_editor'
    const result = await createLiffAppAction(formData({
      name: 'x', liff_id: 'liff-1', line_login_channel_id: '1', channel_id: 'c1', api_key: 'k',
    }))
    expect(result.ok).toBe(false)
    expect(createLiffApp).not.toHaveBeenCalled()
  })

  it('rejects a missing required field with a specific message, not a generic one', async () => {
    const result = await createLiffAppAction(formData({
      name: '', liff_id: 'liff-1', line_login_channel_id: '1', channel_id: 'c1', api_key: 'k',
    }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toContain('ชื่อ')
  })

  it('creates the app and returns ok:true on valid input', async () => {
    vi.mocked(createLiffApp).mockResolvedValue({
      id: 'app-1', name: 'ทดสอบ', liffId: 'liff-1', lineLoginChannelId: '2011037337',
      channelId: 'c1', apiKeyLast4: 'abcd', createdAt: new Date(),
    })
    const result = await createLiffAppAction(formData({
      name: 'ทดสอบ', liff_id: 'liff-1', line_login_channel_id: '2011037337', channel_id: 'c1', api_key: 'sk_abc',
    }))
    expect(result).toEqual({ ok: true })
    expect(createLiffApp).toHaveBeenCalledWith({}, {
      name: 'ทดสอบ', liffId: 'liff-1', lineLoginChannelId: '2011037337',
      channelId: 'c1', apiKey: 'sk_abc', createdBy: 'u1',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "app/(admin)/liff-apps/actions.test.ts"`
Expected: FAIL — `Cannot find module './actions'`

- [ ] **Step 3: Write the server action**

```typescript
// app/(admin)/liff-apps/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/lib/actions/result'
import { requireRole } from '@/lib/auth/require'
import { db } from '@/lib/db/client'
import { createLiffApp } from '@/lib/db/liffApps'

const trimmed = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim()

const resultMessage = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback

/**
 * คืน ActionResult แทนที่จะ throw/redirect ตรงๆ — ทางเดียวกับ saveChannel
 * (app/(admin)/channels/actions.ts) เพราะเหตุผลเดียวกัน: Next.js เซ็นเซอร์ข้อความของ
 * error ที่ throw ออกจาก Server Action ทิ้งเสมอในโปรดักชัน
 */
export async function createLiffAppAction(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireRole('configurator')

    const name = trimmed(formData, 'name')
    if (!name) throw new Error('ต้องตั้งชื่อ LIFF ให้ทีมรู้ว่าเป็นตัวไหน')

    const liffId = trimmed(formData, 'liff_id')
    if (!liffId) throw new Error('ต้องกรอก LIFF ID')

    const lineLoginChannelId = trimmed(formData, 'line_login_channel_id')
    if (!lineLoginChannelId) throw new Error('ต้องกรอก Channel ID ของ LINE Login channel')

    const channelId = trimmed(formData, 'channel_id')
    if (!channelId) throw new Error('ต้องเลือกบัญชี LINE (OA) ที่ LIFF นี้ผูกด้วย')

    const apiKey = trimmed(formData, 'api_key')
    if (!apiKey) throw new Error('ต้องตั้ง API key ให้ backend ของ LIFF ใช้เรียกกลับมา')

    await createLiffApp(db(), { name, liffId, lineLoginChannelId, channelId, apiKey, createdBy: session.userId })

    revalidatePath('/liff-apps')
    return { ok: true }
  } catch (err) {
    return { ok: false, message: resultMessage(err, 'บันทึกไม่สำเร็จ — ลองใหม่') }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "app/(admin)/liff-apps/actions.test.ts"`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the page**

Read `app/(admin)/channels/page.tsx` first for the exact `Field`/`Panel`/`PageHead` usage this should mirror.
Then write:

```typescript
// app/(admin)/liff-apps/page.tsx
import { redirect } from 'next/navigation'
import { Badge, Button, Field, Note, PageHead, Panel } from '@/components/ui'
import { getSession } from '@/lib/auth/session'
import { listChannels } from '@/lib/db/channels'
import { db } from '@/lib/db/client'
import { listLiffApps } from '@/lib/db/liffApps'
import { createLiffAppAction } from './actions'

export default async function LiffAppsPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const sql = db()
  const [apps, channels] = await Promise.all([listLiffApps(sql), listChannels(sql)])
  const canEdit = session.role === 'configurator'

  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 800, margin: '0 auto' }}>
      <PageHead
        code="LIFF"
        title="LIFF"
        actions={!canEdit ? <Badge tone="mute">ดูอย่างเดียว</Badge> : null}
      />

      <Note tone="info" style={{ marginBottom: 16 }}>
        แต่ละแถวคือ LIFF หนึ่งตัวที่ได้รับอนุญาตให้เก็บ/อ่านข้อมูลผ่าน LineKit — ดู
        <code> docs/superpowers/specs/2026-08-21-liff-platform-design.md</code> สำหรับวิธีที่ LIFF ฝั่งของคุณ
        ต้องเรียก API เหล่านี้
      </Note>

      {canEdit && (
        <Panel style={{ marginBottom: 16 }}>
          <Panel.Row>
            <form
              action={async (formData: FormData) => {
                'use server'
                await createLiffAppAction(formData)
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <Field label="ชื่อ LIFF (ตั้งเองให้ทีมเข้าใจ)">
                <input name="name" required placeholder="เช่น DewLIFF v2" />
              </Field>
              <Field label="LIFF ID" hint="จากแท็บ LIFF ของ LINE Login channel">
                <input name="liff_id" required style={{ fontFamily: 'var(--mono)' }} />
              </Field>
              <Field label="Channel ID ของ LINE Login channel" hint="คนละค่ากับ Channel ID ของ OA ด้านล่าง">
                <input name="line_login_channel_id" required style={{ fontFamily: 'var(--mono)' }} />
              </Field>
              <Field label="บัญชี LINE (OA) ที่ผูกด้วย">
                <select name="channel_id" required>
                  <option value="">— เลือกบัญชี —</option>
                  {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="API key" hint="ให้ backend ของ LIFF ใช้เรียกกลับมา — ไม่มีทางดูค่าเต็มได้อีกหลังบันทึก">
                <input name="api_key" type="password" required style={{ fontFamily: 'var(--mono)' }} />
              </Field>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button type="submit">+ ลงทะเบียน LIFF</Button>
              </div>
            </form>
          </Panel.Row>
        </Panel>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {apps.map((app) => (
          <Panel key={app.id}>
            <Panel.Row style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <b>{app.name}</b>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>{app.liffId}</div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                กุญแจ: •••{app.apiKeyLast4}
              </div>
            </Panel.Row>
          </Panel>
        ))}
      </div>
    </main>
  )
}
```

The props used above (`PageHead({code, title, actions})`, `Panel`/`Panel.Row`, `Field({label, hint,
children})`, `Badge({tone, children})`, `Button({variant, type, children})`, `Note({tone, children,
style})`) were checked against `components/ui/*.tsx` and `app/(admin)/channels/page.tsx`'s actual usage —
they match; no adjustment needed.

- [ ] **Step 6: Add the nav entry**

In `components/layout/GlobalNav.tsx`, find:

```typescript
const ITEMS: Item[] = [
  { label: 'แคมเปญ', href: '/campaigns' },
  { label: 'บัญชี LINE', href: '/channels' },
  { label: 'ผู้ใช้ภายใน', href: '/users', adminOnly: true },
]
```

Replace with:

```typescript
const ITEMS: Item[] = [
  { label: 'แคมเปญ', href: '/campaigns' },
  { label: 'บัญชี LINE', href: '/channels' },
  { label: 'LIFF', href: '/liff-apps' },
  { label: 'ผู้ใช้ภายใน', href: '/users', adminOnly: true },
]
```

- [ ] **Step 7: Typecheck and run the dev server to eyeball the page**

Run: `npm run typecheck`
Expected: no errors — fix any prop mismatches found in Step 5's note here.

Run: `npm run dev`, open `/liff-apps` while logged in, confirm the form renders and the nav shows "LIFF".

- [ ] **Step 8: Commit**

```bash
git add app/\(admin\)/liff-apps components/layout/GlobalNav.tsx
git commit -m "feat: add admin screen to register LIFF apps"
```

---

### Task 10: Integration test — confirm shared identity end to end

This is the test that actually proves spec §3.1's core promise: a player reaching LineKit through the LIFF
API and through the webhook resolve to the same `participant` row.

**Files:**
- Create: `tests/liff-platform.integration.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–8; `makePorts` from `lib/db/queries.ts` (the webhook path) for
  comparison

- [ ] **Step 1: Write the test**

```typescript
// tests/liff-platform.integration.test.ts
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import { testDb } from '../lib/db/client'
import { createLiffApp } from '../lib/db/liffApps'
import { makePorts } from '../lib/db/queries'
import { resolveLiffParticipant } from '../lib/liff/auth'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'
let sql: postgres.Sql
let channelId: string
let lineChannelId: string
let liffId: string
const apiKey = 'sk_integration_test'

beforeAll(async () => {
  process.env.SECRET_KEY_V1 = randomBytes(32).toString('base64')
  sql = testDb(url)

  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`liffplatform-${randomBytes(4).toString('hex')}@example.com`}, 'configurator')
    RETURNING id`
  lineChannelId = `9${randomBytes(4).readUInt32BE(0)}`
  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (name, channel_type, line_channel_id, created_by)
    VALUES ('Seed', 'preview', ${lineChannelId}, ${user.id}) RETURNING id`
  channelId = channel.id

  const app = await createLiffApp(sql, {
    name: 'Integration', liffId: `2011-${randomBytes(4).toString('hex')}`,
    lineLoginChannelId: '2011037337', channelId, apiKey, createdBy: user.id,
  })
  liffId = app.liffId
})

afterAll(async () => { await sql.end() })

describe('LIFF platform · shared participant identity', () => {
  it('a player reached via the LIFF API-key path and the same player reached via the webhook path resolve to the same participant', async () => {
    const lineUid = `U-shared-${randomBytes(4).toString('hex')}`

    // เส้นทาง webhook — ผ่าน makePorts().ensureParticipant() ตัวเดียวกับที่ route.ts จริงเรียก
    const webhookParticipantId = await makePorts(sql).ensureParticipant(lineChannelId, lineUid)

    // เส้นทาง LIFF — ผ่าน resolveLiffParticipant() ทาง API key
    const request = new Request('https://example.com', { headers: { Authorization: `Bearer ${apiKey}` } })
    const auth = await resolveLiffParticipant(sql, liffId, request, { lineUserId: lineUid })

    expect(auth.ok).toBe(true)
    if (!auth.ok) return
    expect(auth.participantId).toBe(webhookParticipantId)
  })

  it('the id_token path resolves to the same participant too, given the same verified LINE userId', async () => {
    const lineUid = `U-shared2-${randomBytes(4).toString('hex')}`
    const webhookParticipantId = await makePorts(sql).ensureParticipant(lineChannelId, lineUid)

    vi.doMock('../lib/line/liffVerify', () => ({
      verifyLiffIdToken: async () => ({ ok: true, lineUserId: lineUid }),
    }))
    const { resolveLiffParticipant: resolveWithMockedVerify } = await import('../lib/liff/auth')

    const request = new Request('https://example.com', { headers: { Authorization: 'Bearer not-the-api-key' } })
    const auth = await resolveWithMockedVerify(sql, liffId, request)

    expect(auth.ok).toBe(true)
    if (!auth.ok) return
    expect(auth.participantId).toBe(webhookParticipantId)

    vi.doUnmock('../lib/line/liffVerify')
  })
})
```

Note on the second test: mocking `verifyLiffIdToken` mid-file via `vi.doMock` + dynamic re-import is
necessary because this suite intentionally exercises real Postgres end to end and must not make a real
network call to LINE. If this pattern proves awkward once written, an acceptable alternative is splitting it
into its own file with the mock declared at module scope (matching the style already used in
`lib/liff/auth.test.ts`) — either is fine, the assertion is what matters.

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/liff-platform.integration.test.ts`
Expected: PASS (2 tests) — requires Postgres reachable at `TEST_DATABASE_URL`.

- [ ] **Step 3: Run the full integration suite once more to confirm no regressions**

Run: `npm run test:integration`
Expected: every suite passes, including this new one.

- [ ] **Step 4: Commit**

```bash
git add tests/liff-platform.integration.test.ts
git commit -m "test: confirm LIFF and webhook paths resolve to the same participant"
```

---

### Task 11: Full verification pass

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Full unit suite**

Run: `npm test`
Expected: all pass, including every new file from Tasks 1–10.

- [ ] **Step 3: Full integration suite**

Run: `npm run db:reset && npm run test:integration`
Expected: all pass.

- [ ] **Step 4: Production build**

Run: `npx next build`
Expected: `Compiled successfully` — this is the check that would have caught the `@napi-rs/canvas` bundling
bug from earlier in the project's history; run it explicitly here too since this plan adds new route files
under `app/api/` that `npm test`/`typecheck` alone would not catch a browser-bundling problem in.

- [ ] **Step 5: Manual smoke test against the real DewLIFF test project (or any LIFF you have handy)**

Point a test LIFF's fetch calls at `http://localhost:3000/api/liff/<liffId>/session` (after registering it
via the new `/liff-apps` page), open it from inside the LINE app, and confirm a `PUT` followed by a `GET`
round-trips real data. This is the acceptance criterion from spec §1 — no automated test substitutes for
actually trying it from a real LIFF.
