# Flex System Builder สไลซ์ 1 · แกนหลัง — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** รื้อเกมคุกกี้ทิ้ง แล้วสร้างแกนหลังของ Flex System Builder ให้ตอบข้อความบน LINE ตามค่าที่อยู่ในฐานข้อมูล พร้อมสุ่มรางวัลที่ตัดโควตาถูกต้องเมื่อคนกดพร้อมกัน

**Architecture:** ตรรกะทั้งหมดเป็น pure function ใน `lib/engine/` และ `lib/render/` ที่ห้าม import อะไรที่แตะเน็ตหรือฐานข้อมูล บังคับด้วยเทสต์ที่ไล่อ่าน import จริง · การเขียนที่ต้อง atomic ยุบเป็น RPC เดียว โดย TypeScript ตัดสินแล้วส่งรายการผลลัพธ์ที่เรียงลำดับแล้วให้ SQL หยิบตัวแรกที่โควตายังเหลือ

**Tech Stack:** Next.js 15 · TypeScript · Vitest · Supabase (Postgres 15 รันในเครื่องผ่าน Docker) · `postgres` (postgres.js) สำหรับ integration test

**ขอบเขตของแผนนี้:** ขั้น 1–5 ของ spec §11 · หน้าจอหลังบ้าน 15 หน้าอยู่ในแผนถัดไป (`2026-08-14-flex-slice1-admin.md`) · จบแผนนี้แล้ว config ใส่ผ่าน SQL seed และระบบตอบบน LINE ได้จริง

## Global Constraints

- **Node 22+ · TypeScript strict** — `tsconfig.json` เดิมตั้ง `strict: true` ไว้แล้ว ห้ามผ่อน
- **ห้ามใช้ Push / Multicast / Broadcast** — ทุกการตอบกลับผ่าน Reply API ด้วย `replyToken` เท่านั้น (BR-02)
- **`lib/engine/` และ `lib/render/` ห้าม import** `lib/db/`, `lib/line/client`, `next/*`, หรือเรียก `fetch` — บังคับด้วยเทสต์ใน Task 13
- **ห้ามมีทางไหนจบแบบเงียบ** — ทุกกิ่งของ webhook ต้องคืนข้อความตอบ (BR-01)
- **ห้ามมีชื่อเฉพาะของแคมเปญใดแคมเปญหนึ่งในโค้ด** `lib/` — วิธีวัด AC-01 (BR-10)
- **postback ยาวได้ไม่เกิน 300 ตัวอักษร** — ปฏิเสธตอนสร้าง ไม่ใช่ตอนส่ง (BR-33)
- **ชั้น unit ต้องรันได้โดยไม่ต่อเน็ตและไม่มีฐานข้อมูล** — `npm test` ต้องเขียวบนเครื่องที่ไม่มี Docker
- **commit หลังทุก task** — ข้อความ commit เป็นภาษาอังกฤษ อธิบายเหตุผล ไม่ใช่แค่บอกว่าทำอะไร
- **เอกสารอ้างอิง** `~/Downloads/FLEX_AD_L2_v0.31.html` §5.2 (ตาราง) · §5.3 (enum) · §5.5 (constraint)

---

## File Structure

| ไฟล์ | รับผิดชอบอะไร |
|---|---|
| `lib/daykey.ts` | คำนวณ `period_key` จาก timezone + `day_length_sec` |
| `lib/match/postback.ts` | เข้ารหัส/ถอดรหัส payload ของปุ่ม + เพดาน 300 |
| `lib/match/keyword.ts` | ทำข้อความให้เป็นมาตรฐานแล้วจับคู่ `keyword_rule` |
| `lib/state.ts` | ชนิด `PlayerState` + ตัวประเมินเงื่อนไข ใช้ร่วมกันระหว่าง entry กับ show_when |
| `lib/render/groups.ts` | `card_block[]` + `PlayerState` → สามกลุ่ม |
| `lib/render/vars.ts` | แทนค่า `{{counter.x}}` `{{attr.x}}` |
| `lib/render/flex.ts` | สามกลุ่ม → Flex bubble / carousel |
| `lib/render/text.ts` | สามกลุ่ม → ข้อความล้วน |
| `lib/engine/entry.ts` | ตรวจเงื่อนไขเข้าเล่นตามลำดับ คืนข้อที่ไม่ผ่าน |
| `lib/engine/resolve.ts` | `fixed` `weighted` `quota` `score` → รายการผลลัพธ์เรียงลำดับ |
| `lib/engine/effects.ts` | ผลลัพธ์ → รายการ effect |
| `lib/engine/decide.ts` | ประกอบสามอันบนเป็นผลตัดสินเดียว |
| `lib/types.ts` | ชนิดข้อมูลร่วมของ config ที่ engine กับ render ใช้ |
| `supabase/migrations/0001_init.sql` | 37 ตาราง + constraint ตาม §5.5 |
| `supabase/migrations/0002_play_and_apply.sql` | RPC ที่เขียนแบบ atomic |
| `lib/db/queries.ts` | อ่าน config และสถานะผู้เล่น |
| `lib/db/apply.ts` | เรียก RPC |
| `lib/db/cache.ts` | แคช config ตาม `config_version.id` |
| `app/api/line/webhook/route.ts` | ต่อทุกอย่างเข้าด้วยกัน |
| `scripts/check-schema-vs-doc.mjs` | เทียบ schema กับเอกสาร |

**ไฟล์ที่ลบ** — `lib/game/*` · `lib/flex/{fortune,grid,prompt}.{ts,test.ts}`
**ไฟล์ที่เก็บไว้ทั้งดุ้น** — `lib/line/{verify,client,types}.ts` · `lib/test-utils/rng.ts` · `scripts/probe-line-limits.mjs`

---

### Task 1: รื้อเกมคุกกี้ออกให้หมด

**Files:**
- Delete: `lib/game/` ทั้งโฟลเดอร์ · `lib/flex/fortune.ts` · `lib/flex/fortune.test.ts` · `lib/flex/grid.ts` · `lib/flex/grid.test.ts` · `lib/flex/prompt.ts` · `lib/flex/prompt.test.ts`
- Modify: `app/api/line/webhook/route.ts` · `app/api/line/webhook/route.test.ts` · `app/page.tsx` · `README.md`
- Keep: `lib/line/*` · `lib/flex/theme.ts` · `lib/flex/types.ts` · `lib/test-utils/rng.ts`

**Interfaces:**
- Consumes: ไม่มี — เป็น task แรก
- Produces: repo ที่ `npm test` เขียวโดยไม่มีเกมเหลืออยู่

- [ ] **Step 1: ดูก่อนว่าอะไรพึ่งอะไรอยู่**

```bash
grep -rn "lib/game\|flex/fortune\|flex/grid\|flex/prompt" --include=*.ts --include=*.tsx .
```

จดไว้ว่ามีไฟล์ไหนอ้างถึงบ้าง — ต้องแก้ให้ครบในขั้นถัดไป

- [ ] **Step 2: ลบไฟล์ของเกม**

```bash
git rm -r lib/game
git rm lib/flex/fortune.ts lib/flex/fortune.test.ts \
       lib/flex/grid.ts lib/flex/grid.test.ts \
       lib/flex/prompt.ts lib/flex/prompt.test.ts
```

- [ ] **Step 3: ทำ webhook ให้เป็นโครงเปล่าที่ยังตอบ 200 ได้**

แทนที่ `app/api/line/webhook/route.ts` ทั้งไฟล์

```ts
import { NextRequest } from 'next/server'
import { verifySignature } from '@/lib/line/verify'

export async function POST(request: NextRequest) {
  const raw = await request.text()
  const signature = request.headers.get('x-line-signature')

  if (!verifySignature(raw, signature)) {
    return new Response('invalid signature', { status: 401 })
  }

  // Answer LINE before doing any work. LINE retries on non-200, and a retry
  // after we have already granted a reward would grant it twice.
  return Response.json({ ok: true })
}
```

- [ ] **Step 4: ตัดเทสต์ที่อ้างถึงเกมออกจาก route.test.ts**

เหลือไว้เฉพาะสองเคส — ลายเซ็นผิดได้ 401 · ลายเซ็นถูกได้ 200 · ลบ `describe` block ที่ทดสอบ fortune/grid ทิ้งทั้งหมด

- [ ] **Step 5: ทำหน้าแรกให้เป็นข้อความว่าง**

`app/page.tsx`

```tsx
export default function Home() {
  return <main style={{ fontFamily: 'system-ui', padding: 40 }}>
    <h1>Flex System Builder</h1>
    <p>ระบบกำลังทำงาน · หน้าจอหลังบ้านอยู่ระหว่างพัฒนา</p>
  </main>
}
```

- [ ] **Step 6: รันเทสต์กับ typecheck**

```bash
npm test && npm run typecheck
```

Expected: PASS ทั้งคู่ · จำนวนเทสต์ลดลงเหลือเฉพาะ `lib/line/*` กับ route

- [ ] **Step 7: ปรับ README ให้ตรงกับความจริง**

ลบหัวข้อ "วิธีเล่น" กับ "แก้คำทำนาย" · เก็บหัวข้อตั้งค่า LINE OA และ OI-03 ไว้ · เพิ่มบรรทัดบนสุดว่าโปรเจกต์นี้คืออะไรตอนนี้

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: strip the fortune cookie game down to the LINE plumbing

The game was a proof that the reply path works. That proof is banked; what
survives is the part that is still true for the builder — signature checks,
the reply client, and answering LINE before doing work so a retry cannot
grant a reward twice. Everything that knew what a fortune was is gone."
```

---

### Task 2: `lib/daykey.ts` — คำนวณ period_key

**Files:**
- Create: `lib/daykey.ts` · `lib/daykey.test.ts`

**Interfaces:**
- Consumes: ไม่มี
- Produces: `periodKey(at: Date, tz: string, dayLengthSec: number): string` — คืน `'2026-08-14'` เมื่อวันยาวปกติ หรือ `'2026-08-14#2'` เมื่อวันสั้นกว่า 24 ชม. (โหมดเดโม่ DD-06)

**ทำไมเป็น task แรกของตรรกะ** — `play_lock.period_key` พึ่งฟังก์ชันนี้ และถ้าคำนวณผิด "วันละครั้ง" จะพัง โดยไม่มีอะไรฟ้อง

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`lib/daykey.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { periodKey } from './daykey'

describe('periodKey', () => {
  it('ใช้วันตามเขตเวลาของแคมเปญ ไม่ใช่ UTC', () => {
    // 2026-08-14T18:30Z คือ 2026-08-15 01:30 ที่กรุงเทพ
    const at = new Date('2026-08-14T18:30:00Z')
    expect(periodKey(at, 'Asia/Bangkok', 86400)).toBe('2026-08-15')
  })

  it('ก่อนเที่ยงคืนกรุงเทพยังเป็นวันเดิม', () => {
    const at = new Date('2026-08-14T16:59:00Z') // 23:59 ที่กรุงเทพ
    expect(periodKey(at, 'Asia/Bangkok', 86400)).toBe('2026-08-14')
  })

  it('วันสั้นแบบเดโม่ 30 วินาที แบ่งวันเป็นช่วงย่อย', () => {
    const a = new Date('2026-08-14T00:00:10Z')
    const b = new Date('2026-08-14T00:00:40Z')
    expect(periodKey(a, 'UTC', 30)).not.toBe(periodKey(b, 'UTC', 30))
  })

  it('ช่วงเดียวกันได้คีย์เดียวกันเสมอ', () => {
    const a = new Date('2026-08-14T00:00:10Z')
    const b = new Date('2026-08-14T00:00:25Z')
    expect(periodKey(a, 'UTC', 30)).toBe(periodKey(b, 'UTC', 30))
  })
})
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าแดง**

```bash
npx vitest run lib/daykey.test.ts
```

Expected: FAIL — `Failed to resolve import "./daykey"`

- [ ] **Step 3: เขียนโค้ดให้น้อยที่สุดที่ทำให้ผ่าน**

`lib/daykey.ts`

```ts
/**
 * The key that "once per day" is counted against.
 *
 * A campaign can shorten its day (DD-06) so a demo can run a seven-day streak
 * in three minutes. When the day is shorter than 24h the date alone no longer
 * separates plays, so the slot inside the day is appended.
 */
export function periodKey(at: Date, tz: string, dayLengthSec: number): string {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at) // en-CA formats as YYYY-MM-DD

  if (dayLengthSec >= 86_400) return date

  const slot = Math.floor(Math.floor(at.getTime() / 1000) / dayLengthSec)
  return `${date}#${slot}`
}
```

- [ ] **Step 4: รันเทสต์ให้เขียว**

```bash
npx vitest run lib/daykey.test.ts
```

Expected: PASS ทั้ง 4 เคส

- [ ] **Step 5: Commit**

```bash
git add lib/daykey.ts lib/daykey.test.ts
git commit -m "feat: compute the period key a play lock is counted against

The campaign's timezone decides which day a play belongs to, not the server's.
A campaign may also shorten its day so a seven-day streak can be demoed in
minutes, and then the date alone stops separating plays — hence the slot
suffix."
```

---

### Task 3: `lib/match/postback.ts` — payload ของปุ่ม

**Files:**
- Create: `lib/match/postback.ts` · `lib/match/postback.test.ts`

**Interfaces:**
- Consumes: ไม่มี
- Produces:
  - `type Postback = { c: string; a: string; d: string; r?: string; p?: string }`
    (`c` รหัสแคมเปญ · `a` รหัสกิจกรรม · `d` period key · `r` รอบควิซ · `p` ตัวเลือกที่กด)
  - `encodePostback(p: Postback): string` — โยน `Error` ถ้าเกิน 300 ตัวอักษร
  - `decodePostback(raw: string): Postback | null` — คืน `null` เมื่อรูปแบบไม่ถูก

**กติกาที่ต้องรักษา** — รหัสแคมเปญกับ period key ต้องแนบไปกับทุกปุ่มเสมอ (BR-33) เพราะการ์ดเก่าในแชทกดได้ตลอดไป

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`lib/match/postback.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { decodePostback, encodePostback } from './postback'

describe('postback', () => {
  it('เข้ารหัสแล้วถอดกลับได้ของเดิม', () => {
    const p = { c: 'krobpet', a: 'feed', d: '2026-08-14', p: '3' }
    expect(decodePostback(encodePostback(p))).toEqual(p)
  })

  it('ช่องที่ไม่ได้ใส่ ไม่โผล่ตอนถอด', () => {
    const p = { c: 'krobpet', a: 'feed', d: '2026-08-14' }
    const back = decodePostback(encodePostback(p))
    expect(back).toEqual(p)
    expect(back).not.toHaveProperty('r')
  })

  it('ปฏิเสธตั้งแต่ตอนสร้างเมื่อยาวเกิน 300', () => {
    const p = { c: 'x'.repeat(200), a: 'y'.repeat(200), d: '2026-08-14' }
    expect(() => encodePostback(p)).toThrow(/300/)
  })

  it('ถอดของที่ไม่ใช่ payload ของเรา คืน null ไม่โยน', () => {
    expect(decodePostback('')).toBeNull()
    expect(decodePostback('hello world')).toBeNull()
    expect(decodePostback('a=feed&d=2026-08-14')).toBeNull() // ขาด c
  })
})
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าแดง**

```bash
npx vitest run lib/match/postback.test.ts
```

Expected: FAIL — resolve import ไม่ได้

- [ ] **Step 3: เขียนโค้ด**

`lib/match/postback.ts`

```ts
/** LINE caps postback data at 300 characters. */
const MAX_LENGTH = 300

export type Postback = {
  /** campaign code — a card left in a chat outlives its campaign */
  c: string
  /** activity code */
  a: string
  /** period key the card was issued for */
  d: string
  /** quiz round token, when the activity asks a series of questions */
  r?: string
  /** which option the player tapped */
  p?: string
}

const KEYS = ['c', 'a', 'd', 'r', 'p'] as const

export function encodePostback(p: Postback): string {
  const parts: string[] = []
  for (const key of KEYS) {
    const value = p[key]
    if (value !== undefined) parts.push(`${key}=${encodeURIComponent(value)}`)
  }
  const encoded = parts.join('&')

  if (encoded.length > MAX_LENGTH) {
    throw new Error(
      `postback is ${encoded.length} characters, over LINE's limit of ${MAX_LENGTH}`,
    )
  }
  return encoded
}

export function decodePostback(raw: string): Postback | null {
  if (!raw) return null

  const out: Record<string, string> = {}
  for (const pair of raw.split('&')) {
    const index = pair.indexOf('=')
    if (index < 1) return null
    const key = pair.slice(0, index)
    if (!(KEYS as readonly string[]).includes(key)) return null
    out[key] = decodeURIComponent(pair.slice(index + 1))
  }

  if (!out.c || !out.a || !out.d) return null
  return out as Postback
}
```

- [ ] **Step 4: รันเทสต์ให้เขียว**

```bash
npx vitest run lib/match/postback.test.ts
```

Expected: PASS ทั้ง 4 เคส

- [ ] **Step 5: Commit**

```bash
git add lib/match/postback.ts lib/match/postback.test.ts
git commit -m "feat: encode and decode the payload every button carries

A card sent into a chat can be tapped years later, so every button carries the
campaign code and the period it was issued for — that is what lets the engine
tell an expired tap from a live one. The 300-character ceiling is LINE's, and
it is enforced when the button is built rather than when it is sent, because a
payload that is too long fails silently at send time."
```

---

### Task 4: `lib/match/keyword.ts` — จับคู่คีย์เวิร์ด

**Files:**
- Create: `lib/match/keyword.ts` · `lib/match/keyword.test.ts`

**Interfaces:**
- Consumes: ไม่มี
- Produces:
  - `type KeywordRule = { id: string; keyword: string; matchMode: 'exact' | 'contains'; sortOrder: number }`
  - `normalizeText(input: string): string`
  - `matchKeyword(text: string, rules: KeywordRule[]): KeywordRule | null`

**กติกา** — `exact` ตรวจก่อน `contains` เสมอ (§5.3 `keyword_rule.match_mode`) · ทำข้อความให้เป็นมาตรฐานก่อนเทียบ (BR-48)

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`lib/match/keyword.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { matchKeyword, normalizeText, type KeywordRule } from './keyword'

const rule = (o: Partial<KeywordRule> & { id: string; keyword: string }): KeywordRule => ({
  matchMode: 'exact', sortOrder: 0, ...o,
})

describe('normalizeText', () => {
  it('ตัดช่องว่างหัวท้ายและยุบช่องว่างซ้ำ', () => {
    expect(normalizeText('  เสี่ยง   ทาย  ')).toBe('เสี่ยง ทาย')
  })
  it('ตัวพิมพ์ใหญ่เล็กไม่ต่างกัน', () => {
    expect(normalizeText('PLAY')).toBe(normalizeText('play'))
  })
  it('ตัดอักขระที่มองไม่เห็นออก', () => {
    expect(normalizeText('เล่น​')).toBe('เล่น')
  })
})

describe('matchKeyword', () => {
  const rules = [
    rule({ id: 'r1', keyword: 'เล่น', matchMode: 'contains', sortOrder: 1 }),
    rule({ id: 'r2', keyword: 'เล่นเกม', matchMode: 'exact', sortOrder: 2 }),
  ]

  it('exact ชนะ contains แม้ sortOrder จะมากกว่า', () => {
    expect(matchKeyword('เล่นเกม', rules)?.id).toBe('r2')
  })

  it('ไม่มี exact ตรง จึงตกมาที่ contains', () => {
    expect(matchKeyword('อยากเล่นจัง', rules)?.id).toBe('r1')
  })

  it('ไม่ตรงเลยคืน null', () => {
    expect(matchKeyword('สวัสดี', rules)).toBeNull()
  })

  it('เทียบหลัง normalize ทั้งสองฝั่ง', () => {
    expect(matchKeyword('  เล่นเกม  ', rules)?.id).toBe('r2')
  })

  it('ในกลุ่มเดียวกันใช้ sortOrder ตัดสิน', () => {
    const many = [
      rule({ id: 'b', keyword: 'เล่น', matchMode: 'contains', sortOrder: 5 }),
      rule({ id: 'a', keyword: 'เล่น', matchMode: 'contains', sortOrder: 1 }),
    ]
    expect(matchKeyword('มาเล่นกัน', many)?.id).toBe('a')
  })
})
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าแดง**

```bash
npx vitest run lib/match/keyword.test.ts
```

Expected: FAIL — resolve import ไม่ได้

- [ ] **Step 3: เขียนโค้ด**

`lib/match/keyword.ts`

```ts
export type KeywordRule = {
  id: string
  keyword: string
  matchMode: 'exact' | 'contains'
  sortOrder: number
}

/**
 * People type with stray spaces, mixed case, and invisible characters pasted in
 * from elsewhere. Both sides of a comparison go through here so a rule that
 * looks like it should match, does.
 */
export function normalizeText(input: string): string {
  return input
    .replace(/[​-‍﻿]/g, '') // zero-width characters
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function matchKeyword(text: string, rules: KeywordRule[]): KeywordRule | null {
  const needle = normalizeText(text)
  if (!needle) return null

  const byOrder = [...rules].sort((a, b) => a.sortOrder - b.sortOrder)

  // Exact always wins. A rule that matches the whole message is a stronger
  // signal of intent than one that merely appears inside it.
  const exact = byOrder.find(
    (r) => r.matchMode === 'exact' && normalizeText(r.keyword) === needle,
  )
  if (exact) return exact

  const contains = byOrder.find(
    (r) => r.matchMode === 'contains' && needle.includes(normalizeText(r.keyword)),
  )
  return contains ?? null
}
```

- [ ] **Step 4: รันเทสต์ให้เขียว**

```bash
npx vitest run lib/match/keyword.test.ts
```

Expected: PASS ทั้ง 8 เคส

- [ ] **Step 5: Commit**

```bash
git add lib/match/keyword.ts lib/match/keyword.test.ts
git commit -m "feat: match an incoming message against the campaign's keywords

Exact beats contains regardless of ordering — a rule that matches the whole
message is a stronger signal of intent than one that merely appears inside it.
Both sides are normalized first because people type with stray spaces and paste
in zero-width characters they cannot see."
```

---

### Task 5: `lib/state.ts` — สถานะผู้เล่นและตัวประเมินเงื่อนไข

**Files:**
- Create: `lib/state.ts` · `lib/state.test.ts`

**Interfaces:**
- Consumes: ไม่มี
- Produces:
  - `type PlayerState = { attributes: Record<string,string>; counters: Record<string,number>; entitlements: string[]; playCounts: Record<string,number>; completed: string[]; lastResult?: string }`
  - `type Condition = { type: 'has_attribute'; key: string; value?: string } | { type: 'not_has_attribute'; key: string } | { type: 'has_entitlement'; rewardCode: string } | { type: 'activity_completed'; activityCode: string } | { type: 'activity_not_completed'; activityCode: string } | { type: 'activity_play_count'; activityCode: string; op: 'lt'|'gte'; count: number }`
  - `evaluate(condition: Condition, state: PlayerState): boolean`
  - `evaluateAll(conditions: Condition[] | null | undefined, state: PlayerState): boolean`

**ทำไมอยู่ไฟล์เดียวกัน** — เงื่อนไขเข้าเล่นกับ `show_when` ใช้โครงเดียวกัน (§5.2 `card_block.show_when`) · ถ้าเขียนสองตัว มันจะแยกทางกันแล้วตัวอย่างจะโกหก

**หมายเหตุขอบเขต** — `limit` และ `time_window` ต้องรู้เวลาและ `play_lock` จึงประเมินที่ `engine/entry.ts` (Task 10) ไม่ใช่ที่นี่

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`lib/state.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { evaluate, evaluateAll, type PlayerState } from './state'

const state: PlayerState = {
  attributes: { pet_type: 'dog' },
  counters: { food: 62 },
  entitlements: ['sticker'],
  playCounts: { feed: 14 },
  completed: ['quiz'],
}

describe('evaluate', () => {
  it('has_attribute แบบไม่ระบุค่า ดูแค่ว่ามีคีย์ไหม', () => {
    expect(evaluate({ type: 'has_attribute', key: 'pet_type' }, state)).toBe(true)
    expect(evaluate({ type: 'has_attribute', key: 'nope' }, state)).toBe(false)
  })

  it('has_attribute แบบระบุค่า ต้องตรงค่าด้วย', () => {
    expect(evaluate({ type: 'has_attribute', key: 'pet_type', value: 'dog' }, state)).toBe(true)
    expect(evaluate({ type: 'has_attribute', key: 'pet_type', value: 'cat' }, state)).toBe(false)
  })

  it('not_has_attribute ตรงข้ามกับ has', () => {
    expect(evaluate({ type: 'not_has_attribute', key: 'nope' }, state)).toBe(true)
    expect(evaluate({ type: 'not_has_attribute', key: 'pet_type' }, state)).toBe(false)
  })

  it('has_entitlement', () => {
    expect(evaluate({ type: 'has_entitlement', rewardCode: 'sticker' }, state)).toBe(true)
    expect(evaluate({ type: 'has_entitlement', rewardCode: 'mug' }, state)).toBe(false)
  })

  it('activity_completed อ่านจากรายการที่จบแล้ว', () => {
    expect(evaluate({ type: 'activity_completed', activityCode: 'quiz' }, state)).toBe(true)
    expect(evaluate({ type: 'activity_not_completed', activityCode: 'quiz' }, state)).toBe(false)
    expect(evaluate({ type: 'activity_not_completed', activityCode: 'feed' }, state)).toBe(true)
  })

  it('activity_play_count เทียบจำนวนครั้ง', () => {
    expect(evaluate({ type: 'activity_play_count', activityCode: 'feed', op: 'gte', count: 10 }, state)).toBe(true)
    expect(evaluate({ type: 'activity_play_count', activityCode: 'feed', op: 'lt', count: 10 }, state)).toBe(false)
    // กิจกรรมที่ยังไม่เคยเล่น นับเป็นศูนย์ ไม่ใช่ undefined
    expect(evaluate({ type: 'activity_play_count', activityCode: 'new', op: 'lt', count: 1 }, state)).toBe(true)
  })
})

describe('evaluateAll', () => {
  it('ไม่มีเงื่อนไข = ผ่านเสมอ', () => {
    expect(evaluateAll(null, state)).toBe(true)
    expect(evaluateAll([], state)).toBe(true)
  })
  it('ต้องผ่านทุกข้อ', () => {
    expect(evaluateAll([
      { type: 'has_attribute', key: 'pet_type' },
      { type: 'has_entitlement', rewardCode: 'sticker' },
    ], state)).toBe(true)
    expect(evaluateAll([
      { type: 'has_attribute', key: 'pet_type' },
      { type: 'has_entitlement', rewardCode: 'mug' },
    ], state)).toBe(false)
  })
})
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าแดง**

```bash
npx vitest run lib/state.test.ts
```

Expected: FAIL — resolve import ไม่ได้

- [ ] **Step 3: เขียนโค้ด**

`lib/state.ts`

```ts
/**
 * Everything the engine and the renderer are allowed to know about a player.
 *
 * This is deliberately one object rather than several: the same snapshot feeds
 * entry rules, block visibility, and template variables, and the preview's
 * state switcher moves this and nothing else. Split it and the preview starts
 * lying about what a player would actually see.
 */
export type PlayerState = {
  attributes: Record<string, string>
  counters: Record<string, number>
  /** reward codes this player already holds */
  entitlements: string[]
  /** activity code → how many times played, all days combined */
  playCounts: Record<string, number>
  /** activity codes the player has finished */
  completed: string[]
  /** outcome id decided this round, when there is one */
  lastResult?: string
}

export type Condition =
  | { type: 'has_attribute'; key: string; value?: string }
  | { type: 'not_has_attribute'; key: string }
  | { type: 'has_entitlement'; rewardCode: string }
  | { type: 'activity_completed'; activityCode: string }
  | { type: 'activity_not_completed'; activityCode: string }
  | { type: 'activity_play_count'; activityCode: string; op: 'lt' | 'gte'; count: number }

export function evaluate(condition: Condition, state: PlayerState): boolean {
  switch (condition.type) {
    case 'has_attribute': {
      const held = state.attributes[condition.key]
      if (held === undefined) return false
      return condition.value === undefined || held === condition.value
    }
    case 'not_has_attribute':
      return state.attributes[condition.key] === undefined

    case 'has_entitlement':
      return state.entitlements.includes(condition.rewardCode)

    case 'activity_completed':
      return state.completed.includes(condition.activityCode)

    case 'activity_not_completed':
      return !state.completed.includes(condition.activityCode)

    case 'activity_play_count': {
      // Never played counts as zero, not as missing — otherwise "played fewer
      // than once" would be false for someone who has never played at all.
      const played = state.playCounts[condition.activityCode] ?? 0
      return condition.op === 'lt' ? played < condition.count : played >= condition.count
    }
  }
}

export function evaluateAll(
  conditions: Condition[] | null | undefined,
  state: PlayerState,
): boolean {
  if (!conditions || conditions.length === 0) return true
  return conditions.every((c) => evaluate(c, state))
}
```

- [ ] **Step 4: รันเทสต์ให้เขียว**

```bash
npx vitest run lib/state.test.ts
```

Expected: PASS ทั้ง 9 เคส

- [ ] **Step 5: Commit**

```bash
git add lib/state.ts lib/state.test.ts
git commit -m "feat: model player state and the conditions read against it

Entry rules and block visibility share one condition shape, so they share one
evaluator. Two implementations would drift, and the first symptom would be a
preview that shows a card the player would never actually get.

A never-played activity counts as zero plays rather than as missing, so
'played fewer than once' is true for someone who has never played."
```

---

### Task 6: `lib/render/groups.ts` — จัดบล็อกเป็นสามกลุ่ม

**Files:**
- Create: `lib/types.ts` · `lib/render/groups.ts` · `lib/render/groups.test.ts`

**Interfaces:**
- Consumes: `PlayerState`, `evaluateAll`, `Condition` จาก `lib/state.ts`
- Produces:
  - `type BlockType = 'image' | 'title' | 'body' | 'caption' | 'progress_bar' | 'divider' | 'spacer' | 'button'`
  - `type CardBlock = { id: string; blockType: BlockType; sortOrder: number; content: string | null; showWhen: Condition[] | null; options: Record<string, unknown> | null }`
  - `type Groups = { top: CardBlock[]; content: CardBlock[]; footer: CardBlock[] }`
  - `groupBlocks(blocks: CardBlock[], state: PlayerState): Groups`

**กฎที่คัดมาจากเอกสารตรงตัว (§5.3 · BR-92)**

> `image` ที่ตั้งเป็นเต็มบนและอยู่เป็นบล็อกแรก ไปกลุ่มบนสุดได้ตัวเดียว · `button` ที่ต่อกันอยู่ท้ายรายการไปกลุ่มปุ่มท้าย สูงสุด 3 · **ที่เหลือทั้งหมดไปกลุ่มเนื้อหาโดยรักษาลำดับเดิม รวมถึงภาพหรือปุ่มที่อยู่กลางรายการ**

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`lib/render/groups.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { groupBlocks, type CardBlock } from './groups'
import type { PlayerState } from '../state'

const empty: PlayerState = {
  attributes: {}, counters: {}, entitlements: {}.constructor === Object ? [] : [],
  playCounts: {}, completed: [],
}

let seq = 0
const block = (o: Partial<CardBlock> & { blockType: CardBlock['blockType'] }): CardBlock => ({
  id: `b${seq++}`, sortOrder: seq, content: null, showWhen: null, options: null, ...o,
})

describe('groupBlocks', () => {
  it('ภาพเต็มบนที่เป็นบล็อกแรกไปกลุ่มบนสุด', () => {
    const g = groupBlocks([
      block({ blockType: 'image', options: { placement: 'full_top' } }),
      block({ blockType: 'body', content: 'hi' }),
    ], empty)
    expect(g.top).toHaveLength(1)
    expect(g.content).toHaveLength(1)
  })

  it('ภาพที่ไม่ได้เป็นบล็อกแรก อยู่ในเนื้อหา', () => {
    const g = groupBlocks([
      block({ blockType: 'body', content: 'hi' }),
      block({ blockType: 'image', options: { placement: 'full_top' } }),
    ], empty)
    expect(g.top).toHaveLength(0)
    expect(g.content).toHaveLength(2)
  })

  it('ปุ่มท้ายรายการที่ต่อกันไปกลุ่มปุ่มท้าย', () => {
    const g = groupBlocks([
      block({ blockType: 'body', content: 'hi' }),
      block({ blockType: 'button', content: 'A' }),
      block({ blockType: 'button', content: 'B' }),
    ], empty)
    expect(g.footer.map((b) => b.content)).toEqual(['A', 'B'])
    expect(g.content).toHaveLength(1)
  })

  it('ปุ่มกลางรายการอยู่กลาง ไม่ถูกดันลงท้าย', () => {
    const g = groupBlocks([
      block({ blockType: 'button', content: 'กลาง' }),
      block({ blockType: 'body', content: 'ข้อความ' }),
      block({ blockType: 'button', content: 'ท้าย' }),
    ], empty)
    expect(g.footer.map((b) => b.content)).toEqual(['ท้าย'])
    expect(g.content.map((b) => b.content)).toEqual(['กลาง', 'ข้อความ'])
  })

  it('ปุ่มท้ายเกินสาม ตัวที่เกินตกลงมาอยู่ในเนื้อหา ไม่หาย', () => {
    const g = groupBlocks([
      block({ blockType: 'button', content: '1' }),
      block({ blockType: 'button', content: '2' }),
      block({ blockType: 'button', content: '3' }),
      block({ blockType: 'button', content: '4' }),
    ], empty)
    expect(g.footer).toHaveLength(3)
    expect(g.content.map((b) => b.content)).toEqual(['1'])
  })

  it('บล็อกที่ show_when ไม่ผ่าน หายจากทั้งสามกลุ่ม', () => {
    const g = groupBlocks([
      block({ blockType: 'body', content: 'เห็น' }),
      block({ blockType: 'body', content: 'ไม่เห็น', showWhen: [{ type: 'has_entitlement', rewardCode: 'x' }] }),
    ], empty)
    expect(g.content.map((b) => b.content)).toEqual(['เห็น'])
  })

  it('เรียงตาม sortOrder ไม่ใช่ลำดับใน array', () => {
    const g = groupBlocks([
      { ...block({ blockType: 'body', content: 'สอง' }), sortOrder: 2 },
      { ...block({ blockType: 'body', content: 'หนึ่ง' }), sortOrder: 1 },
    ], empty)
    expect(g.content.map((b) => b.content)).toEqual(['หนึ่ง', 'สอง'])
  })

  it('ปุ่มที่ถูกซ่อนไม่ทำให้ปุ่มก่อนหน้ากลายเป็นปุ่มท้าย', () => {
    const g = groupBlocks([
      block({ blockType: 'button', content: 'A' }),
      block({ blockType: 'body', content: 'x' }),
      block({ blockType: 'button', content: 'B', showWhen: [{ type: 'has_entitlement', rewardCode: 'no' }] }),
    ], empty)
    // B ถูกซ่อน ปุ่มท้ายจริงจึงเป็น A ที่ตอนนี้อยู่ท้ายรายการที่มองเห็น
    expect(g.footer.map((b) => b.content)).toEqual([])
    expect(g.content.map((b) => b.content)).toEqual(['A', 'x'])
  })
})
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าแดง**

```bash
npx vitest run lib/render/groups.test.ts
```

Expected: FAIL — resolve import ไม่ได้

- [ ] **Step 3: เขียนโค้ด**

`lib/render/groups.ts`

```ts
import { evaluateAll, type Condition, type PlayerState } from '../state'

export type BlockType =
  | 'image' | 'title' | 'body' | 'caption'
  | 'progress_bar' | 'divider' | 'spacer' | 'button'

export type CardBlock = {
  id: string
  blockType: BlockType
  sortOrder: number
  content: string | null
  showWhen: Condition[] | null
  options: Record<string, unknown> | null
}

export type Groups = {
  top: CardBlock[]
  content: CardBlock[]
  footer: CardBlock[]
}

/** LINE renders at most three buttons in a bubble's footer. */
const MAX_FOOTER_BUTTONS = 3

/**
 * Split a card's blocks into the three groups every output shares.
 *
 * The one rule that matters: order is preserved. A button sitting in the middle
 * of the list stays in the middle. Only a run of buttons at the very end
 * becomes the footer, and only a full-width image in first position becomes the
 * hero. Anything else would make the editor's list disagree with what the
 * player sees, and there would be no way to tell from the screen why.
 */
export function groupBlocks(blocks: CardBlock[], state: PlayerState): Groups {
  const visible = [...blocks]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((b) => evaluateAll(b.showWhen, state))

  const top: CardBlock[] = []
  let rest = visible

  const first = rest[0]
  if (first?.blockType === 'image' && first.options?.placement === 'full_top') {
    top.push(first)
    rest = rest.slice(1)
  }

  // Walk backwards while we are still on buttons. Only that trailing run is the
  // footer — a button anywhere earlier belongs where the author put it.
  let cut = rest.length
  while (cut > 0 && rest[cut - 1].blockType === 'button') cut--

  let footer = rest.slice(cut)
  let content = rest.slice(0, cut)

  // More than three trailing buttons cannot all fit. Keep the last three and
  // leave the overflow in the content group rather than dropping it, so the
  // author can see that something did not fit.
  if (footer.length > MAX_FOOTER_BUTTONS) {
    const overflow = footer.slice(0, footer.length - MAX_FOOTER_BUTTONS)
    footer = footer.slice(footer.length - MAX_FOOTER_BUTTONS)
    content = [...content, ...overflow]
  }

  return { top, content, footer }
}
```

- [ ] **Step 4: รันเทสต์ให้เขียว**

```bash
npx vitest run lib/render/groups.test.ts
```

Expected: PASS ทั้ง 8 เคส

หมายเหตุเรื่องเคสสุดท้าย — บล็อกที่ถูกซ่อนถูกกรองออกก่อนหาปุ่มท้าย จึงคำนวณจากสิ่งที่มองเห็นจริง ไม่ใช่จากรายการดิบ

- [ ] **Step 5: Commit**

```bash
git add lib/render/groups.ts lib/render/groups.test.ts
git commit -m "feat: split card blocks into the three groups every output shares

This is the single place that decides which block lands where, so the Flex
adapter, the plain-text fallback, and the preview cannot disagree.

Order is preserved on purpose. A button in the middle of the list stays in the
middle; only a trailing run becomes the footer. If grouping reordered blocks,
the editor's list and the player's screen would differ with nothing on screen
explaining why."
```

---

### Task 7: `lib/render/vars.ts` — แทนค่าตัวแปร

**Files:**
- Create: `lib/render/vars.ts` · `lib/render/vars.test.ts`

**Interfaces:**
- Consumes: `PlayerState`
- Produces: `substitute(text: string, state: PlayerState): string`

**รูปแบบที่รองรับ** — `{{counter.food}}` · `{{attr.pet_name}}` · อ่านอย่างเดียว ไม่มีการคำนวณ (BR-14)

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`lib/render/vars.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { substitute } from './vars'
import type { PlayerState } from '../state'

const state: PlayerState = {
  attributes: { pet_name: 'โมจิ' },
  counters: { food: 62 },
  entitlements: [], playCounts: {}, completed: [],
}

describe('substitute', () => {
  it('แทนค่าสะสมและค่าประจำตัว', () => {
    expect(substitute('{{attr.pet_name}} กินไป {{counter.food}} หน่วย', state))
      .toBe('โมจิ กินไป 62 หน่วย')
  })

  it('ตัวแปรที่ไม่มีค่า กลายเป็นข้อความว่าง ไม่ใช่โผล่วงเล็บให้ผู้ใช้เห็น', () => {
    expect(substitute('สวัสดี {{attr.nickname}}', state)).toBe('สวัสดี ')
  })

  it('ค่าสะสมที่ยังไม่มี นับเป็นศูนย์', () => {
    expect(substitute('{{counter.water}}', state)).toBe('0')
  })

  it('ยอมรับช่องว่างในวงเล็บ', () => {
    expect(substitute('{{ counter.food }}', state)).toBe('62')
  })

  it('รูปแบบที่ไม่รู้จัก ปล่อยไว้เฉยๆ ไม่โยน', () => {
    expect(substitute('{{reward.mug}}', state)).toBe('{{reward.mug}}')
  })

  it('ข้อความที่ไม่มีตัวแปร ผ่านไปเหมือนเดิม', () => {
    expect(substitute('ไม่มีอะไร', state)).toBe('ไม่มีอะไร')
  })
})
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าแดง**

```bash
npx vitest run lib/render/vars.test.ts
```

Expected: FAIL — resolve import ไม่ได้

- [ ] **Step 3: เขียนโค้ด**

`lib/render/vars.ts`

```ts
import type { PlayerState } from '../state'

const PATTERN = /\{\{\s*(counter|attr)\.([a-z0-9_]+)\s*\}\}/gi

/**
 * Fill a card's text with values from the player's own state.
 *
 * Read-only by design (BR-14): no arithmetic, no formatting, no fallbacks
 * expressed in the template. A counter nobody has touched reads as 0 because
 * that is what it is, and an attribute nobody has set reads as empty — showing
 * the raw braces to a player would be worse than showing nothing.
 *
 * A prefix we do not recognise is left alone rather than blanked, so a typo
 * stays visible to whoever is editing the card.
 */
export function substitute(text: string, state: PlayerState): string {
  return text.replace(PATTERN, (_match, kind: string, key: string) => {
    if (kind.toLowerCase() === 'counter') return String(state.counters[key] ?? 0)
    return state.attributes[key] ?? ''
  })
}
```

- [ ] **Step 4: รันเทสต์ให้เขียว**

```bash
npx vitest run lib/render/vars.test.ts
```

Expected: PASS ทั้ง 6 เคส

- [ ] **Step 5: Commit**

```bash
git add lib/render/vars.ts lib/render/vars.test.ts
git commit -m "feat: fill card text with values from the player's own state

Read-only substitution with no arithmetic and no formatting, per BR-14. An
untouched counter reads as zero because that is what it is. An unset attribute
reads as empty rather than leaking raw braces to a player. An unrecognised
prefix is left intact so a typo stays visible to whoever is editing the card."
```

---

### Task 8: `lib/render/flex.ts` — สามกลุ่มเป็น Flex

**Files:**
- Create: `lib/render/flex.ts` · `lib/render/flex.test.ts`
- Modify: `lib/flex/types.ts` (ถ้าชนิดเดิมใช้ต่อได้ให้ใช้ ถ้าไม่ให้เขียนใหม่ในไฟล์นี้)

**Interfaces:**
- Consumes: `Groups`, `CardBlock` จาก `lib/render/groups.ts` · `substitute` จาก `lib/render/vars.ts` · `PlayerState`
- Produces:
  - `type Theme = { primary: string; secondary: string; text: string }`
  - `toFlexBubble(groups: Groups, state: PlayerState, theme: Theme): object`
  - `toFlexCarousel(bubbles: object[]): object`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`lib/render/flex.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { toFlexBubble, toFlexCarousel, type Theme } from './flex'
import { groupBlocks, type CardBlock } from './groups'
import type { PlayerState } from '../state'

const theme: Theme = { primary: '#17756A', secondary: '#EFF3F1', text: '#151F1D' }
const state: PlayerState = {
  attributes: { pet_name: 'โมจิ' }, counters: { food: 50 },
  entitlements: [], playCounts: {}, completed: [],
}

let seq = 0
const block = (o: Partial<CardBlock> & { blockType: CardBlock['blockType'] }): CardBlock => ({
  id: `b${seq++}`, sortOrder: seq, content: null, showWhen: null, options: null, ...o,
})

describe('toFlexBubble', () => {
  it('กลุ่มบนสุดกลายเป็น hero · เนื้อหาเป็น body · ปุ่มท้ายเป็น footer', () => {
    const groups = groupBlocks([
      block({ blockType: 'image', content: 'https://x/a.png', options: { placement: 'full_top' } }),
      block({ blockType: 'title', content: 'หัวข้อ' }),
      block({ blockType: 'button', content: 'กด', options: { action: { type: 'postback', data: 'c=a&a=b&d=2026-08-14' } } }),
    ], state)

    const bubble = toFlexBubble(groups, state, theme) as any
    expect(bubble.type).toBe('bubble')
    expect(bubble.hero.type).toBe('image')
    expect(bubble.body.contents[0].text).toBe('หัวข้อ')
    expect(bubble.footer.contents[0].type).toBe('button')
  })

  it('แทนค่าตัวแปรในข้อความ', () => {
    const groups = groupBlocks([block({ blockType: 'body', content: '{{attr.pet_name}} กิน {{counter.food}}' })], state)
    const bubble = toFlexBubble(groups, state, theme) as any
    expect(bubble.body.contents[0].text).toBe('โมจิ กิน 50')
  })

  it('แถบความคืบหน้าออกมาเป็นสองแท่งซ้อนกัน กว้างตามสัดส่วน', () => {
    const groups = groupBlocks([
      block({ blockType: 'progress_bar', options: { counter: 'food', target: 100 } }),
    ], state)
    const bubble = toFlexBubble(groups, state, theme) as any
    const bar = bubble.body.contents[0]
    expect(bar.type).toBe('box')
    expect(bar.contents[0].width).toBe('50%')
  })

  it('แถบความคืบหน้าเกินเป้า ไม่ล้นเกิน 100%', () => {
    const over: PlayerState = { ...state, counters: { food: 250 } }
    const groups = groupBlocks([
      block({ blockType: 'progress_bar', options: { counter: 'food', target: 100 } }),
    ], over)
    const bubble = toFlexBubble(groups, over, theme) as any
    expect(bubble.body.contents[0].contents[0].width).toBe('100%')
  })

  it('ไม่มีกลุ่มบนสุด ก็ไม่มีช่อง hero เลย', () => {
    const groups = groupBlocks([block({ blockType: 'body', content: 'x' })], state)
    const bubble = toFlexBubble(groups, state, theme) as any
    expect(bubble).not.toHaveProperty('hero')
  })

  it('ไม่มีปุ่มท้าย ก็ไม่มีช่อง footer เลย', () => {
    const groups = groupBlocks([block({ blockType: 'body', content: 'x' })], state)
    expect(toFlexBubble(groups, state, theme)).not.toHaveProperty('footer')
  })

  it('body ต้องมีอย่างน้อยหนึ่งชิ้นเสมอ เพราะ LINE ไม่รับ box ว่าง', () => {
    const groups = groupBlocks([], state)
    const bubble = toFlexBubble(groups, state, theme) as any
    expect(bubble.body.contents.length).toBeGreaterThan(0)
  })
})

describe('toFlexCarousel', () => {
  it('ห่อ bubble หลายใบ', () => {
    const one = toFlexBubble(groupBlocks([block({ blockType: 'body', content: 'a' })], state), state, theme)
    const carousel = toFlexCarousel([one, one]) as any
    expect(carousel.type).toBe('carousel')
    expect(carousel.contents).toHaveLength(2)
  })

  it('เกิน 12 ใบ โยน error เพราะ LINE ไม่รับ', () => {
    const one = toFlexBubble(groupBlocks([block({ blockType: 'body', content: 'a' })], state), state, theme)
    expect(() => toFlexCarousel(Array(13).fill(one))).toThrow(/12/)
  })
})
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าแดง**

```bash
npx vitest run lib/render/flex.test.ts
```

Expected: FAIL — resolve import ไม่ได้

- [ ] **Step 3: เขียนโค้ด**

`lib/render/flex.ts`

```ts
import type { CardBlock, Groups } from './groups'
import { substitute } from './vars'
import type { PlayerState } from '../state'

export type Theme = { primary: string; secondary: string; text: string }

/** LINE renders at most 12 bubbles in a carousel. */
const MAX_BUBBLES = 12

function textComponent(block: CardBlock, state: PlayerState, theme: Theme) {
  const sizes: Record<string, string> = { title: 'lg', body: 'md', caption: 'sm' }
  return {
    type: 'text',
    text: substitute(block.content ?? '', state),
    size: sizes[block.blockType] ?? 'md',
    weight: block.blockType === 'title' ? 'bold' : 'regular',
    color: block.blockType === 'caption' ? theme.secondary : theme.text,
    wrap: true,
  }
}

function progressComponent(block: CardBlock, state: PlayerState, theme: Theme) {
  const counter = String(block.options?.counter ?? '')
  const target = Number(block.options?.target ?? 0)
  const value = state.counters[counter] ?? 0
  // Clamp: a player past the goal still sees a full bar, never a bar that
  // overflows its own track.
  const percent = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0

  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: theme.secondary,
    height: '8px',
    cornerRadius: '4px',
    contents: [
      { type: 'box', layout: 'vertical', contents: [],
        width: `${percent}%`, backgroundColor: theme.primary, height: '8px', cornerRadius: '4px' },
    ],
  }
}

function component(block: CardBlock, state: PlayerState, theme: Theme): object | null {
  switch (block.blockType) {
    case 'image':
      return { type: 'image', url: substitute(block.content ?? '', state), size: 'full', aspectMode: 'cover' }
    case 'title':
    case 'body':
    case 'caption':
      return textComponent(block, state, theme)
    case 'progress_bar':
      return progressComponent(block, state, theme)
    case 'divider':
      return { type: 'separator', margin: 'md' }
    case 'spacer':
      return { type: 'box', layout: 'vertical', contents: [], height: '12px' }
    case 'button':
      return {
        type: 'button',
        style: 'primary',
        color: theme.primary,
        action: { label: substitute(block.content ?? '', state), ...(block.options?.action as object ?? {}) },
      }
  }
}

export function toFlexBubble(groups: Groups, state: PlayerState, theme: Theme): object {
  const body = groups.content
    .map((b) => component(b, state, theme))
    .filter((c): c is object => c !== null)

  // LINE rejects an empty box, and a card with every block hidden is a real
  // state — the author will see it in the preview's state switcher.
  if (body.length === 0) body.push({ type: 'filler' })

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: body },
  }

  const hero = groups.top[0]
  if (hero) bubble.hero = component(hero, state, theme)

  if (groups.footer.length > 0) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: groups.footer.map((b) => component(b, state, theme)).filter(Boolean),
    }
  }

  return bubble
}

export function toFlexCarousel(bubbles: object[]): object {
  if (bubbles.length > MAX_BUBBLES) {
    throw new Error(`carousel has ${bubbles.length} bubbles, over LINE's limit of ${MAX_BUBBLES}`)
  }
  return { type: 'carousel', contents: bubbles }
}
```

- [ ] **Step 4: รันเทสต์ให้เขียว**

```bash
npx vitest run lib/render/flex.test.ts
```

Expected: PASS ทั้ง 9 เคส

- [ ] **Step 5: Commit**

```bash
git add lib/render/flex.ts lib/render/flex.test.ts
git commit -m "feat: turn the three groups into a Flex bubble

The progress bar is the block LINE has no equivalent for, and it is here in the
first slice on purpose — a slice that only does what LINE already does proves
nothing. It clamps at full, so a player past the goal sees a complete bar
rather than one overflowing its track.

An all-hidden card still emits a filler because LINE rejects an empty box, and
every block being hidden is a real state the author can reach in the preview."
```

---

### Task 9: `lib/render/text.ts` — ทางสำรองเป็นข้อความล้วน

**Files:**
- Create: `lib/render/text.ts` · `lib/render/text.test.ts`

**Interfaces:**
- Consumes: `Groups`, `PlayerState`, `substitute`
- Produces: `toPlainText(groups: Groups, state: PlayerState): string`

**ใช้เมื่อไหร่** — `render_as = 'text'` และตอน config พัง (ERR-100 ถึง ERR-104)

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`lib/render/text.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { toPlainText } from './text'
import { groupBlocks, type CardBlock } from './groups'
import type { PlayerState } from '../state'

const state: PlayerState = {
  attributes: {}, counters: { food: 30 }, entitlements: [], playCounts: {}, completed: [],
}
let seq = 0
const block = (o: Partial<CardBlock> & { blockType: CardBlock['blockType'] }): CardBlock => ({
  id: `b${seq++}`, sortOrder: seq, content: null, showWhen: null, options: null, ...o,
})

describe('toPlainText', () => {
  it('ต่อข้อความตามลำดับ บรรทัดละบล็อก', () => {
    const g = groupBlocks([
      block({ blockType: 'title', content: 'หัวข้อ' }),
      block({ blockType: 'body', content: 'เนื้อหา' }),
    ], state)
    expect(toPlainText(g, state)).toBe('หัวข้อ\nเนื้อหา')
  })

  it('แทนค่าตัวแปรเหมือนฝั่ง Flex', () => {
    const g = groupBlocks([block({ blockType: 'body', content: 'กินไป {{counter.food}}' })], state)
    expect(toPlainText(g, state)).toBe('กินไป 30')
  })

  it('ภาพกับเส้นคั่นไม่มีข้อความ จึงถูกข้าม', () => {
    const g = groupBlocks([
      block({ blockType: 'image', content: 'https://x/a.png', options: { placement: 'full_top' } }),
      block({ blockType: 'divider' }),
      block({ blockType: 'body', content: 'เหลือแค่นี้' }),
    ], state)
    expect(toPlainText(g, state)).toBe('เหลือแค่นี้')
  })

  it('ป้ายปุ่มยังอยู่ เพราะเป็นข้อความที่ผู้ใช้ต้องเห็น', () => {
    const g = groupBlocks([
      block({ blockType: 'body', content: 'ข้อความ' }),
      block({ blockType: 'button', content: 'กดเล่น' }),
    ], state)
    expect(toPlainText(g, state)).toContain('กดเล่น')
  })

  it('ไม่มีอะไรเหลือเลย คืนข้อความสำรอง ไม่ใช่สตริงว่าง', () => {
    const g = groupBlocks([block({ blockType: 'divider' })], state)
    expect(toPlainText(g, state).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าแดง**

```bash
npx vitest run lib/render/text.test.ts
```

Expected: FAIL — resolve import ไม่ได้

- [ ] **Step 3: เขียนโค้ด**

`lib/render/text.ts`

```ts
import type { Groups } from './groups'
import { substitute } from './vars'
import type { PlayerState } from '../state'

/** Shown when a card has no text at all. Never return an empty reply (BR-01). */
const NOTHING_TO_SAY = 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่'

/**
 * The fallback shape, used when the card is configured as plain text and when
 * config can no longer be trusted at all.
 *
 * Button labels survive the flattening. They are the only clue left about what
 * the player was meant to do next, and dropping them turns a usable message
 * into a dead end.
 */
export function toPlainText(groups: Groups, state: PlayerState): string {
  const lines = [...groups.top, ...groups.content, ...groups.footer]
    .filter((b) => ['title', 'body', 'caption', 'button'].includes(b.blockType))
    .map((b) => substitute(b.content ?? '', state).trim())
    .filter((line) => line.length > 0)

  return lines.length > 0 ? lines.join('\n') : NOTHING_TO_SAY
}
```

- [ ] **Step 4: รันเทสต์ให้เขียว**

```bash
npx vitest run lib/render/text.test.ts
```

Expected: PASS ทั้ง 5 เคส

- [ ] **Step 5: Commit**

```bash
git add lib/render/text.ts lib/render/text.test.ts
git commit -m "feat: flatten the three groups to plain text as the fallback shape

Used both for text-mode cards and for the moment config can no longer be
trusted. Button labels survive the flattening because they are the only clue
left about what the player was meant to do next. A card that flattens to
nothing still returns something — an empty reply is the silence BR-01 forbids."
```

---

### Task 10: `lib/engine/entry.ts` — เงื่อนไขเข้าเล่น

**Files:**
- Create: `lib/engine/entry.ts` · `lib/engine/entry.test.ts`

**Interfaces:**
- Consumes: `PlayerState`, `Condition`, `evaluate` จาก `lib/state.ts`
- Produces:
  - `type EntryRule = { type: Condition['type'] | 'limit' | 'time_window'; cardId: string; [key: string]: unknown }`
  - `type EntryContext = { state: PlayerState; now: Date; playsThisPeriod: number; campaignStart: Date; campaignEnd: Date }`
  - `checkEntry(rules: EntryRule[], ctx: EntryContext): { allowed: true } | { allowed: false; cardId: string }`

**กติกาที่สำคัญ** — เงื่อนไขเป็น**รายการเรียงลำดับ ทุกข้อมี `cardId` ของตัวเอง** (BR-26) · ข้อแรกที่ไม่ผ่านคือข้อที่ตอบ ไม่ใช่ข้อสุดท้าย

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`lib/engine/entry.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { checkEntry, type EntryContext, type EntryRule } from './entry'
import type { PlayerState } from '../state'

const state: PlayerState = {
  attributes: { pet_type: 'dog' }, counters: {}, entitlements: [],
  playCounts: {}, completed: [],
}
const ctx: EntryContext = {
  state,
  now: new Date('2026-08-14T05:00:00Z'), // 12:00 ที่กรุงเทพ
  playsThisPeriod: 0,
  campaignStart: new Date('2026-08-01T00:00:00Z'),
  campaignEnd: new Date('2026-08-31T00:00:00Z'),
}

describe('checkEntry', () => {
  it('ไม่มีเงื่อนไข = เข้าเล่นได้', () => {
    expect(checkEntry([], ctx)).toEqual({ allowed: true })
  })

  it('ผ่านทุกข้อ = เข้าเล่นได้', () => {
    const rules: EntryRule[] = [{ type: 'has_attribute', key: 'pet_type', cardId: 'c1' }]
    expect(checkEntry(rules, ctx)).toEqual({ allowed: true })
  })

  it('คืนการ์ดของข้อแรกที่ไม่ผ่าน ไม่ใช่ข้อสุดท้าย', () => {
    const rules: EntryRule[] = [
      { type: 'has_entitlement', rewardCode: 'nope', cardId: 'ไม่มีสิทธิ์' },
      { type: 'has_attribute', key: 'missing', cardId: 'ไม่มีค่า' },
    ]
    expect(checkEntry(rules, ctx)).toEqual({ allowed: false, cardId: 'ไม่มีสิทธิ์' })
  })

  it('limit ต่อวัน — เล่นครบแล้วเข้าไม่ได้', () => {
    const rules: EntryRule[] = [{ type: 'limit', count: 1, per: 'day', cardId: 'วันนี้เล่นแล้ว' }]
    expect(checkEntry(rules, { ...ctx, playsThisPeriod: 1 }))
      .toEqual({ allowed: false, cardId: 'วันนี้เล่นแล้ว' })
    expect(checkEntry(rules, { ...ctx, playsThisPeriod: 0 })).toEqual({ allowed: true })
  })

  it('time_window — นอกช่วงวันที่ของแคมเปญเข้าไม่ได้', () => {
    const rules: EntryRule[] = [{ type: 'time_window', cardId: 'ยังไม่เริ่ม' }]
    const before = { ...ctx, now: new Date('2026-07-31T00:00:00Z') }
    expect(checkEntry(rules, before)).toEqual({ allowed: false, cardId: 'ยังไม่เริ่ม' })
  })

  it('time_window — จำกัดชั่วโมงตามเวลาท้องถิ่นของแคมเปญ', () => {
    const rules: EntryRule[] = [
      { type: 'time_window', hoursOfDay: [18, 19, 20], timezone: 'Asia/Bangkok', cardId: 'ยังไม่ถึงเวลา' },
    ]
    // ctx.now คือเที่ยงที่กรุงเทพ จึงอยู่นอกช่วง
    expect(checkEntry(rules, ctx)).toEqual({ allowed: false, cardId: 'ยังไม่ถึงเวลา' })
    const evening = { ...ctx, now: new Date('2026-08-14T12:00:00Z') } // 19:00 ที่กรุงเทพ
    expect(checkEntry(rules, evening)).toEqual({ allowed: true })
  })

  it('เงื่อนไขชนิดที่ไม่รู้จัก ถือว่าไม่ผ่าน ไม่ใช่ปล่อยผ่าน', () => {
    const rules = [{ type: 'wat', cardId: 'กันไว้ก่อน' }] as unknown as EntryRule[]
    expect(checkEntry(rules, ctx)).toEqual({ allowed: false, cardId: 'กันไว้ก่อน' })
  })
})
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าแดง**

```bash
npx vitest run lib/engine/entry.test.ts
```

Expected: FAIL — resolve import ไม่ได้

- [ ] **Step 3: เขียนโค้ด**

`lib/engine/entry.ts`

```ts
import { evaluate, type Condition, type PlayerState } from '../state'

export type EntryRule = { type: string; cardId: string; [key: string]: unknown }

export type EntryContext = {
  state: PlayerState
  now: Date
  /** how many times this player already played this activity this period */
  playsThisPeriod: number
  campaignStart: Date
  campaignEnd: Date
}

export type EntryResult = { allowed: true } | { allowed: false; cardId: string }

function hourIn(tz: string, at: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(at),
  )
}

function passes(rule: EntryRule, ctx: EntryContext): boolean {
  switch (rule.type) {
    case 'limit': {
      const count = Number(rule.count ?? 1)
      return ctx.playsThisPeriod < count
    }
    case 'time_window': {
      if (ctx.now < ctx.campaignStart || ctx.now > ctx.campaignEnd) return false
      const hours = rule.hoursOfDay as number[] | undefined
      if (!hours || hours.length === 0) return true
      const tz = String(rule.timezone ?? 'UTC')
      return hours.includes(hourIn(tz, ctx.now))
    }
    case 'has_attribute':
    case 'not_has_attribute':
    case 'has_entitlement':
    case 'activity_completed':
    case 'activity_not_completed':
    case 'activity_play_count':
      return evaluate(rule as unknown as Condition, ctx.state)
    default:
      // An unknown rule type means config and code disagree. Refusing entry is
      // the safe half of that disagreement: a player sees a card explaining
      // why, instead of quietly receiving a reward the rule meant to block.
      return false
  }
}

/**
 * Walk the rules in order and stop at the first that fails.
 *
 * Order matters because each rule carries its own card (BR-26): the player is
 * told the first reason they cannot play, which is the one they can act on.
 * Reporting the last failure instead would explain a rule they never reached.
 */
export function checkEntry(rules: EntryRule[], ctx: EntryContext): EntryResult {
  for (const rule of rules) {
    if (!passes(rule, ctx)) return { allowed: false, cardId: rule.cardId }
  }
  return { allowed: true }
}
```

- [ ] **Step 4: รันเทสต์ให้เขียว**

```bash
npx vitest run lib/engine/entry.test.ts
```

Expected: PASS ทั้ง 8 เคส

- [ ] **Step 5: Commit**

```bash
git add lib/engine/entry.ts lib/engine/entry.test.ts
git commit -m "feat: check entry rules in order and answer with the first failure

Each rule carries its own card (BR-26), so the player is told the first reason
they cannot play — the one they can act on. Reporting the last failure would
explain a rule they never reached.

An unknown rule type refuses entry rather than passing. When config and code
disagree, the safe half of that disagreement is a card explaining why, not a
reward the rule was written to block."
```

---

### Task 11: `lib/engine/resolve.ts` — ตัดสินผล

**Files:**
- Create: `lib/engine/resolve.ts` · `lib/engine/resolve.test.ts`
- Use: `lib/test-utils/rng.ts` (มีอยู่แล้ว — ตัวสุ่มที่ล็อก seed ได้)

**Interfaces:**
- Consumes: `PlayerState` · `Rng` จาก `lib/test-utils/rng.ts`
- Produces:
  - `type Outcome = { id: string; cardId: string; weight?: number; rewardCode?: string; scoreMin?: number; scoreMax?: number }`
  - `type ResolveMethod = 'fixed' | 'weighted' | 'quota' | 'score'`
  - `resolve(method: ResolveMethod, outcomes: Outcome[], input: { pickedId?: string; score?: number }, rng: () => number): Outcome[]`
  - คืน**รายการเรียงตามลำดับความชอบ** ไม่ใช่ตัวเดียว — SQL จะหยิบตัวแรกที่โควตายังเหลือ

**ทำไมคืนรายการ ไม่ใช่ตัวเดียว** — โควตาอาจหมดระหว่างตัดสินกับเขียน · ส่งรายการไปให้ SQL แล้วให้มันหยิบตัวแรกที่ยังเหลือ จบในรอบเดียวโดยไม่ต้อง retry

- [ ] **Step 1: อ่านตัวสุ่มที่มีอยู่แล้วก่อน**

```bash
cat lib/test-utils/rng.ts
```

ถ้ามี `seededRng(seed: number): () => number` อยู่แล้วให้ใช้ตัวนั้น · ถ้าไม่มีให้เพิ่มฟังก์ชันนี้เข้าไปในไฟล์เดิม

- [ ] **Step 2: เขียนเทสต์ที่ยังไม่ผ่าน**

`lib/engine/resolve.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { resolve, type Outcome } from './resolve'
import { seededRng } from '../test-utils/rng'

const outcomes: Outcome[] = [
  { id: 'a', cardId: 'card-a', weight: 1, rewardCode: 'sticker' },
  { id: 'b', cardId: 'card-b', weight: 99, rewardCode: 'mug' },
]

describe('resolve · fixed', () => {
  it('คืนตัวที่ผู้เล่นกดเป็นตัวแรก', () => {
    const order = resolve('fixed', outcomes, { pickedId: 'a' }, seededRng(1))
    expect(order[0].id).toBe('a')
  })
  it('กดตัวที่ไม่มีอยู่ คืนรายการว่าง', () => {
    expect(resolve('fixed', outcomes, { pickedId: 'zzz' }, seededRng(1))).toEqual([])
  })
})

describe('resolve · weighted', () => {
  it('seed เดิมได้ผลเดิมทุกครั้ง', () => {
    const a = resolve('weighted', outcomes, {}, seededRng(42)).map((o) => o.id)
    const b = resolve('weighted', outcomes, {}, seededRng(42)).map((o) => o.id)
    expect(a).toEqual(b)
  })

  it('น้ำหนักมากถูกหยิบบ่อยกว่าอย่างชัดเจน', () => {
    let bFirst = 0
    for (let seed = 0; seed < 400; seed++) {
      if (resolve('weighted', outcomes, {}, seededRng(seed))[0].id === 'b') bFirst++
    }
    expect(bFirst).toBeGreaterThan(340) // คาดหวังราว 99% ให้ช่วงกว้างไว้กันหลุด
  })

  it('คืนครบทุกตัวเป็นลำดับสำรอง ไม่ใช่ตัวเดียว', () => {
    expect(resolve('weighted', outcomes, {}, seededRng(7))).toHaveLength(2)
  })

  it('น้ำหนักเป็นศูนย์ทั้งหมด ไม่ทำให้พัง', () => {
    const zero: Outcome[] = [{ id: 'x', cardId: 'c', weight: 0 }, { id: 'y', cardId: 'c', weight: 0 }]
    expect(resolve('weighted', zero, {}, seededRng(3))).toHaveLength(2)
  })
})

describe('resolve · score', () => {
  const bands: Outcome[] = [
    { id: 'low', cardId: 'c1', scoreMin: 0, scoreMax: 4 },
    { id: 'high', cardId: 'c2', scoreMin: 5, scoreMax: 10 },
  ]
  it('เลือกช่วงที่คะแนนตกอยู่', () => {
    expect(resolve('score', bands, { score: 7 }, seededRng(1))[0].id).toBe('high')
  })
  it('ขอบของช่วงนับรวม', () => {
    expect(resolve('score', bands, { score: 5 }, seededRng(1))[0].id).toBe('high')
    expect(resolve('score', bands, { score: 4 }, seededRng(1))[0].id).toBe('low')
  })
  it('คะแนนนอกทุกช่วง คืนรายการว่าง ให้ผู้เรียกใช้การ์ดสำรอง', () => {
    expect(resolve('score', bands, { score: 99 }, seededRng(1))).toEqual([])
  })
})

describe('resolve · quota', () => {
  it('เรียงเหมือน weighted — การตัดโควตาจริงเกิดที่ฐานข้อมูล', () => {
    const a = resolve('quota', outcomes, {}, seededRng(11)).map((o) => o.id)
    const b = resolve('weighted', outcomes, {}, seededRng(11)).map((o) => o.id)
    expect(a).toEqual(b)
  })
})
```

- [ ] **Step 3: รันเทสต์ให้เห็นว่าแดง**

```bash
npx vitest run lib/engine/resolve.test.ts
```

Expected: FAIL — resolve import ไม่ได้

- [ ] **Step 4: เขียนโค้ด**

`lib/engine/resolve.ts`

```ts
export type Outcome = {
  id: string
  cardId: string
  /** relative chance, for weighted and quota */
  weight?: number
  /** reward this outcome grants, if any */
  rewardCode?: string
  /** inclusive score band, for score */
  scoreMin?: number
  scoreMax?: number
}

export type ResolveMethod = 'fixed' | 'weighted' | 'quota' | 'score'

export type ResolveInput = { pickedId?: string; score?: number }

/**
 * Draw without replacement, so the whole list comes back ranked rather than a
 * single winner. Quota can run out between deciding and writing, and handing
 * the database a ranked list lets it take the first still-available outcome in
 * the same round trip — no retry, no second decision.
 */
function rank(outcomes: Outcome[], rng: () => number): Outcome[] {
  const pool = outcomes.map((o) => ({ o, w: Math.max(0, o.weight ?? 1) }))
  const ranked: Outcome[] = []

  while (pool.length > 0) {
    const total = pool.reduce((sum, p) => sum + p.w, 0)
    let index = 0

    if (total > 0) {
      let roll = rng() * total
      for (let i = 0; i < pool.length; i++) {
        roll -= pool[i].w
        if (roll <= 0) { index = i; break }
        index = i
      }
    } else {
      // Every weight is zero. Order is arbitrary but must stay deterministic
      // under a fixed seed, so pick by the same roll rather than bailing out.
      index = Math.floor(rng() * pool.length)
    }

    ranked.push(pool[index].o)
    pool.splice(index, 1)
  }

  return ranked
}

export function resolve(
  method: ResolveMethod,
  outcomes: Outcome[],
  input: ResolveInput,
  rng: () => number,
): Outcome[] {
  switch (method) {
    case 'fixed': {
      const picked = outcomes.find((o) => o.id === input.pickedId)
      return picked ? [picked] : []
    }

    case 'weighted':
    case 'quota':
      // Identical here. The difference is not in how the order is drawn but in
      // whether remaining stock filters it, and stock lives in the database.
      return rank(outcomes, rng)

    case 'score': {
      const score = input.score ?? 0
      const band = outcomes.find(
        (o) => score >= (o.scoreMin ?? -Infinity) && score <= (o.scoreMax ?? Infinity),
      )
      return band ? [band] : []
    }
  }
}
```

- [ ] **Step 5: รันเทสต์ให้เขียว**

```bash
npx vitest run lib/engine/resolve.test.ts
```

Expected: PASS ทั้ง 10 เคส

- [ ] **Step 6: Commit**

```bash
git add lib/engine/resolve.ts lib/engine/resolve.test.ts
git commit -m "feat: rank outcomes instead of picking one winner

Quota can run out between deciding and writing. Handing the database a ranked
list lets it take the first outcome whose stock still holds, in the same round
trip — no retry loop and no second decision that could disagree with the first.

Weighted and quota draw identically here. The difference is not in how the
order is produced but in whether remaining stock filters it, and stock lives in
the database where the race can actually be settled."
```

---

### Task 12: `lib/engine/effects.ts` และ `decide.ts`

**Files:**
- Create: `lib/engine/effects.ts` · `lib/engine/effects.test.ts` · `lib/engine/decide.ts` · `lib/engine/decide.test.ts`

**Interfaces:**
- Consumes: `Outcome`, `resolve`, `checkEntry`, `PlayerState`
- Produces:
  - `type Effect = { type: 'set_attribute'; key: string; value: string } | { type: 'add_units'; counterCode: string; amount: number } | { type: 'grant_reward'; rewardCode: string }`
  - `planEffects(spec: EffectSpec[], outcome: Outcome): Effect[]`
  - `type Decision = { kind: 'blocked'; cardId: string } | { kind: 'played'; ranked: Outcome[]; effects: Effect[] }`
  - `decide(input: DecideInput): Decision`

- [ ] **Step 1: เขียนเทสต์ของ effects**

`lib/engine/effects.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { planEffects, type EffectSpec } from './effects'
import type { Outcome } from './resolve'

const outcome: Outcome = { id: 'a', cardId: 'c', rewardCode: 'sticker' }

describe('planEffects', () => {
  it('set_attribute ใช้ค่าคงที่ตามที่ตั้ง', () => {
    const spec: EffectSpec[] = [{ type: 'set_attribute', key: 'pet_type', value: 'dog' }]
    expect(planEffects(spec, outcome)).toEqual([{ type: 'set_attribute', key: 'pet_type', value: 'dog' }])
  })

  it('add_units รับจำนวนจากค่าที่ตั้งไว้', () => {
    const spec: EffectSpec[] = [{ type: 'add_units', counterCode: 'food', amount: 2 }]
    expect(planEffects(spec, outcome)).toEqual([{ type: 'add_units', counterCode: 'food', amount: 2 }])
  })

  it('grant_reward ที่ไม่ระบุรางวัล ใช้รางวัลของผลลัพธ์ที่ออก', () => {
    const spec: EffectSpec[] = [{ type: 'grant_reward' }]
    expect(planEffects(spec, outcome)).toEqual([{ type: 'grant_reward', rewardCode: 'sticker' }])
  })

  it('grant_reward เมื่อผลลัพธ์ไม่มีรางวัล ถูกตัดออก ไม่ใช่แจกของว่าง', () => {
    const spec: EffectSpec[] = [{ type: 'grant_reward' }]
    expect(planEffects(spec, { id: 'b', cardId: 'c' })).toEqual([])
  })

  it('ทำได้หลายอย่างพร้อมกัน และรักษาลำดับ', () => {
    const spec: EffectSpec[] = [
      { type: 'add_units', counterCode: 'food', amount: 1 },
      { type: 'set_attribute', key: 'last', value: 'a' },
    ]
    expect(planEffects(spec, outcome).map((e) => e.type)).toEqual(['add_units', 'set_attribute'])
  })
})
```

- [ ] **Step 2: รันให้แดง แล้วเขียน `effects.ts`**

```bash
npx vitest run lib/engine/effects.test.ts   # FAIL ก่อน
```

`lib/engine/effects.ts`

```ts
import type { Outcome } from './resolve'

export type EffectSpec =
  | { type: 'set_attribute'; key: string; value: string }
  | { type: 'add_units'; counterCode: string; amount: number }
  | { type: 'grant_reward'; rewardCode?: string }

export type Effect =
  | { type: 'set_attribute'; key: string; value: string }
  | { type: 'add_units'; counterCode: string; amount: number }
  | { type: 'grant_reward'; rewardCode: string }

/**
 * Turn what the activity says it does into a concrete list of writes.
 *
 * Nothing here touches storage — the list is data, and the transaction that
 * applies it decides whether it can. A grant that names no reward inherits the
 * one attached to the outcome that came up; if the outcome carries no reward,
 * the grant is dropped rather than issuing an entitlement to nothing.
 */
export function planEffects(spec: EffectSpec[], outcome: Outcome): Effect[] {
  const out: Effect[] = []

  for (const item of spec) {
    if (item.type === 'grant_reward') {
      const rewardCode = item.rewardCode ?? outcome.rewardCode
      if (rewardCode) out.push({ type: 'grant_reward', rewardCode })
      continue
    }
    out.push(item)
  }

  return out
}
```

```bash
npx vitest run lib/engine/effects.test.ts   # PASS
```

- [ ] **Step 3: เขียนเทสต์ของ decide**

`lib/engine/decide.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { decide, type DecideInput } from './decide'
import { seededRng } from '../test-utils/rng'
import type { PlayerState } from '../state'

const state: PlayerState = {
  attributes: {}, counters: {}, entitlements: [], playCounts: {}, completed: [],
}

const base: DecideInput = {
  entryRules: [],
  resolveMethod: 'weighted',
  outcomes: [{ id: 'a', cardId: 'card-a', weight: 1, rewardCode: 'sticker' }],
  effectSpec: [{ type: 'grant_reward' }],
  input: {},
  ctx: {
    state,
    now: new Date('2026-08-14T05:00:00Z'),
    playsThisPeriod: 0,
    campaignStart: new Date('2026-08-01T00:00:00Z'),
    campaignEnd: new Date('2026-08-31T00:00:00Z'),
  },
  rng: seededRng(1),
}

describe('decide', () => {
  it('เข้าเล่นไม่ได้ คืนการ์ดของเงื่อนไขที่กั้น และไม่มี effect', () => {
    const d = decide({
      ...base,
      entryRules: [{ type: 'limit', count: 1, per: 'day', cardId: 'วันนี้เล่นแล้ว' }],
      ctx: { ...base.ctx, playsThisPeriod: 1 },
    })
    expect(d).toEqual({ kind: 'blocked', cardId: 'วันนี้เล่นแล้ว' })
  })

  it('เข้าเล่นได้ คืนรายการผลลัพธ์เรียงลำดับพร้อม effect', () => {
    const d = decide(base)
    expect(d.kind).toBe('played')
    if (d.kind !== 'played') throw new Error('unreachable')
    expect(d.ranked[0].id).toBe('a')
    expect(d.effects).toEqual([{ type: 'grant_reward', rewardCode: 'sticker' }])
  })

  it('ตัดสินไม่ได้เลย ถือว่าไม่ผ่านและใช้การ์ดสำรอง', () => {
    const d = decide({ ...base, resolveMethod: 'score', outcomes: [], input: { score: 5 }, fallbackCardId: 'สำรอง' })
    expect(d).toEqual({ kind: 'blocked', cardId: 'สำรอง' })
  })

  it('effect คำนวณจากผลลัพธ์อันดับหนึ่ง', () => {
    const d = decide({
      ...base,
      outcomes: [
        { id: 'a', cardId: 'c', weight: 0, rewardCode: 'ไม่ควรได้' },
        { id: 'b', cardId: 'c', weight: 100, rewardCode: 'ควรได้' },
      ],
    })
    if (d.kind !== 'played') throw new Error('unreachable')
    expect(d.effects).toEqual([{ type: 'grant_reward', rewardCode: d.ranked[0].rewardCode }])
  })
})
```

- [ ] **Step 4: รันให้แดง แล้วเขียน `decide.ts`**

```bash
npx vitest run lib/engine/decide.test.ts   # FAIL ก่อน
```

`lib/engine/decide.ts`

```ts
import { checkEntry, type EntryContext, type EntryRule } from './entry'
import { planEffects, type Effect, type EffectSpec } from './effects'
import { resolve, type Outcome, type ResolveInput, type ResolveMethod } from './resolve'

export type DecideInput = {
  entryRules: EntryRule[]
  resolveMethod: ResolveMethod
  outcomes: Outcome[]
  effectSpec: EffectSpec[]
  input: ResolveInput
  ctx: EntryContext
  rng: () => number
  /** answer when nothing can be resolved at all (BR-31) */
  fallbackCardId?: string
}

export type Decision =
  | { kind: 'blocked'; cardId: string }
  | { kind: 'played'; ranked: Outcome[]; effects: Effect[] }

/** Last-resort card id when config gives us nothing to say. */
const NO_CARD = ''

/**
 * The whole decision, with no I/O anywhere in it.
 *
 * Effects are planned against the top-ranked outcome. The database may end up
 * taking a lower-ranked one when stock has run out, and it recomputes the
 * reward from whichever it took — this list is the intent, not the record.
 */
export function decide(input: DecideInput): Decision {
  const entry = checkEntry(input.entryRules, input.ctx)
  if (!entry.allowed) return { kind: 'blocked', cardId: entry.cardId }

  const ranked = resolve(input.resolveMethod, input.outcomes, input.input, input.rng)
  if (ranked.length === 0) {
    return { kind: 'blocked', cardId: input.fallbackCardId ?? NO_CARD }
  }

  return { kind: 'played', ranked, effects: planEffects(input.effectSpec, ranked[0]) }
}
```

```bash
npx vitest run lib/engine/decide.test.ts   # PASS
```

- [ ] **Step 5: Commit**

```bash
git add lib/engine/effects.ts lib/engine/effects.test.ts lib/engine/decide.ts lib/engine/decide.test.ts
git commit -m "feat: plan effects and assemble the whole decision

Effects are data, not writes. The transaction that applies them decides whether
it can; planning them here keeps the decision testable without a database.

A grant that names no reward inherits the one attached to the outcome that came
up, and is dropped entirely when that outcome carries none — issuing an
entitlement to nothing would be a row nobody could ever redeem.

decide() plans against the top-ranked outcome. The database may take a
lower-ranked one when stock has run out and recomputes from what it took; this
list is the intent, not the record."
```

---

### Task 13: เทสต์ที่บังคับเส้นแบ่งสถาปัตยกรรม

**Files:**
- Create: `lib/architecture.test.ts`

**Interfaces:**
- Consumes: ไฟล์ทั้งหมดใน `lib/engine/` และ `lib/render/`
- Produces: เทสต์ที่แดงทันทีเมื่อมีใครลาก I/O เข้าไปในแกน

**ทำไมต้องมี** — เส้นแบ่งที่พึ่งความตั้งใจของคนจะหลุดในเดือนที่สอง และหลุดแบบไม่มีใครสังเกต

- [ ] **Step 1: เขียนเทสต์**

`lib/architecture.test.ts`

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PURE_DIRS = ['lib/engine', 'lib/render']

/** Anything on this list can reach the network, the database, or the framework. */
const FORBIDDEN = [
  /from ['"].*\/db\//,
  /from ['"].*line\/client/,
  /from ['"]next\//,
  /from ['"]@supabase\//,
  /from ['"]postgres['"]/,
  /\bfetch\s*\(/,
  /process\.env/,
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) return []
    return [path]
  })
}

describe('the engine and the renderer stay pure', () => {
  for (const dir of PURE_DIRS) {
    for (const file of sourceFiles(dir)) {
      it(`${file} touches nothing outside itself`, () => {
        const source = readFileSync(file, 'utf8')
        const hits = FORBIDDEN.filter((pattern) => pattern.test(source)).map(String)
        expect(hits, `${file} reaches for I/O`).toEqual([])
      })
    }
  }

  it('ยังมีไฟล์ให้ตรวจจริง — กันเคสที่ regex ผ่านเพราะไม่มีไฟล์เลย', () => {
    expect(PURE_DIRS.flatMap(sourceFiles).length).toBeGreaterThan(5)
  })
})
```

- [ ] **Step 2: รันเทสต์ให้เขียว**

```bash
npx vitest run lib/architecture.test.ts
```

Expected: PASS — ทุกไฟล์ใน `engine/` และ `render/` ผ่าน

- [ ] **Step 3: พิสูจน์ว่าเทสต์จับได้จริง**

เพิ่มบรรทัดนี้ชั่วคราวที่บนสุดของ `lib/engine/decide.ts`

```ts
const _ = process.env.NODE_ENV
```

```bash
npx vitest run lib/architecture.test.ts
```

Expected: **FAIL** ที่ `lib/engine/decide.ts` — แล้วลบบรรทัดนั้นทิ้ง รันใหม่ให้เขียว

**ขั้นนี้ห้ามข้าม** — เทสต์ที่ไม่เคยเห็นว่ามันแดง คือเทสต์ที่ยังไม่รู้ว่าทำงานไหม

- [ ] **Step 4: รันเทสต์ทั้งหมด**

```bash
npm test && npm run typecheck
```

Expected: PASS ทั้งหมด

- [ ] **Step 5: Commit**

```bash
git add lib/architecture.test.ts
git commit -m "test: fail the build when the engine or renderer reaches for I/O

The purity of these two directories is what lets the preview and the LINE
adapter share one renderer (BR-91) and what makes the decision logic testable
without a database. A boundary that rests on everyone remembering it will be
gone in a month and nobody will notice the day it goes.

The guard also asserts it found files to check, so it cannot pass by scanning
nothing."
```

---

## Self-Review

**Spec coverage ของแผนนี้ (ขั้น 1–5 ของ spec §11)**

| spec §  | ครอบด้วย task ไหน |
|---|---|
| §3.2 โครงโมดูล | Task 2–12 สร้างครบทุกไฟล์ในกลุ่ม pure |
| §3.3 บังคับเส้นแบ่งด้วยเทสต์ | Task 13 |
| §7.1 บล็อก 8 ชนิด | Task 6 (ชนิด) · Task 8 (การแปลง) |
| §7.2 สามกลุ่ม + BR-92 | Task 6 |
| §7.3 `PlayerState` | Task 5 |
| §10.2 รายการ unit test | Task 2–13 ครบทุกข้อที่ไม่ต้องใช้ DB |
| §11 ขั้น 1 (รื้อ) | Task 1 |
| §11 ขั้น 2 (render) | Task 6–9 |
| §11 ขั้น 3 (engine) | Task 10–12 |

**ที่ยังไม่ครอบและอยู่ในแผนต่อของเอกสารนี้ (Task 14 เป็นต้นไป)** — migration 37 ตาราง ·
`check-schema-vs-doc.mjs` · RPC + เทสต์ยิงพร้อมกัน · `lib/db/*` · webhook wiring ·
snapshot regression ของ Flex JSON · การต่อจริงกับ LINE

> **หมายเหตุถึงคนอ่านแผน** — ไฟล์นี้จบที่ Task 13 โดยตั้งใจ · Task 14–19 ต้องเขียนต่อ
> **หลังจาก Task 1 เสร็จ** เพราะ migration ต้องถอดจากเอกสารทีละตาราง ซึ่งใช้พื้นที่มาก
> และควรทำตอนที่รู้แล้วว่าโครงไฟล์จริงหน้าตาเป็นยังไง · ตอนนี้มีวัตถุดิบครบแล้วที่
> `scratchpad/schema-dump.txt` (37 ตาราง พร้อมคอลัมน์และ constraint)

**Placeholder scan** — ไม่มี TBD/TODO · ทุก step ที่เป็นโค้ดมีโค้ดจริง · ทุกคำสั่งรันได้ตามที่เขียน

**Type consistency** — ตรวจแล้วว่าชื่อตรงกันข้าม task: `PlayerState` (Task 5) ใช้เหมือนกันใน
Task 6 · 7 · 8 · 9 · 10 · 12 · `CardBlock` และ `Groups` (Task 6) ใช้ใน Task 8 · 9 ·
`Outcome` (Task 11) ใช้ใน Task 12 · `EntryContext` (Task 10) ใช้ใน Task 12 ·
`seededRng` มาจาก `lib/test-utils/rng.ts` ที่มีอยู่แล้วในรีโป (Task 11 Step 1 ให้ตรวจก่อนใช้)
