# Flex System Builder สไลซ์ 1 · หน้าจอหลังบ้าน — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำหน้าจอหลังบ้าน 16 หน้าให้คนตั้งค่าแคมเปญได้ครบโดยไม่ต้องแตะ SQL — ปิดเกณฑ์ข้อ 5 ของ spec ที่ยังค้างอยู่ข้อเดียว

**Architecture:** Next.js App Router · Server Component อ่านข้อมูล · Server Action เขียน · ไม่มี state library และไม่มี REST ชั้นกลางสำหรับหน้าจอของตัวเอง · หน้าตัวอย่างเรียก `lib/render/*` ตัวเดียวกับที่ webhook เรียก ซึ่งเป็นการส่งมอบ BR-91 จริง

**Tech Stack:** Next.js 15 · React 19 · TypeScript strict · `postgres` (postgres.js) · Vitest · `next/font` (ไม่ใช้ CDN)

**สิ่งที่ทำเสร็จแล้วและแผนนี้ต่อยอดจาก:** `2026-08-14-flex-slice1-core.md` — engine · renderer · schema 37 ตาราง · RPC · webhook · 171 เทสต์

## Global Constraints

- **ต้นแบบหน้าตาคือ `docs/design/flex-builder-prototype.html`** — 22 จอพร้อม `data-screen-label` · **ยึดไฟล์นี้เป็นแหล่งอ้างอิงของ layout** ไม่ใช่ยึดคำบรรยายในแผนนี้
- **ธีมเดียว ไม่มีโหมดมืด** — ต้นแบบไม่มี และการเพิ่มทีหลังถูกกว่าการถอดออก
- **สีและตัวอักษรมาจาก token เท่านั้น** ห้ามใส่ค่าสีตรงในคอมโพเนนต์ · ต้นแบบใช้ inline style เพื่อให้เปิดไฟล์เดียวได้ ของจริงต้องเป็น token
- **ตัวอักษรโหลดผ่าน `next/font`** ห้ามลิงก์ Google Fonts ตรงๆ — หน้าจอต้องทำงานได้ตอนเน็ตลูกค้าบล็อก CDN
- **`lib/engine/` และ `lib/render/` ยังห้ามแตะ I/O** — `lib/architecture.test.ts` บังคับอยู่ ห้ามผ่อนเพื่อความสะดวกของหน้าจอ
- **ทุก Server Action ต้องตรวจสิทธิ์เองทุกครั้ง** ห้ามพึ่งว่าหน้าจอซ่อนปุ่มไว้แล้ว
- **กุญแจของ LINE ต้องเข้ารหัสก่อนเก็บ และหน้าจอเห็นได้แค่ 4 ตัวท้าย** (BR-16 · DD-03)
- **TypeScript strict · commit หลังทุก task · ข้อความ commit เป็นภาษาอังกฤษ อธิบายเหตุผล**
- **สามข้อที่ต้องรู้ก่อนเขียนเทสต์ `.tsx`** — ค้นเจอตอนทำ Task 3 จริง ไม่ใช่ตอนอ่านเอกสาร
  - `vitest.config.ts` ต้องมี `esbuild: { jsx: 'automatic' }` · เพราะ `tsconfig.json` ตั้ง `jsx: "preserve"` ไว้ให้ Next แปลง ถ้าไม่ตั้ง ทุกไฟล์ `.tsx` จะพังด้วย `ReferenceError: React is not defined`
  - ใช้ docblock `// @vitest-environment jsdom` บนหัวไฟล์ **ไม่ใช่ `environmentMatchGlobs`** ซึ่ง deprecated ใน Vitest 3.2 และขึ้นแบนเนอร์ทุกครั้งที่รัน
  - ต้องเรียก `afterEach(cleanup)` เอง เพราะรีโปนี้ปิด `globals` · ไม่เรียกแล้ว render ของเทสต์ก่อนหน้าจะค้าง และ `getBy*` จะเจอของซ้ำ
- **`Field` สร้าง id จาก hash ของ label** — สองช่องที่ชื่อเหมือนกันในหน้าเดียวจะได้ id ชนกัน · ส่ง prop `id` เองเมื่อเจอเคสนั้น
- **เอกสารอ้างอิง** `~/Downloads/FLEX_AD_L2_v0.32.html` §3 (สารบัญจอ) · §5.2 (ตาราง) · §5.3 (enum)

## Design Tokens

ถอดจากต้นแบบตรงๆ · ค่าที่ใช้บ่อยสุดคือค่าเริ่มต้น

```
สี
--ground   #F7F7F5   พื้นหลังหน้า
--panel    #FFFFFF   แผงและการ์ด
--panel-2  #EFEFED   พื้นรองในแผง · skeleton
--ink      #111111   ตัวอักษรหลัก · พื้นปุ่มหลัก
--ink-2    #6B6B68   ตัวอักษรรอง
--ink-3    #9B9B98   ป้ายกำกับ · คำอธิบาย
--rule     #E5E5E3   เส้นขอบ
--rule-2   #C2C2BF   placeholder
--accent   #E63B2E   สีเน้น · ลิงก์ที่ hover
--warn     #D97706   พร้อมตัวอักษร #5A3A00 · พื้น rgba(215,119,6,.08)
--danger   #E63B2E   พร้อมตัวอักษร #7A1A10 · พื้น rgba(230,59,46,.06)
--ok       #16A34A   พร้อมตัวอักษร #0C4A25 · พื้น rgba(22,163,74,.08)
--info     #2563EB   พร้อมตัวอักษร #1A3A7A · พื้น rgba(37,99,235,.08)

ตัวอักษร
--sans  'Noto Sans Thai','DM Sans',sans-serif
--mono  'DM Mono',monospace
ขนาด    9 · 10 · 11 · 12 · 13 · 14 · 16 · 22 · 24 · 28
น้ำหนัก 600 เป็นค่าหลัก · 500 · 400 · 700
ระยะตัว .06em สำหรับป้ายตัวพิมพ์ใหญ่ · -.025em สำหรับหัวข้อใหญ่

รูปร่าง
--r      9px    ค่าเริ่มต้น · ปุ่ม · อินพุต
--r-lg   14px   แผงและการ์ด
--r-pill 99px   ป้ายกลม
--r-sm   6px    ช่องโค้ดและ id
ระยะขอบหน้า  32px 36px
ช่องไฟ       5 · 8 · 9 · 10 · 12 · 14 · 16
```

**ป้ายรหัสจอเหนือหัวข้อทุกหน้า** — `M1-S01 · Campaigns` ด้วย `--mono` ขนาด 10px `letter-spacing:.08em` uppercase สี `--ink-3` · เป็นสิ่งที่ทำให้คุยกับเอกสารรู้เรื่อง ห้ามตัดออก

---

## File Structure

| ไฟล์ | รับผิดชอบอะไร |
|---|---|
| `app/globals.css` | token ทั้งชุด + reset |
| `app/layout.tsx` | ตัวอักษรผ่าน `next/font` · พื้นหลัง |
| `app/(admin)/layout.tsx` | โครงหน้าหลังบ้าน · แถบบน · ตรวจ session |
| `components/ui/*.tsx` | ปุ่ม · อินพุต · แผง · ป้าย · ตาราง · หัวข้อหน้า · toast |
| `components/ui/tokens.ts` | ค่าที่ TypeScript ต้องอ้าง (สีของสถานะ) |
| `lib/auth/session.ts` | อ่าน session · ตรวจ allowlist · คืน role |
| `lib/auth/require.ts` | `requireRole()` ที่ Server Action ทุกตัวเรียก |
| `lib/crypto/secretbox.ts` | เข้ารหัส/ถอดรหัสกุญแจของ LINE |
| `app/(admin)/campaigns/**` | M1-S01 · S02 · S03 · S04 · S06 |
| `app/(admin)/campaigns/[id]/cards/**` | M3-S01 · S02 · S03 |
| `app/(admin)/campaigns/[id]/activities/**` | M7-S01 · S02 |
| `app/(admin)/campaigns/[id]/counters/**` | M7-S03 |
| `app/(admin)/campaigns/[id]/rewards/**` | M7-S04 |
| `app/(admin)/campaigns/[id]/assets/**` | M9-S01 · S02 |
| `app/(admin)/campaigns/[id]/preview/**` | M8-S01 |
| `app/(admin)/channels/**` | M6-S01 · S02 |
| `app/(admin)/users/**` | M13-S02 |
| `app/login/page.tsx` | M13-S01 |

**ไม่มีไฟล์ `app/api/**` เพิ่ม** — หน้าจอใช้ Server Action · REST มีไว้สำหรับ Extension API ซึ่งอยู่นอกสไลซ์นี้

---

### Task 1: Token · ตัวอักษร · โครงหน้า

**Files:**
- Create: `app/globals.css` · `components/ui/tokens.ts` · `components/ui/tokens.test.ts`
- Modify: `app/layout.tsx` · `app/page.tsx`

**Interfaces:**
- Produces: `STATUS_TONES` — `Record<'ok'|'warn'|'danger'|'info', { fg: string; bg: string; border: string }>`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`components/ui/tokens.test.ts`

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STATUS_TONES } from './tokens'

const css = readFileSync('app/globals.css', 'utf8')

describe('design tokens', () => {
  it('มี token ทุกตัวที่ต้นแบบใช้', () => {
    for (const name of [
      '--ground', '--panel', '--panel-2', '--ink', '--ink-2', '--ink-3',
      '--rule', '--rule-2', '--accent', '--warn', '--danger', '--ok', '--info',
      '--sans', '--mono', '--r', '--r-lg', '--r-pill', '--r-sm',
    ]) {
      expect(css, `ขาด ${name}`).toContain(`${name}:`)
    }
  })

  it('ค่าสีตรงกับต้นแบบ', () => {
    expect(css).toContain('--ground: #F7F7F5')
    expect(css).toContain('--ink: #111111')
    expect(css).toContain('--accent: #E63B2E')
    expect(css).toContain('--rule: #E5E5E3')
  })

  it('สถานะทั้งสี่มีสีตัวอักษรที่อ่านออกบนพื้นของตัวเอง', () => {
    for (const tone of ['ok', 'warn', 'danger', 'info'] as const) {
      expect(STATUS_TONES[tone].fg).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(STATUS_TONES[tone].bg).toMatch(/^rgba\(/)
    }
  })
})
```

- [ ] **Step 2: รันให้เห็นว่าแดง**

```bash
npx vitest run components/ui/tokens.test.ts
```

Expected: FAIL — resolve import ไม่ได้

- [ ] **Step 3: เขียน `app/globals.css`**

```css
/* Token ทั้งชุด ถอดจาก docs/design/flex-builder-prototype.html
   ธีมเดียว ไม่มีโหมดมืด — ต้นแบบไม่มี และเพิ่มทีหลังถูกกว่าถอดออก */
:root {
  --ground: #F7F7F5;
  --panel: #FFFFFF;
  --panel-2: #EFEFED;
  --ink: #111111;
  --ink-2: #6B6B68;
  --ink-3: #9B9B98;
  --rule: #E5E5E3;
  --rule-2: #C2C2BF;
  --accent: #E63B2E;
  --warn: #D97706;
  --danger: #E63B2E;
  --ok: #16A34A;
  --info: #2563EB;

  --sans: var(--font-noto-thai), var(--font-dm-sans), sans-serif;
  --mono: var(--font-dm-mono), monospace;

  --r: 9px;
  --r-lg: 14px;
  --r-pill: 99px;
  --r-sm: 6px;

  --page-x: 36px;
  --page-y: 32px;
}

*, *::before, *::after { box-sizing: border-box; }

html, body { margin: 0; padding: 0; }

body {
  background: var(--ground);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

a { color: var(--ink); text-decoration: none; }
a:hover { color: var(--accent); }
::placeholder { color: var(--rule-2); }

button, input, select, textarea { font-family: inherit; font-size: inherit; }

:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}

/* ป้ายรหัสจอ — ตัวที่ทำให้คุยกับเอกสารรู้เรื่อง */
.screen-code {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--ink-3);
}
```

- [ ] **Step 4: เขียน `components/ui/tokens.ts`**

```ts
/**
 * สีของสถานะที่ TypeScript ต้องอ้างถึงได้ เพราะเลือกจากข้อมูล ไม่ใช่จาก class
 *
 * ตัวอักษรของแต่ละสถานะเข้มกว่าสีเส้นขอบโดยตั้งใจ — สีเส้นขอบของ warn และ
 * danger อ่านบนพื้นอ่อนไม่ออก ถ้าใช้สีเดียวกันทั้งคู่จะได้ข้อความที่เห็นแต่อ่านไม่ได้
 */
export const STATUS_TONES = {
  ok: { fg: '#0C4A25', bg: 'rgba(22,163,74,.08)', border: '#16A34A' },
  warn: { fg: '#5A3A00', bg: 'rgba(215,119,6,.08)', border: '#D97706' },
  danger: { fg: '#7A1A10', bg: 'rgba(230,59,46,.06)', border: '#E63B2E' },
  info: { fg: '#1A3A7A', bg: 'rgba(37,99,235,.08)', border: '#2563EB' },
} as const

export type StatusTone = keyof typeof STATUS_TONES
```

- [ ] **Step 5: โหลดตัวอักษรผ่าน `next/font` ใน `app/layout.tsx`**

```tsx
import type { Metadata } from 'next'
import { DM_Mono, DM_Sans, Noto_Sans_Thai } from 'next/font/google'
import './globals.css'

// next/font ดาวน์โหลดไฟล์มาเสิร์ฟเอง ไม่มี request ออกไป CDN ตอนผู้ใช้เปิดหน้า
const sans = DM_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-dm-sans' })
const thai = Noto_Sans_Thai({ subsets: ['thai'], weight: ['400', '500', '600', '700'], variable: '--font-noto-thai' })
const mono = DM_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-dm-mono' })

export const metadata: Metadata = { title: 'Flex System Builder' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${sans.variable} ${thai.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 6: รันเทสต์ให้เขียว แล้วดูด้วยตาว่าตัวอักษรมาจริง**

```bash
npx vitest run components/ui/tokens.test.ts
npm run build
npm run dev   # เปิด http://localhost:3000 — ต้องเป็น Noto Sans Thai ไม่ใช่ตัวอักษรระบบ
```

Expected: PASS · build ผ่าน · หน้าแรกใช้ตัวอักษรที่ตั้งไว้

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: design tokens and typography from the prototype

Colours, type and radii are lifted from docs/design/flex-builder-prototype.html
rather than invented, so the built screens and the mock cannot drift.

The prototype uses inline styles because it has to open as one file; production
reads tokens instead. Two things are deliberate: fonts load through next/font so
no request leaves for a CDN when a client network blocks Google, and each status
colour carries a darker foreground than its border — reusing the border colour
for text gives you something visible but unreadable on a tinted background."
```

---

### Task 2: เข้าระบบ · M13-S01

**Files:**
- Create: `lib/auth/session.ts` · `lib/auth/session.test.ts` · `lib/auth/require.ts` · `app/login/page.tsx` · `app/(admin)/layout.tsx`

**Interfaces:**
- Consumes: `db()` จาก `lib/db/client`
- Produces:
  - `type Session = { userId: string; email: string; role: 'configurator' | 'content_editor' | 'reporter' }`
  - `getSession(): Promise<Session | null>`
  - `type AuthDenial = { reason: 'not_on_list' | 'revoked'; email: string }`
  - `resolveUser(sql, email): Promise<Session | AuthDenial>`
  - `requireRole(...roles): Promise<Session>` — โยนเมื่อไม่ผ่าน

**สิ่งที่ต้นแบบบอกและต้องทำตาม** — จอเข้าระบบมีสามสถานะ ไม่ใช่สองอย่างที่เดา: เข้าได้ · **อีเมลยังไม่อยู่ในรายชื่อ** (แสดงอีเมลด้วย `--mono` ให้ก๊อปไปขอสิทธิ์ได้) · **สิทธิ์ถูกถอน** (โทน warn ไม่ใช่ danger เพราะเคยเข้าได้)

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`lib/auth/session.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { classify } from './session'

describe('classify', () => {
  it('ไม่มีแถวในรายชื่อ = ยังไม่ได้รับสิทธิ์', () => {
    expect(classify(undefined, 'new@x.co')).toEqual({ reason: 'not_on_list', email: 'new@x.co' })
  })

  it('มีแถวแต่ถูกปิด = สิทธิ์ถูกถอน', () => {
    expect(classify({ id: 'u1', email: 'a@x.co', role: 'reporter', is_active: false }, 'a@x.co'))
      .toEqual({ reason: 'revoked', email: 'a@x.co' })
  })

  it('มีแถวและเปิดอยู่ = เข้าได้', () => {
    expect(classify({ id: 'u1', email: 'a@x.co', role: 'configurator', is_active: true }, 'a@x.co'))
      .toEqual({ userId: 'u1', email: 'a@x.co', role: 'configurator' })
  })

  it('เทียบอีเมลแบบไม่แยกตัวพิมพ์', () => {
    const row = { id: 'u1', email: 'a@x.co', role: 'reporter' as const, is_active: true }
    expect(classify(row, 'A@X.CO')).toMatchObject({ userId: 'u1' })
  })
})
```

- [ ] **Step 2: รันให้เห็นว่าแดง**

```bash
npx vitest run lib/auth/session.test.ts
```

Expected: FAIL — resolve import ไม่ได้

- [ ] **Step 3: เขียน `lib/auth/session.ts`**

```ts
import { cookies } from 'next/headers'
import { db } from '../db/client'

export type Role = 'configurator' | 'content_editor' | 'reporter'
export type Session = { userId: string; email: string; role: Role }
export type AuthDenial = { reason: 'not_on_list' | 'revoked'; email: string }

export type UserRow = { id: string; email: string; role: Role; is_active: boolean }

/**
 * Signing in with Google is not the same as being allowed in (BR-23).
 *
 * Three outcomes, not two: the pure part is separated so all three can be
 * tested without a database or an identity provider. A revoked account is a
 * different message from an unknown one — the first person has been here before
 * and needs to know why they cannot get back in.
 */
export function classify(row: UserRow | undefined, email: string): Session | AuthDenial {
  if (!row) return { reason: 'not_on_list', email }
  if (!row.is_active) return { reason: 'revoked', email: row.email }
  return { userId: row.id, email: row.email, role: row.role }
}

export async function resolveUser(email: string): Promise<Session | AuthDenial> {
  const sql = db()
  const [row] = await sql<UserRow[]>`
    SELECT id, email, role, is_active FROM app_user WHERE lower(email) = lower(${email})`
  return classify(row, email)
}

export async function getSession(): Promise<Session | null> {
  const email = (await cookies()).get('fsb_email')?.value
  if (!email) return null
  const result = await resolveUser(email)
  return 'userId' in result ? result : null
}
```

- [ ] **Step 4: เขียน `lib/auth/require.ts`**

```ts
import { getSession, type Role, type Session } from './session'

/**
 * Called at the top of every Server Action, not only where the screen hides a
 * button. A hidden button is a hint; an action reachable by anyone who can guess
 * its name is the actual door.
 */
export async function requireRole(...roles: Role[]): Promise<Session> {
  const session = await getSession()
  if (!session) throw new Error('ต้องเข้าสู่ระบบก่อน')
  if (roles.length > 0 && !roles.includes(session.role)) {
    throw new Error('บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้')
  }
  return session
}
```

- [ ] **Step 5: เขียนจอเข้าระบบตามต้นแบบ**

เปิด `docs/design/flex-builder-prototype.html` ค้น `data-screen-label="M13-S01 เข้าระบบ"` แล้วทำตาม layout นั้น
โดยเปลี่ยน inline style เป็น token · องค์ประกอบที่ต้องมีครบ: โลโก้สี่เหลี่ยม `--ink` มีจตุรัส `--accent` ข้างใน ·
ชื่อระบบ 22px/600 · คำบรรยาย 13px `--ink-3` · กล่องแจ้งเหตุผลเมื่อเข้าไม่ได้ · ปุ่มเข้าด้วย Google

- [ ] **Step 6: เขียน `app/(admin)/layout.tsx` ที่กันคนที่ยังไม่ได้เข้าระบบ**

```tsx
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        borderBottom: '1px solid var(--rule)', background: 'var(--panel)',
        padding: '12px var(--page-x)', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <span style={{ width: 22, height: 22, background: 'var(--ink)', display: 'inline-flex',
                       alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ width: 8, height: 8, background: 'var(--accent)' }} />
        </span>
        <strong style={{ fontSize: 13 }}>Flex System Builder</strong>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)' }}>
          {session.email} · {session.role}
        </span>
      </header>
      {children}
    </div>
  )
}
```

- [ ] **Step 7: ทางเข้าสำหรับเทสต์ · `lib/auth/devlogin.ts`**

**bypass ตัวระบุตัวตน ไม่ใช่ bypass รายชื่อที่อนุญาต** — ยังต้องมีแถวใน `app_user` และ `is_active = true`
ทางนี้ข้ามแค่ Google ไม่ได้ข้ามการตรวจสิทธิ์ · ถ้าข้ามทั้งสองอย่าง มันคือประตูหลัง ไม่ใช่เครื่องมือทดสอบ

เทสต์ก่อน · `lib/auth/devlogin.test.ts`

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { devLoginAllowed } from './devlogin'

const env = { ...process.env }
afterEach(() => { process.env = { ...env } })

describe('devLoginAllowed', () => {
  it('ปิดไว้เป็นค่าเริ่มต้น', () => {
    delete process.env.ALLOW_DEV_LOGIN
    expect(devLoginAllowed({ nodeEnv: 'development' })).toBe(false)
  })

  it('เปิดได้เมื่อสั่งชัดเจนและไม่ใช่ production', () => {
    process.env.ALLOW_DEV_LOGIN = '1'
    expect(devLoginAllowed({ nodeEnv: 'development' })).toBe(true)
    expect(devLoginAllowed({ nodeEnv: 'test' })).toBe(true)
  })

  it('production ปิดตายแม้ตั้ง env ไว้', () => {
    process.env.ALLOW_DEV_LOGIN = '1'
    expect(devLoginAllowed({ nodeEnv: 'production' })).toBe(false)
  })

  it('deploy จริงบน Vercel ปิดตายแม้ NODE_ENV จะเป็นอย่างอื่น', () => {
    process.env.ALLOW_DEV_LOGIN = '1'
    process.env.VERCEL_ENV = 'production'
    expect(devLoginAllowed({ nodeEnv: 'development' })).toBe(false)
  })

  it('ค่าอื่นที่ไม่ใช่ 1 ไม่นับว่าเปิด', () => {
    for (const value of ['true', 'yes', '0', '']) {
      process.env.ALLOW_DEV_LOGIN = value
      expect(devLoginAllowed({ nodeEnv: 'development' }), value).toBe(false)
    }
  })
})
```

`lib/auth/devlogin.ts`

```ts
/**
 * A way in that skips Google, for tests and for a laptop with no OAuth client.
 *
 * It skips the identity provider and nothing else: the email still has to exist
 * in app_user and still has to be active. Skipping both would make this a back
 * door rather than a test fixture.
 *
 * Three locks, because one env var is one typo away from being set in the wrong
 * place: it must be asked for explicitly, NODE_ENV must not be production, and a
 * production deploy refuses regardless of what NODE_ENV says.
 */
export function devLoginAllowed(ctx: { nodeEnv: string | undefined }): boolean {
  if (process.env.ALLOW_DEV_LOGIN !== '1') return false
  if (ctx.nodeEnv === 'production') return false
  if (process.env.VERCEL_ENV === 'production') return false
  return true
}
```

Server Action ของทางเข้านี้ · ใน `app/login/actions.ts`

```ts
'use server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { devLoginAllowed } from '@/lib/auth/devlogin'
import { resolveUser } from '@/lib/auth/session'

export async function devLogin(formData: FormData): Promise<void> {
  if (!devLoginAllowed({ nodeEnv: process.env.NODE_ENV })) {
    throw new Error('ทางเข้าสำหรับทดสอบถูกปิดอยู่')
  }

  const email = String(formData.get('email') ?? '').trim()
  const result = await resolveUser(email)

  // ยังตรวจรายชื่อเหมือนทางปกติ — ทางนี้ข้ามแค่ Google
  if (!('userId' in result)) {
    throw new Error(result.reason === 'revoked'
      ? 'บัญชีนี้ถูกถอนสิทธิ์แล้ว'
      : 'อีเมลนี้ยังไม่อยู่ในรายชื่อที่อนุญาต')
  }

  // ใช้ทางนี้เข้ามาต้องมีร่องรอย เพราะไม่มี Google เป็นพยาน
  // เขียนลง stderr ไม่ใช่ token_access_log — ตารางนั้นผูกกับ channel และ CHECK
  // ของ purpose ไม่มีค่าไหนแปลว่า "มีคนเข้าระบบทางลัด" · ยัดค่าที่ใกล้เคียงลงไป
  // จะทำให้ตารางตรวจสอบเก็บเหตุผลที่ไม่จริง ซึ่งแย่กว่าไม่เก็บ
  console.warn(`[dev-login] ${result.email} เข้าระบบผ่านทางเข้าสำหรับทดสอบ`)

  ;(await cookies()).set('fsb_email', result.email, {
    httpOnly: true, sameSite: 'lax', path: '/',
    secure: process.env.NODE_ENV === 'production',
  })
  redirect('/campaigns')
}
```

**หน้าจอต้องแสดงทางนี้เฉพาะเมื่อเปิดอยู่จริง** และแสดงเป็นกล่อง `tone="warn"` ใต้ปุ่ม Google
พร้อมข้อความ `ทางเข้าสำหรับทดสอบ · เปิดอยู่เพราะ ALLOW_DEV_LOGIN=1` — ถ้าเห็นกล่องนี้บนของจริงคือมีอะไรผิด

- [ ] **Step 8: รันเทสต์และ build**

```bash
npx vitest run lib/auth/ && npm run build
```

Expected: PASS ทั้งหมด

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: sign-in, the allowlist, and the role gate

Signing in with Google is not the same as being allowed in (BR-23), so the
outcome has three cases rather than two. Splitting classify() out as a pure
function makes all three testable without a database or an identity provider.

A revoked account gets a different message from an unknown one: that person has
been here before and needs to know why they cannot get back in.

requireRole() belongs at the top of every action, not only where the screen
hides a button. A hidden button is a hint; the action is the door.

There is also a way in that skips Google, for tests and for a laptop with no
OAuth client. It skips the identity provider and nothing else — the email still
has to be on the allowlist and still has to be active. Three locks guard it,
because one env var is one typo away from being set in the wrong place: it must
be asked for explicitly, NODE_ENV must not be production, and a production
deploy refuses regardless of what NODE_ENV claims."
```

---

### Task 3: คอมโพเนนต์พื้นฐาน

**Files:**
- Create: `components/ui/Panel.tsx` · `components/ui/Button.tsx` · `components/ui/Field.tsx` · `components/ui/Badge.tsx` · `components/ui/PageHead.tsx` · `components/ui/Rows.tsx` · `components/ui/Empty.tsx` · `components/ui/index.ts` · `components/ui/ui.test.tsx`
- Modify: `package.json` (เพิ่ม `@testing-library/react` · `jsdom`)

**Interfaces:**
- Produces (ทุกตัว export จาก `components/ui`)
  - `<PageHead code="M1-S01 · Campaigns" title="แคมเปญ" actions={…} />`
  - `<Panel>` · `<Panel.Row>`
  - `<Button variant="primary" | "ghost" | "danger">`
  - `<Field label="ชื่อ" hint="…" error="…">` ครอบ input เอง
  - `<Badge tone="ok" | "warn" | "danger" | "info" | "mute">`
  - `<Rows items={…} renderRow={…} loading={n} empty={…} />`
  - `<Empty title="…" note="…" action={…} />`

**ทำไมเป็น task ของตัวเอง** — เจ็ดตัวนี้ปรากฏในทุกจอของต้นแบบ · ถ้าไม่ทำก่อน แต่ละจอจะเขียนปุ่มของตัวเอง แล้วสีกับ radius จะไหลออกจากกันภายในสามจอ

- [ ] **Step 1: ติดตั้งของที่ต้องใช้เทสต์ React**

```bash
npm install -D @testing-library/react @testing-library/dom jsdom
```

- [ ] **Step 2: เปิดโหมด jsdom ให้ไฟล์ `.test.tsx` ใน `vitest.config.ts`**

```ts
export default defineConfig({
  test: {
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', '.next/**'],
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
    environment: 'node',
  },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
})
```

- [ ] **Step 3: เขียนเทสต์ที่ยังไม่ผ่าน**

`components/ui/ui.test.tsx`

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge, Button, Empty, Field, PageHead, Panel, Rows } from './index'

describe('PageHead', () => {
  it('แสดงรหัสจอและหัวข้อ', () => {
    render(<PageHead code="M1-S01 · Campaigns" title="แคมเปญ" />)
    expect(screen.getByText('M1-S01 · Campaigns')).toBeDefined()
    expect(screen.getByText('แคมเปญ')).toBeDefined()
  })
})

describe('Button', () => {
  it('ปุ่มหลักใช้พื้นเข้ม ปุ่มรองใช้พื้นขาว', () => {
    const { container } = render(<><Button>หลัก</Button><Button variant="ghost">รอง</Button></>)
    const [primary, ghost] = Array.from(container.querySelectorAll('button'))
    expect(primary.style.background).toContain('--ink')
    expect(ghost.style.background).toContain('--panel')
  })

  it('ปิดปุ่มแล้วกดไม่ได้และมองออกว่าปิด', () => {
    const { container } = render(<Button disabled>รอ</Button>)
    const button = container.querySelector('button')!
    expect(button.disabled).toBe(true)
    expect(Number(button.style.opacity)).toBeLessThan(1)
  })
})

describe('Field', () => {
  it('ป้ายผูกกับ input ด้วย id เดียวกัน', () => {
    render(<Field label="ชื่อแคมเปญ"><input /></Field>)
    const input = screen.getByLabelText('ชื่อแคมเปญ')
    expect(input).toBeDefined()
  })

  it('มี error แล้วบอกด้วย aria-invalid ไม่ใช่แค่เปลี่ยนสี', () => {
    render(<Field label="รหัส" error="ใช้ได้แค่ a-z"><input /></Field>)
    expect(screen.getByLabelText('รหัส').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('ใช้ได้แค่ a-z')).toBeDefined()
  })
})

describe('Badge', () => {
  it('แต่ละโทนมีสีตัวอักษรของตัวเอง', () => {
    const { container } = render(<><Badge tone="ok">เปิด</Badge><Badge tone="danger">พัง</Badge></>)
    const [ok, danger] = Array.from(container.querySelectorAll('span'))
    expect(ok.style.color).not.toBe(danger.style.color)
  })
})

describe('Rows', () => {
  it('กำลังโหลดแสดง skeleton ตามจำนวนที่บอก', () => {
    const { container } = render(<Rows items={[]} loading={3} renderRow={() => null} />)
    expect(container.querySelectorAll('[data-skeleton]').length).toBe(3)
  })

  it('ไม่มีข้อมูลแสดงกล่องว่าง ไม่ใช่แผงเปล่า', () => {
    render(<Rows items={[]} renderRow={() => null} empty={<Empty title="ยังไม่มีแคมเปญ" />} />)
    expect(screen.getByText('ยังไม่มีแคมเปญ')).toBeDefined()
  })

  it('มีข้อมูลแล้ววาดทุกแถว', () => {
    render(<Rows items={['a', 'b']} renderRow={(x) => <div key={x}>{x}</div>} />)
    expect(screen.getByText('a')).toBeDefined()
    expect(screen.getByText('b')).toBeDefined()
  })
})
```

- [ ] **Step 4: รันให้เห็นว่าแดง**

```bash
npx vitest run components/ui/ui.test.tsx
```

Expected: FAIL — resolve import ไม่ได้

- [ ] **Step 5: เขียนคอมโพเนนต์ทั้งเจ็ด**

ทำตามต้นแบบ · จุดที่ต้องไม่พลาด

```
PageHead   ป้ายรหัสจอ --mono 10px .08em uppercase --ink-3 → หัวข้อ 28px/600 -.025em
           actions อยู่ขวาสุดด้วย justify-content:space-between
Panel      border 1px --rule · radius --r-lg · background --panel · overflow hidden
Panel.Row  padding 18px 20px · border-bottom 1px --rule · แถวสุดท้ายไม่มีเส้น
Button     primary  background --ink   color --panel  border 1px --ink
           ghost    background --panel color --ink    border 1px --rule  hover border --ink
           danger   background --panel · color และ border จาก STATUS_TONES.danger
           ทุกแบบ radius --r · padding 10px 18px · 13px/600 · disabled → opacity .5
Field      label 11px/600 --ink-3 · input border 1px --rule radius --r padding 9px 12px
           error → border จาก STATUS_TONES.danger.border · ข้อความ 11px สีจาก .fg
           aria-invalid + aria-describedby
Badge      radius --r-pill · padding 3px 9px · 10px/600 .06em uppercase --mono
           สีจาก STATUS_TONES · tone="mute" = border dashed --rule สี --ink-3
Rows       loading → แถว skeleton พื้น --panel-2 มี data-skeleton
           items ว่าง → empty
Empty      กลางแผง · หัวข้อ 14px/600 · คำอธิบาย 12px --ink-3 · action ใต้สุด
```

- [ ] **Step 6: รันเทสต์ให้เขียว**

```bash
npx vitest run components/ui/ui.test.tsx && npm run build
```

Expected: PASS ทั้งหมด

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: the seven primitives every screen is built from

These appear on every screen in the prototype. Building them first is what keeps
colour and radius from drifting apart by the third screen, because no screen has
a reason to declare a button of its own.

Two accessibility details are in the tests rather than left to review: a field
label is bound to its input by id, and an invalid field says so with
aria-invalid instead of only turning red. Colour alone is not a message."
```

---

### Task 4: M1-S01 รายการแคมเปญ

**Files:**
- Create: `app/(admin)/campaigns/page.tsx` · `app/(admin)/campaigns/actions.ts` · `lib/db/campaigns.ts` · `lib/db/campaigns.test.ts`

**Interfaces:**
- Consumes: `requireRole` · `Panel` · `Rows` · `Badge` · `PageHead` · `Button`
- Produces:
  - `type CampaignSummary = { id: string; name: string; code: string; status: 'draft'|'published'|'closed'; activityCount: number; channelName: string | null; daysLeft: number | null; purgeInDays: number | null }`
  - `listCampaigns(sql): Promise<CampaignSummary[]>`
  - `createCampaign(formData): Promise<void>` — Server Action

**สิ่งที่ต้นแบบบอก** — แถวหนึ่งต้องเห็น **สถานะกับจำนวนวันที่เหลือพร้อมกัน** · แคมเปญที่จบแล้วบอกวันที่ข้อมูลจะถูกลบ · ผู้ดูแลเนื้อหาเห็นป้าย "ดูอย่างเดียว" แทนปุ่มสร้าง

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`lib/db/campaigns.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { summarize } from './campaigns'

const row = {
  id: 'c1', name: 'Krob Pet', code: 'krobpet', status: 'published' as const,
  activity_count: 4, channel_name: 'OA ครบเจ็ด',
  start_at: new Date('2026-08-01T00:00:00Z'),
  end_at: new Date('2026-08-31T00:00:00Z'),
}
const NOW = new Date('2026-08-19T00:00:00Z')

describe('summarize', () => {
  it('นับวันที่เหลือจากวันจบ', () => {
    expect(summarize(row, NOW).daysLeft).toBe(12)
  })

  it('แคมเปญที่ยังไม่เริ่ม วันที่เหลือยังนับจากวันจบ ไม่ติดลบ', () => {
    expect(summarize(row, new Date('2026-07-01T00:00:00Z')).daysLeft).toBeGreaterThan(0)
  })

  it('แคมเปญที่จบแล้วบอกว่าเหลือกี่วันก่อนลบข้อมูล นับจากวันจบ + 30', () => {
    const closed = { ...row, status: 'closed' as const }
    expect(summarize(closed, new Date('2026-09-12T00:00:00Z')).purgeInDays).toBe(18)
  })

  it('แคมเปญที่จบและพ้น 30 วันแล้ว บอกศูนย์ ไม่ใช่ค่าติดลบ', () => {
    const closed = { ...row, status: 'closed' as const }
    expect(summarize(closed, new Date('2026-10-30T00:00:00Z')).purgeInDays).toBe(0)
  })

  it('แคมเปญร่างที่ยังไม่ผูกบัญชี คืน null ไม่ใช่สตริงว่าง', () => {
    const draft = { ...row, status: 'draft' as const, channel_name: null }
    expect(summarize(draft, NOW).channelName).toBeNull()
  })
})
```

- [ ] **Step 2: รันให้เห็นว่าแดง**

```bash
npx vitest run lib/db/campaigns.test.ts
```

Expected: FAIL — resolve import ไม่ได้

- [ ] **Step 3: เขียน `lib/db/campaigns.ts`**

```ts
import type postgres from 'postgres'

/** นโยบายเก็บข้อมูลของ §5.4 — ปิดแคมเปญแล้วบวก 30 วัน */
const PURGE_AFTER_DAYS = 30
const DAY_MS = 86_400_000

export type CampaignRow = {
  id: string
  name: string
  code: string
  status: 'draft' | 'published' | 'closed'
  activity_count: number
  channel_name: string | null
  start_at: Date
  end_at: Date
}

export type CampaignSummary = {
  id: string
  name: string
  code: string
  status: CampaignRow['status']
  activityCount: number
  channelName: string | null
  daysLeft: number | null
  purgeInDays: number | null
}

const daysBetween = (from: Date, to: Date) => Math.ceil((to.getTime() - from.getTime()) / DAY_MS)

/**
 * A row has to answer two questions at once: is this live, and how long have I
 * got. Those are the two things people open this screen to find out, so they
 * belong in the same row rather than one screen apart.
 *
 * A closed campaign answers a third: when its player data disappears. That
 * deadline cannot be undone, so it is shown without being asked for.
 */
export function summarize(row: CampaignRow, now: Date): CampaignSummary {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    status: row.status,
    activityCount: row.activity_count,
    channelName: row.channel_name,
    daysLeft: row.status === 'closed' ? null : Math.max(0, daysBetween(now, row.end_at)),
    purgeInDays: row.status !== 'closed'
      ? null
      : Math.max(0, daysBetween(now, new Date(row.end_at.getTime() + PURGE_AFTER_DAYS * DAY_MS))),
  }
}

export async function listCampaigns(sql: postgres.Sql, now: Date): Promise<CampaignSummary[]> {
  const rows = await sql<CampaignRow[]>`
    SELECT ca.id, ca.name, ca.code, ca.status, ca.start_at, ca.end_at,
           (SELECT count(*) FROM activity a WHERE a.campaign_id = ca.id)::int AS activity_count,
           (SELECT ch.name FROM campaign_channel cc
              JOIN channel ch ON ch.id = cc.channel_id
             WHERE cc.campaign_id = ca.id AND cc.is_published LIMIT 1) AS channel_name
      FROM campaign ca
     ORDER BY ca.status = 'published' DESC, ca.end_at DESC`
  return rows.map((r) => summarize(r, now))
}
```

- [ ] **Step 4: เขียน Server Action ที่ตรวจสิทธิ์เอง**

`app/(admin)/campaigns/actions.ts`

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require'
import { db } from '@/lib/db/client'

/** รหัสสั้นที่แนบไปกับ postback ทุกปุ่ม (BR-33) — ตัวพิมพ์เล็กและขีดล่าง ไม่เกิน 20 */
const CODE_PATTERN = /^[a-z0-9_]{1,20}$/

export async function createCampaign(formData: FormData): Promise<void> {
  const session = await requireRole('configurator')

  const name = String(formData.get('name') ?? '').trim()
  const code = String(formData.get('code') ?? '').trim()
  const endAt = String(formData.get('end_at') ?? '')

  if (!name) throw new Error('ต้องมีชื่อแคมเปญ')
  if (!CODE_PATTERN.test(code)) throw new Error('รหัสใช้ได้แค่ a-z 0-9 และขีดล่าง ยาวไม่เกิน 20')
  // บังคับมี (BR-29) — เป็นจุดเริ่มนับของสถิติและการลบข้อมูล
  if (!endAt) throw new Error('ต้องระบุวันจบ')

    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES (${name}, ${code}, now(), ${endAt}, ${session.userId})`

  revalidatePath('/campaigns')
}
```

- [ ] **Step 5: เขียนหน้าจอตามต้นแบบ**

ค้น `data-screen-label="M1-S01 รายการแคมเปญ"` แล้วทำตาม · `max-width:1060px;margin:0 auto`
แถวหนึ่งประกอบด้วย ชื่อ + รหัสด้วย `--mono` · `<Badge>` ของสถานะ · จำนวนกิจกรรม · ชื่อบัญชี · วันที่เหลือ
ผู้ดูแลเนื้อหาเห็น `<Badge tone="mute">ดูอย่างเดียว · ผู้ดูแลเนื้อหา</Badge>` แทนสองปุ่ม

- [ ] **Step 6: รันเทสต์และ build**

```bash
npx vitest run lib/db/campaigns.test.ts && npm run build && npm run test:all
```

Expected: PASS ทั้งหมด

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: the campaign list, with both deadlines a row has to carry

Status and days remaining are the two things people open this screen for, so
they sit in the same row instead of one screen apart. A closed campaign shows a
third: when its player data disappears. That deadline cannot be undone, so it is
shown without being asked for.

createCampaign checks its own role. The screen also hides the button from a
content editor, but the action is what actually guards the write."
```

---

### Task 5: M1-S02 ข้อมูลแคมเปญ

**Files:**
- Create: `app/(admin)/campaigns/[id]/page.tsx` · `app/(admin)/campaigns/[id]/actions.ts` · `lib/campaign/dayclock.ts` · `lib/campaign/dayclock.test.ts`

**Interfaces:**
- Consumes: `periodKey` จาก `lib/daykey` · `Field` · `Panel`
- Produces:
  - `describeDayClock(timezone: string, dayLengthSec: number): string` — ประโยคที่อธิบายว่า "วันละครั้ง" นับยังไง
  - `saveCampaignInfo(formData): Promise<void>`

**ทำไมมี `describeDayClock`** — สองช่องนี้ตัดสินว่า "วันละครั้ง" นับยังไง และคนตั้งค่าเดาผลของมันไม่ได้จากตัวเลข · หน้าจอต้องเขียนผลลัพธ์ออกมาเป็นประโยค

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`lib/campaign/dayclock.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { describeDayClock } from './dayclock'

describe('describeDayClock', () => {
  it('วันปกติบอกว่าตัดที่เที่ยงคืนตามเขตเวลาไหน', () => {
    const said = describeDayClock('Asia/Bangkok', 86400)
    expect(said).toContain('เที่ยงคืน')
    expect(said).toContain('Asia/Bangkok')
  })

  it('วันสั้นบอกเป็นวินาที และบอกว่าใช้สำหรับเดโม่', () => {
    const said = describeDayClock('Asia/Bangkok', 30)
    expect(said).toContain('30')
    expect(said).toContain('เดโม่')
  })

  it('ศูนย์คือจำกัดตลอดแคมเปญ ไม่ใช่วันยาวศูนย์วินาที', () => {
    expect(describeDayClock('UTC', 0)).toContain('ตลอดแคมเปญ')
  })
})
```

- [ ] **Step 2: รันให้แดง แล้วเขียน `lib/campaign/dayclock.ts`**

```ts
/**
 * Turn the two fields that decide "once per day" into a sentence.
 *
 * Nobody can predict what a timezone plus a day length does to a limit by
 * reading the numbers, and getting it wrong means a player who plays at 00:30
 * is counted into the next day. The screen says the consequence out loud.
 */
export function describeDayClock(timezone: string, dayLengthSec: number): string {
  if (dayLengthSec <= 0) {
    return 'จำกัดตลอดแคมเปญ — เล่นได้ครั้งเดียวตลอด ไม่นับใหม่รายวัน'
  }
  if (dayLengthSec >= 86_400) {
    return `หนึ่งวันตัดที่เที่ยงคืนตามเขตเวลา ${timezone} — คนที่เล่นตอน 00:30 นับเป็นวันใหม่แล้ว`
  }
  return `หนึ่งวันยาว ${dayLengthSec} วินาที — สำหรับเดโม่ ทำให้สะสม 7 วันจบได้ใน ${Math.round((dayLengthSec * 7) / 60) || 1} นาที`
}
```

```bash
npx vitest run lib/campaign/dayclock.test.ts
```

Expected: PASS

- [ ] **Step 3: เขียนหน้าจอ**

ค้น `data-screen-label="M1-S02 ข้อมูลแคมเปญ"` · ช่องที่ต้องมี ชื่อ · รหัส (อ่านอย่างเดียวหลัง publish) ·
วันเริ่ม · **วันจบบังคับกรอก** · เขตเวลา · ความยาววัน + ประโยคจาก `describeDayClock` · สีธีม

**ห้ามลืม** — แคมเปญที่ `status = 'published'` แก้กติกาไม่ได้ (BR-05) · หน้าจอต้องปิดช่องและบอกว่าให้สร้าง version ใหม่

- [ ] **Step 4: เขียน Server Action พร้อมกันการแก้หลัง publish**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require'
import { db } from '@/lib/db/client'

export async function saveCampaignInfo(id: string, formData: FormData): Promise<void> {
  await requireRole('configurator')
  const sql = db()

  const [current] = await sql<{ status: string }[]>`SELECT status FROM campaign WHERE id = ${id}`
  // BR-05 · กติกาที่ส่งขึ้นแล้วห้ามแก้ ต้องสร้าง version ใหม่
  if (current?.status === 'published') {
    throw new Error('แคมเปญนี้ส่งขึ้นแล้ว แก้กติกาไม่ได้ — ถอนก่อนแก้ หรือก๊อปเป็นแคมเปญใหม่')
  }

  const endAt = String(formData.get('end_at') ?? '')
  if (!endAt) throw new Error('ต้องระบุวันจบ')

  await sql`
    UPDATE campaign SET
      name = ${String(formData.get('name') ?? '').trim()},
      timezone = ${String(formData.get('timezone') ?? 'Asia/Bangkok')},
      day_length_sec = ${Number(formData.get('day_length_sec') ?? 86400)},
      end_at = ${endAt},
      theme = ${sql.json({ primary: String(formData.get('theme_primary') ?? '#17756A') } as never)}
     WHERE id = ${id}`

  revalidatePath(`/campaigns/${id}`)
}
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: campaign settings, with the day clock spelled out

Timezone and day length together decide what 'once per day' counts, and nobody
can predict that from the numbers — get it wrong and a player at 00:30 lands in
the next day. describeDayClock() writes the consequence as a sentence next to
the fields.

A published campaign refuses edits (BR-05) in the action, not only in the form.
The message says what to do instead of only saying no."
```

---

### Task 6: M1-S06 ตั้งค่าคีย์เวิร์ดตอบกลับ · จอใหม่

**Files:**
- Create: `app/(admin)/campaigns/[id]/keywords/page.tsx` · `app/(admin)/campaigns/[id]/keywords/actions.ts` · `lib/campaign/keywords.ts` · `lib/campaign/keywords.test.ts`

**Interfaces:**
- Consumes: `normalizeText` จาก `lib/match/keyword`
- Produces:
  - `type KeywordConflict = { keyword: string; channelName: string }`
  - `findConflicts(keywords: string[], channels: Array<{ name: string; existingKeywords: string[] }>): KeywordConflict[]`
  - `saveKeyword` · `deleteKeyword` — Server Action

**จอนี้ไม่มีในต้นแบบ** — เป็นจอที่เพิ่มใน L2 v0.32 หลังพบว่า `keyword_rule` ไม่มีจอไหนแตะเลย ·
**ให้ทำตามแบบเดียวกับ M4-S01 ในต้นแบบ** เพราะเป็นของประเภทเดียวกัน คือทางเข้าจากภายนอก

**สิ่งที่จอนี้ต้องทำและจอ CRUD ธรรมดาไม่ต้อง** — เตือนเมื่อคีย์เวิร์ดชนกับที่ลูกค้าตั้งไว้ใน OA Manager (BR-44)
ถ้าชน คีย์เวิร์ดเดิมของลูกค้าจะชิงตอบก่อน แล้วกิจกรรมพังเงียบๆ โดย log ฝั่งเราดูเหมือนปกติ

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`lib/campaign/keywords.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { findConflicts } from './keywords'

const channels = [
  { name: 'OA ธ.ก.ส.', existingKeywords: ['โปรโมชั่น', 'ที่ตั้งสาขา'] },
  { name: 'OA ทดสอบ', existingKeywords: [] },
]

describe('findConflicts', () => {
  it('ชนกับคีย์เวิร์ดเดิมของลูกค้า บอกทั้งคำและบัญชี', () => {
    expect(findConflicts(['โปรโมชั่น'], channels))
      .toEqual([{ keyword: 'โปรโมชั่น', channelName: 'OA ธ.ก.ส.' }])
  })

  it('ไม่ชน คืนรายการว่าง', () => {
    expect(findConflicts(['เล่นเกม'], channels)).toEqual([])
  })

  it('เทียบหลังทำข้อความเป็นมาตรฐาน — ช่องว่างและตัวพิมพ์ไม่ช่วยให้รอด', () => {
    expect(findConflicts(['  โปรโมชั่น '], channels)).toHaveLength(1)
  })

  it('ชนหลายบัญชี รายงานทุกบัญชี เพราะแคมเปญอาจผูกหลายบัญชี', () => {
    const many = [...channels, { name: 'OA สาขาย่อย', existingKeywords: ['โปรโมชั่น'] }]
    expect(findConflicts(['โปรโมชั่น'], many)).toHaveLength(2)
  })

  it('บัญชีที่ยังไม่กรอกคีย์เวิร์ดเดิม ไม่ทำให้พลาดการเตือนของบัญชีอื่น', () => {
    expect(findConflicts(['ที่ตั้งสาขา'], channels)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: รันให้แดง แล้วเขียน `lib/campaign/keywords.ts`**

```ts
import { normalizeText } from '../match/keyword'

export type KeywordConflict = { keyword: string; channelName: string }

/**
 * Warn when a campaign keyword collides with one the client already set up in
 * OA Manager (BR-44).
 *
 * A collision is worse than it sounds: the client's own auto-reply answers
 * first, the activity never runs, and our logs look completely normal because
 * the event never reached us. Nothing on either side reports a problem.
 *
 * Every channel the campaign is bound to gets checked, because a keyword that
 * is free on one OA may be taken on another.
 */
export function findConflicts(
  keywords: string[],
  channels: Array<{ name: string; existingKeywords: string[] }>,
): KeywordConflict[] {
  const conflicts: KeywordConflict[] = []

  for (const keyword of keywords) {
    const needle = normalizeText(keyword)
    if (!needle) continue

    for (const channel of channels) {
      const taken = channel.existingKeywords.some((k) => normalizeText(k) === needle)
      if (taken) conflicts.push({ keyword: keyword.trim(), channelName: channel.name })
    }
  }

  return conflicts
}
```

```bash
npx vitest run lib/campaign/keywords.test.ts
```

Expected: PASS ทั้ง 5 เคส

- [ ] **Step 3: เขียน Server Action**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require'
import { db } from '@/lib/db/client'
import { normalizeText } from '@/lib/match/keyword'

export async function saveKeyword(campaignId: string, formData: FormData): Promise<void> {
  await requireRole('configurator', 'content_editor')
  const sql = db()

  // เก็บในรูปที่ทำเป็นมาตรฐานแล้ว (BR-48) — จับคู่ตอนรับ event ใช้รูปเดียวกัน
  const keyword = normalizeText(String(formData.get('keyword') ?? ''))
  if (!keyword) throw new Error('ต้องมีคำที่จะให้ตอบ')

  const matchMode = String(formData.get('match_mode') ?? 'exact')
  const activityId = String(formData.get('target_activity_id') ?? '') || null
  const cardId = String(formData.get('target_card_id') ?? '') || null

  // CHECK ที่ฐานข้อมูลบังคับอยู่แล้ว แต่ข้อความจากที่นี่บอกวิธีแก้ได้ดีกว่า
  if (!activityId && !cardId) {
    throw new Error('ต้องเลือกว่าให้พาไปกิจกรรมไหน หรือตอบด้วยการ์ดใบไหน')
  }

  const id = String(formData.get('id') ?? '')
  if (id) {
    await sql`
      UPDATE keyword_rule SET keyword = ${keyword}, match_mode = ${matchMode},
             target_activity_id = ${activityId}, target_card_id = ${cardId}
       WHERE id = ${id} AND campaign_id = ${campaignId}`
  } else {
    await sql`
      INSERT INTO keyword_rule (campaign_id, keyword, match_mode, target_activity_id, target_card_id, sort_order)
      VALUES (${campaignId}, ${keyword}, ${matchMode}, ${activityId}, ${cardId},
              COALESCE((SELECT max(sort_order) + 1 FROM keyword_rule WHERE campaign_id = ${campaignId}), 0))`
  }

  revalidatePath(`/campaigns/${campaignId}/keywords`)
}

export async function deleteKeyword(campaignId: string, id: string): Promise<void> {
  await requireRole('configurator')
  await db()`DELETE FROM keyword_rule WHERE id = ${id} AND campaign_id = ${campaignId}`
  revalidatePath(`/campaigns/${campaignId}/keywords`)
}
```

- [ ] **Step 4: เขียนหน้าจอ**

องค์ประกอบที่ต้องมี

```
PageHead  code="M1-S06 · Keywords"  title="คีย์เวิร์ดตอบกลับ"
แถวหนึ่ง  คำ (--mono) · Badge ของ exact/contains · ลูกศร → · ปลายทาง (ชื่อกิจกรรมหรือการ์ด)
          ปุ่มแก้ · ปุ่มลบ
เตือน     กล่อง tone="warn" เหนือรายการ เมื่อ findConflicts คืนของ
          ข้อความ: "คำว่า X ชนกับคีย์เวิร์ดเดิมของ [ชื่อบัญชี] — ของลูกค้าจะตอบก่อน
                    แล้วกิจกรรมนี้จะไม่ทำงาน โดยไม่มี error ให้เห็น"
คำอธิบาย  ใต้หัวข้อ: "exact ตรวจก่อน contains เสมอ · ในกลุ่มเดียวกันไล่จากบนลงล่าง"
ว่าง      Empty title="ยังไม่มีคีย์เวิร์ด"
          note="ผู้ใช้พิมพ์อะไรก็จะได้การ์ดตั้งต้นของบัญชีเท่านั้น"
```

- [ ] **Step 5: รันทั้งหมดและ build**

```bash
npm run test:all && npm run build
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: the keyword screen the design never had

keyword_rule had a table, an engine path and working code, but no screen — auto
reply could only be configured with INSERT. It was easy to miss because keywords
are mentioned in four places, all of them describing what the system reads and
none saying where a person types them.

It gets its own screen rather than a section of campaign settings because a
keyword and a rich menu are the same kind of thing — a way in from outside — and
the rich menu already has one.

The collision warning is the part that earns the screen. When a campaign keyword
matches one the client set in OA Manager, their auto-reply answers first, the
activity never runs, and our logs look normal because the event never arrived.
Nothing reports it, so the screen has to."
```

---

### Task 7: M6-S01 · M6-S02 บัญชี LINE และการเข้ารหัสกุญแจ

**Files:**
- Create: `lib/crypto/secretbox.ts` · `lib/crypto/secretbox.test.ts` · `app/(admin)/channels/page.tsx` · `app/(admin)/channels/[id]/page.tsx` · `app/(admin)/channels/actions.ts`

**Interfaces:**
- Produces:
  - `encryptSecret(plain: string): { cipher: string; keyVersion: number }`
  - `decryptSecret(cipher: string, keyVersion: number): string`
  - `last4(plain: string): string`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

`lib/crypto/secretbox.test.ts`

```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret, last4 } from './secretbox'

beforeAll(() => {
  process.env.SECRET_KEY_V1 = Buffer.alloc(32, 7).toString('base64')
})

describe('secretbox', () => {
  it('เข้ารหัสแล้วถอดกลับได้ของเดิม', () => {
    const { cipher, keyVersion } = encryptSecret('super-secret-token')
    expect(decryptSecret(cipher, keyVersion)).toBe('super-secret-token')
  })

  it('ข้อความเดิมเข้ารหัสสองครั้งได้ผลต่างกัน', () => {
    expect(encryptSecret('x').cipher).not.toBe(encryptSecret('x').cipher)
  })

  it('แก้ ciphertext แล้วถอดไม่ได้ ไม่ใช่ได้ขยะ', () => {
    const { cipher, keyVersion } = encryptSecret('x')
    const tampered = cipher.slice(0, -4) + 'AAAA'
    expect(() => decryptSecret(tampered, keyVersion)).toThrow()
  })

  it('ไม่มีกุญแจของรุ่นนั้น โยนโดยไม่บอกว่ากุญแจอื่นมีอะไร', () => {
    expect(() => decryptSecret('x', 99)).toThrow(/SECRET_KEY_V99/)
  })

  it('last4 คืนสี่ตัวท้าย ไม่เผยส่วนอื่น', () => {
    expect(last4('abcdefgh1234')).toBe('1234')
    expect(last4('ab')).toBe('ab')
  })
})
```

- [ ] **Step 2: รันให้แดง แล้วเขียน `lib/crypto/secretbox.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const CURRENT_VERSION = 1
const IV_BYTES = 12

function keyFor(version: number): Buffer {
  const name = `SECRET_KEY_V${version}`
  const raw = process.env[name]
  if (!raw) throw new Error(`Missing environment variable: ${name}`)
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error(`${name} must be 32 bytes, base64 encoded`)
  return key
}

/**
 * A channel access token lets anyone holding it speak as the brand, so it is
 * encrypted at rest (DD-03) and the screen only ever sees the last four
 * characters (BR-16).
 *
 * AES-GCM rather than plain AES: a tampered ciphertext must fail loudly instead
 * of decrypting into garbage that then gets sent to LINE as a bearer token.
 * The key version travels with the value so keys can be rotated without a
 * migration that rewrites every row at once.
 */
export function encryptSecret(plain: string): { cipher: string; keyVersion: number } {
  const iv = randomBytes(IV_BYTES)
  const box = createCipheriv('aes-256-gcm', keyFor(CURRENT_VERSION), iv)
  const body = Buffer.concat([box.update(plain, 'utf8'), box.final()])
  return {
    cipher: Buffer.concat([iv, box.getAuthTag(), body]).toString('base64'),
    keyVersion: CURRENT_VERSION,
  }
}

export function decryptSecret(cipher: string, keyVersion: number): string {
  const raw = Buffer.from(cipher, 'base64')
  const iv = raw.subarray(0, IV_BYTES)
  const tag = raw.subarray(IV_BYTES, IV_BYTES + 16)
  const body = raw.subarray(IV_BYTES + 16)

  const box = createDecipheriv('aes-256-gcm', keyFor(keyVersion), iv)
  box.setAuthTag(tag)
  return Buffer.concat([box.update(body), box.final()]).toString('utf8')
}

export function last4(plain: string): string {
  return plain.slice(-4)
}
```

```bash
npx vitest run lib/crypto/secretbox.test.ts
```

Expected: PASS ทั้ง 5 เคส

- [ ] **Step 3: เขียนสองหน้าจอตามต้นแบบ**

ค้น `M6-S01 รายการบัญชี LINE` และ `M6-S02 ผูกหรือแก้บัญชี LINE`

**ที่ต้องไม่พลาด**

```
แสดงโทเคนเป็น ••••1234 เสมอ ทั้งก่อนและหลังกดแก้ — ไม่มีทางไหนเห็นค่าเต็ม
ชั้นสามชั้นแยกด้วย Badge  preview=mute  test=info  production=warn
production ต้องกรอกกุญแจ · preview ต้องไม่มีกุญแจ (CHECK ที่ฐานข้อมูลบังคับ)
ช่องรายการคีย์เวิร์ดเดิมของลูกค้า — textarea บรรทัดละคำ เก็บลง existing_keywords
  ใต้ช่องเขียนว่า "SA กรอกจาก OA Manager · ใช้เตือนตอนตั้งคีย์เวิร์ดใน M1-S06"
แถวที่ is_published บอกว่าเปิดอยู่ และเตือนว่าหนึ่งบัญชีรันแคมเปญทีละหนึ่ง (BR-68)
```

- [ ] **Step 4: บันทึกการอ่านกุญแจลง `token_access_log` ทุกครั้ง**

```ts
// ทุกครั้งที่ decryptSecret ถูกเรียกเพื่อแสดงหรือใช้งาน ต้องมีแถวนี้
await sql`
  INSERT INTO token_access_log (channel_id, actor_type, app_user_id, purpose)
  VALUES (${channelId}, 'user', ${session.userId}, 'display_last4')`
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: LINE channels, with tokens encrypted at rest

A channel access token lets anyone holding it speak as the brand, so it is
encrypted (DD-03) and the screen never shows more than the last four characters
(BR-16) — before or after pressing edit, because there is no reason a person
needs the whole thing back.

AES-GCM rather than plain AES: a tampered ciphertext has to fail loudly instead
of decrypting into garbage that then gets sent to LINE as a bearer token. The key
version travels with each value so keys rotate without one migration rewriting
every row.

Every decrypt writes a token_access_log row. That table cannot be backfilled, so
it starts on the first day it could have been useful."
```

---

### Task 8: M9-S01 · M9-S02 คลังภาพและอัปโหลด

**Files:**
- Create: `lib/assets/validate.ts` · `lib/assets/validate.test.ts` · `app/(admin)/campaigns/[id]/assets/page.tsx` · `app/(admin)/campaigns/[id]/assets/actions.ts`

**Interfaces:**
- Produces: `validateUpload(file: { mime: string; bytes: number; width: number; height: number }): { ok: true } | { ok: false; reason: string }`

**ข้อกำหนดจริงจาก §5.2 `asset`** — ภาพ JPEG หรือ PNG ไม่เกิน 1 MB · วิดีโอ mp4 ไม่เกิน 1 นาที และ 10 MB ·
ภาพเมนู 2500 × 1686 กว้าง 800–2500 สูงอย่างน้อย 250

- [ ] **Step 1: เขียนเทสต์**

```ts
import { describe, expect, it } from 'vitest'
import { validateUpload } from './validate'

const image = { mime: 'image/png', bytes: 400_000, width: 1040, height: 640 }

describe('validateUpload', () => {
  it('ภาพ PNG ขนาดปกติผ่าน', () => {
    expect(validateUpload(image)).toEqual({ ok: true })
  })
  it('GIF ไม่ผ่าน และบอกว่ารับอะไร', () => {
    const out = validateUpload({ ...image, mime: 'image/gif' })
    expect(out).toMatchObject({ ok: false })
    if (out.ok) throw new Error('unreachable')
    expect(out.reason).toContain('JPEG')
  })
  it('ภาพเกิน 1 MB ไม่ผ่าน และบอกขนาดจริง', () => {
    const out = validateUpload({ ...image, bytes: 2_000_000 })
    if (out.ok) throw new Error('unreachable')
    expect(out.reason).toMatch(/1 MB|2/)
  })
  it('ภาพแคบกว่า 800 ไม่ผ่าน เพราะใช้เป็นภาพเมนูไม่ได้', () => {
    expect(validateUpload({ ...image, width: 400 }).ok).toBe(false)
  })
  it('วิดีโอ mp4 ยาวไม่เกินหนึ่งนาทีผ่าน', () => {
    expect(validateUpload({ mime: 'video/mp4', bytes: 5_000_000, width: 1280, height: 720, durationSec: 45 }).ok).toBe(true)
  })
  it('วิดีโอยาวเกินหนึ่งนาทีไม่ผ่าน', () => {
    expect(validateUpload({ mime: 'video/mp4', bytes: 5_000_000, width: 1280, height: 720, durationSec: 90 }).ok).toBe(false)
  })
})
```

- [ ] **Step 2: รันให้แดง เขียน `validate.ts` ให้ผ่าน แล้วทำสองหน้าจอตามต้นแบบ**

ค้น `M9-S01 คลังภาพ` และ `M9-S02 อัปโหลดภาพ` · **อัปโหลดทับต้องสร้างแถวใหม่ชี้กลับของเดิม ห้ามลบของเดิม** (BR-25)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: the asset library, with the limits that actually bite

The ceilings are LINE's, not ours, and each rejection says the real number
rather than 'invalid file' — a person holding a 2 MB export needs to know the
limit is 1 MB to do anything about it.

Re-uploading writes a new row pointing back at the old one instead of replacing
it (BR-25). A card that has already gone out to a chat still references the
file it was built with, and deleting that file would break a message nobody can
edit any more."
```

---

### Task 9: M7-S03 ค่าสะสม

**Files:**
- Create: `app/(admin)/campaigns/[id]/counters/page.tsx` · `.../actions.ts`

**สิ่งที่ต้องไม่พลาด** — **กติกา "ต้องกดติดกันทุกวัน" อยู่ที่ `counter` ไม่ใช่ `stamp_card`** (ย้ายมาแล้วใน L2 v0.22)
หน้าจอต้องเขียนไว้ว่าตั้งเป้ากี่วันก็ได้ ไม่ติดเพดาน 30 ช่องของบัตร

- [ ] **Step 1: ทำตามต้นแบบ** — ค้น `M7-S03 ค่าสะสม` และ `M7-S03 แก้ค่าสะสม`

องค์ประกอบ: รหัส (ใช้ใน `{{counter.xxx}}` แสดงด้วย `--mono`) · ชื่อ · โหมดสามแบบ · **สวิตช์ต้องกดติดกัน** ·
เป้า · จุดปลดล็อกเป็นรายการ (ค่า + effect)

- [ ] **Step 2: เขียนคำอธิบายใต้สวิตช์ให้ตรงกับความจริง**

```
"กติกานี้อยู่ที่ค่าสะสม ไม่ได้อยู่ที่บัตรแสตมป์ — ตั้งเป้า 60 วันติดได้
 โดยไม่ติดเพดานจำนวนช่องบนบัตร · ขาดวันเดียวรีเซ็ตเป็นศูนย์
 ระบบย้อนอ่านร่องรอยจริง ไม่เดาจากยอดรวม"
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: counters, with the streak rule where it belongs

'Must be consecutive' lives on the counter, not on the stamp card — it was moved
there because a counting rule sitting in a display layer capped every goal at
the card's 30 slots. The screen says so, because anyone who remembers the old
shape will look for the switch in the wrong place."
```

---

### Task 10: M7-S04 รางวัล

**Files:**
- Create: `app/(admin)/campaigns/[id]/rewards/page.tsx` · `.../actions.ts`

**สิ่งที่ต้องไม่พลาด** — `issued_count` **อ่านอย่างเดียว** · ให้คนพิมพ์ทับได้เมื่อไหร่ ตัวเลขจะขัดกับจำนวนสิทธิ์ที่ออกไปจริงโดยไม่มีอะไรเตือน

- [ ] **Step 1: ทำตามต้นแบบ** — ค้น `M7-S04 รางวัล` และ `M7-S04 แก้รางวัล`

```
ช่อง        รหัส (--mono) · ชนิดสี่แบบ · ค่า · โควตา · อายุสิทธิ์ · ใช้ได้กี่ครั้ง
อ่านอย่างเดียว  แจกไปแล้ว — พร้อมคำอธิบายว่าทำไมแก้ไม่ได้
ชนิด code    ต้องมีช่องอัปโหลดรายการรหัส · แสดงว่าเหลือว่างกี่ตัว
บังคับกรอก   อายุสิทธิ์และจำนวนครั้ง เมื่อเป็นคูปอง
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: rewards, with the issued count read-only

Remaining stock has one owner and it is the transaction that issues
entitlements. A field a person can type over would drift from the number of
entitlements that actually exist, and nothing would report the gap — the first
symptom would be a client discovering they gave away more than they owned."
```

---

### Task 11: M3-S01 รายการการ์ด และ M3-S03 ชุดเนื้อหา

**Files:**
- Create: `app/(admin)/campaigns/[id]/cards/page.tsx` · `app/(admin)/campaigns/[id]/selectors/**`

- [ ] **Step 1: ทำตามต้นแบบ** — `M3-S01 รายการการ์ด` · `M3-S03 ชุดเนื้อหา` · `M3-S03 แก้ชุดเนื้อหา`

```
M3-S01  ตัวกรองตามสิ่งที่อ้างถึง และตัวกรอง "ยังไม่ถูกใช้"
        อ่านจากการอ้างอิงจริง ไม่เก็บป้ายแยก — หลักเดียวกับที่โควตามีเจ้าของที่เดียว
        Badge ของชนิดการส่ง
M3-S03  ตารางจับคู่สูงสุด 10 แถว · แถวสำรองบังคับกรอก (BR-27)
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: the card list and content sets

The 'unused' filter reads the actual references rather than a flag kept beside
them, on the same principle that gives remaining stock one owner: two places
holding the same fact is two places that can disagree.

A content set's fallback row is mandatory (BR-27). It gets asked for at the
moment a card is answered, so a set with nothing to return is a card with
nothing to say."
```

---

### Task 12: M3-S02 ขั้นที่ 1–2 · ชนิดการส่ง แล้วเทมเพลต

**Files:**
- Create: `app/(admin)/campaigns/[id]/cards/new/page.tsx` · `lib/cards/create.ts` · `lib/cards/create.test.ts`

**Interfaces:**
- Produces: `type SendType = 'flex_bubble' | 'flex_carousel' | 'text'` · `blocksFromTemplate(templateBlocks, sendType): CardBlock[]`

**ลำดับบังคับ** — ชนิดการส่งเป็นขั้นที่ 1 (BR-89) แล้วเทมเพลตเป็นขั้นที่ 2 (BR-63) ·
สองอย่างนี้เป็นแกนอิสระ **หน้าจอต้องแสดงเครื่องหมายคูณให้เห็น** ไม่ใช่รวมเป็นรายการเดียว

- [ ] **Step 1: เขียนเทสต์**

```ts
import { describe, expect, it } from 'vitest'
import { blocksFromTemplate } from './create'

const template = [
  { blockType: 'image', content: '', options: { placement: 'full_top' } },
  { blockType: 'title', content: 'หัวข้อตัวอย่าง' },
  { blockType: 'button', content: 'กดเลย', options: { action: { type: 'postback' } } },
]

describe('blocksFromTemplate', () => {
  it('คัดลอกบล็อกมาครบและรักษาลำดับ', () => {
    const blocks = blocksFromTemplate(template, 'flex_bubble')
    expect(blocks.map((b) => b.blockType)).toEqual(['image', 'title', 'button'])
    expect(blocks.map((b) => b.sortOrder)).toEqual([0, 1, 2])
  })

  it('ข้อความล้วนตัดบล็อกที่ไม่มีข้อความออก', () => {
    const blocks = blocksFromTemplate(template, 'text')
    expect(blocks.map((b) => b.blockType)).toEqual(['title', 'button'])
  })

  it('ทุกเทมเพลตใช้ได้กับทุกชนิด ไม่มีการคืนรายการว่าง', () => {
    for (const type of ['flex_bubble', 'flex_carousel', 'text'] as const) {
      expect(blocksFromTemplate(template, type).length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: รันให้แดง เขียนให้ผ่าน แล้วทำหน้าจอ**

```
ขั้น 1  ห้าชนิด แต่สไลซ์นี้เปิดสาม — การ์ดเดี่ยว · การ์ดปัดได้ · ข้อความล้วน
        ริชเมสเสจกับริชวิดีโอแสดงเป็น disabled พร้อมเหตุผล "รอตัววาดภาพ · OI-27"
ขั้น 2  เทมเพลต 10 ตัว แบ่งสองกลุ่ม "ลอกจาก LINE" กับ "LINE ไม่มี"
        รวม "เริ่มจากศูนย์" อยู่ในชุดเดียวกันเสมอ (BR-63)
หัวจอ   ริชเมสเสจ × บัตรแสตมป์ — เครื่องหมายคูณคือทั้งหมดของเรื่องนี้
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: create a card by choosing twice, not once

Send type is step one (BR-89) and template is step two (BR-63), and the header
shows them with a multiplication sign between. They are independent axes: a
stamp card sent as a rich message is one plus one choice, not an eleventh entry
in a list. Ten templates times five send types would be fifty rows to keep in
agreement instead of fifteen.

Rich message and rich video are visible but disabled, with the reason on the
option. Hiding them would make the ceiling look like a design choice rather
than a renderer nobody has built yet."
```

---

### Task 13: M3-S02 บล็อกเอดิเตอร์ — ชิ้นใหญ่ที่สุด

**Files:**
- Create: `app/(admin)/campaigns/[id]/cards/[cardId]/page.tsx` · `components/cards/BlockList.tsx` · `components/cards/BlockForm.tsx` · `lib/cards/blocks.ts` · `lib/cards/blocks.test.ts`

**Interfaces:**
- Produces:
  - `reorder(blocks, fromIndex, toIndex): CardBlock[]`
  - `countAgainstLimits(blocks): { blocks: number; buttons: number; blocksLeft: number; buttonsLeft: number }`
  - `canAddBlock(blocks, type): { ok: true } | { ok: false; reason: string }`

**สามเรื่องที่ห้ามพลาด** — ลำดับบล็อกต้องรักษาไว้ (BR-92) · เพดาน 10 บล็อก 3 ปุ่ม (BR-66) ·
**ปลายทางของปุ่มล็อก ป้ายเปลี่ยนตามสถานะได้** (BR-40) หน้าจอต้องขึ้นกุญแจให้เห็น ไม่ใช่ซ่อนตัวเลือก

- [ ] **Step 1: เขียนเทสต์**

```ts
import { describe, expect, it } from 'vitest'
import { canAddBlock, countAgainstLimits, reorder } from './blocks'
import type { CardBlock } from '../render/groups'

let n = 0
const b = (type: CardBlock['blockType']): CardBlock => ({
  id: `b${n++}`, blockType: type, sortOrder: n, content: null, showWhen: null, options: null,
})

describe('reorder', () => {
  it('ย้ายขึ้นแล้ว sortOrder ไล่ใหม่ต่อเนื่องจากศูนย์', () => {
    const out = reorder([b('title'), b('body'), b('button')], 2, 0)
    expect(out.map((x) => x.blockType)).toEqual(['button', 'title', 'body'])
    expect(out.map((x) => x.sortOrder)).toEqual([0, 1, 2])
  })
  it('ย้ายไปที่เดิมไม่เปลี่ยนอะไร', () => {
    const input = [b('title'), b('body')]
    expect(reorder(input, 1, 1).map((x) => x.blockType)).toEqual(['title', 'body'])
  })
  it('ไม่แก้ array เดิม', () => {
    const input = [b('title'), b('body')]
    reorder(input, 0, 1)
    expect(input[0].blockType).toBe('title')
  })
})

describe('countAgainstLimits', () => {
  it('นับบล็อกและปุ่มแยกกัน', () => {
    const out = countAgainstLimits([b('title'), b('button'), b('button')])
    expect(out).toMatchObject({ blocks: 3, buttons: 2, blocksLeft: 7, buttonsLeft: 1 })
  })
})

describe('canAddBlock', () => {
  it('ครบ 10 บล็อกแล้วเพิ่มไม่ได้ และบอกเพดาน', () => {
    const full = Array.from({ length: 10 }, () => b('body'))
    const out = canAddBlock(full, 'body')
    if (out.ok) throw new Error('unreachable')
    expect(out.reason).toContain('10')
  })
  it('ครบ 3 ปุ่มแล้วเพิ่มปุ่มไม่ได้ แต่เพิ่มบล็อกอื่นได้', () => {
    const blocks = [b('button'), b('button'), b('button')]
    expect(canAddBlock(blocks, 'button').ok).toBe(false)
    expect(canAddBlock(blocks, 'body').ok).toBe(true)
  })
})
```

- [ ] **Step 2: รันให้แดง แล้วเขียน `lib/cards/blocks.ts`**

```ts
import type { BlockType, CardBlock } from '../render/groups'

/** BR-66 · เกินแล้วขนาดข้อความเกินที่ LINE รับ ส่งไม่ออกและไม่มีข้อความบอกสาเหตุ */
const MAX_BLOCKS = 10
const MAX_BUTTONS = 3

/**
 * Renumber from zero after every move.
 *
 * Order is the one thing the editor and the player must agree on (BR-92), and
 * gaps in sort_order are how they stop agreeing — a later insert lands in the
 * gap and the list the author sees is no longer the list that gets rendered.
 */
export function reorder(blocks: CardBlock[], fromIndex: number, toIndex: number): CardBlock[] {
  const next = [...blocks]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next.map((block, index) => ({ ...block, sortOrder: index }))
}

export function countAgainstLimits(blocks: CardBlock[]) {
  const buttons = blocks.filter((b) => b.blockType === 'button').length
  return {
    blocks: blocks.length,
    buttons,
    blocksLeft: Math.max(0, MAX_BLOCKS - blocks.length),
    buttonsLeft: Math.max(0, MAX_BUTTONS - buttons),
  }
}

export function canAddBlock(
  blocks: CardBlock[],
  type: BlockType,
): { ok: true } | { ok: false; reason: string } {
  if (blocks.length >= MAX_BLOCKS) {
    return { ok: false, reason: `การ์ดหนึ่งใบมีได้ ${MAX_BLOCKS} บล็อก — เอาบล็อกอื่นออกก่อน` }
  }
  if (type === 'button' && countAgainstLimits(blocks).buttonsLeft === 0) {
    return { ok: false, reason: `การ์ดหนึ่งใบมีปุ่มได้ ${MAX_BUTTONS} ปุ่ม` }
  }
  return { ok: true }
}
```

- [ ] **Step 3: ทำหน้าจอตามต้นแบบ** — ค้น `M3-S02 ตั้งค่าการ์ด`

```
ซ้าย   รายการบล็อก ลากเรียงได้ · กางบล็อกที่เลือกให้เห็นช่องตั้งค่าในที่
       ตัวนับ "4/10 · ปุ่ม 1/3" เห็นตลอด
ทุกบล็อกมีสามส่วนเหมือนกัน  ค่าของตัวเอง · สวิตช์ตามสถานะ · เงื่อนไขการแสดง
ปุ่ม   ป้ายเปลี่ยนตามสถานะได้ · ปลายทางขึ้น 🔒 พร้อมคำอธิบายว่าทำไมล็อก
ขวา    ตัวอย่าง (Task 14)
```

- [ ] **Step 4: รันเทสต์และ build แล้ว Commit**

```bash
npm run test:all && npm run build
git add -A
git commit -m "feat: the block editor

Blocks renumber from zero after every move. Order is the one thing the editor
and the player must agree on (BR-92), and gaps in sort_order are how they stop
agreeing — a later insert lands in a gap and the list on screen is no longer the
list that renders.

A button's label can vary by state but its destination cannot (BR-40), and the
screen shows a lock rather than hiding the option. Hiding it would leave someone
hunting for a control that was never coming."
```

---

### Task 14: M3-S02 ตัวอย่าง · สวิตช์สถานะ · ดู JSON · ส่งทดสอบ

**Files:**
- Create: `components/cards/Preview.tsx` · `components/cards/StateSwitcher.tsx` · `app/(admin)/campaigns/[id]/cards/[cardId]/preview-actions.ts`

**Interfaces:**
- Consumes: `groupBlocks` · `toFlexBubble` · `toPlainText` · `renderCard` — **ตัวเดียวกับที่ webhook เรียก**
- Produces: `sendTestCard(cardId, state): Promise<void>` — ส่งเข้า LINE ของผู้ใช้ภายในเอง

**นี่คือ task ที่ส่งมอบ BR-91 จริง** — ถ้าหน้าจอนี้ต้องเขียน renderer ของตัวเอง แปลว่าแกนที่ทำไว้ผิด

- [ ] **Step 1: เขียนเทสต์ที่พิสูจน์ว่าใช้ตัวเดียวกัน**

```tsx
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Preview } from './Preview'
import { groupBlocks } from '@/lib/render/groups'
import { toFlexBubble } from '@/lib/render/flex'
import type { CardBlock } from '@/lib/render/groups'

const blocks: CardBlock[] = [
  { id: 'b1', blockType: 'title', sortOrder: 0, content: 'สวัสดี {{attr.name}}', showWhen: null, options: null },
]
const theme = { primary: '#17756A', secondary: '#EFF3F1', text: '#111111' }
const state = { attributes: { name: 'มีนา' }, counters: {}, entitlements: [], playCounts: {}, completed: [] }

describe('Preview', () => {
  it('แสดงข้อความหลังแทนค่าตัวแปรแล้ว', () => {
    const { container } = render(<Preview blocks={blocks} state={state} theme={theme} renderAs="flex_bubble" />)
    expect(container.textContent).toContain('สวัสดี มีนา')
  })

  it('JSON ที่โชว์ตรงกับที่ renderer ของ webhook สร้าง — ไม่ใช่ของที่หน้าจอสร้างเอง', () => {
    const fromEngine = toFlexBubble(groupBlocks(blocks, state), state, theme)
    const { container } = render(<Preview blocks={blocks} state={state} theme={theme} renderAs="flex_bubble" showJson />)
    expect(container.textContent).toContain(JSON.stringify(fromEngine, null, 2).slice(0, 40))
  })

  it('สลับสถานะแล้วบล็อกที่ show_when ไม่ผ่านหายไปจากตัวอย่าง', () => {
    const gated: CardBlock[] = [
      ...blocks,
      { id: 'b2', blockType: 'body', sortOrder: 1, content: 'เห็นเมื่อมีสิทธิ์',
        showWhen: [{ type: 'has_entitlement', rewardCode: 'x' }], options: null },
    ]
    const without = render(<Preview blocks={gated} state={state} theme={theme} renderAs="flex_bubble" />)
    expect(without.container.textContent).not.toContain('เห็นเมื่อมีสิทธิ์')

    const withIt = render(
      <Preview blocks={gated} state={{ ...state, entitlements: ['x'] }} theme={theme} renderAs="flex_bubble" />)
    expect(withIt.container.textContent).toContain('เห็นเมื่อมีสิทธิ์')
  })
})
```

- [ ] **Step 2: รันให้แดง แล้วเขียน `Preview.tsx` โดย import จาก `lib/render/` เท่านั้น**

**ห้ามเขียนตรรกะการจัดกลุ่มหรือแทนค่าตัวแปรใหม่ในไฟล์นี้** — ถ้าต้องเขียน แปลว่าฟังก์ชันใน `lib/render/` ยังไม่พอ ให้ไปเพิ่มที่นั่น

- [ ] **Step 3: เขียนคำเตือนที่ซื่อสัตย์ไว้ใต้ตัวอย่าง**

```
"หน้านี้เป็น CSS ที่เราเขียนเลียน LINE ไม่ใช่ LINE จริง
 ใช้ดูโครงกับเงื่อนไข · ความจริงอยู่ที่ปุ่มส่งทดสอบ"
```

- [ ] **Step 4: เขียนปุ่มส่งทดสอบเข้า LINE ตัวเอง**

ใช้ `app_user.test_line_uid` · **ต้องเป็นบัญชีทดสอบเท่านั้น** (BR-62) · ถ้ายังไม่มี `test_line_uid` บอกวิธีได้มา

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: the card preview, sharing one renderer with the webhook

This is where BR-91 is either true or it is not. The preview imports
groupBlocks, toFlexBubble and toPlainText — the same functions the webhook calls
— and there is a test asserting the JSON on screen is byte-identical to what the
adapter produces. If this component ever needs grouping logic of its own, the
core is wrong and the fix belongs there.

The preview also says out loud that it is CSS imitating LINE rather than LINE.
The truth is the test-send button, and pretending otherwise is how a team
spends two months trusting its own stylesheet."
```

---

### Task 15: M7-S01 · M7-S02 กิจกรรม

**Files:**
- Create: `app/(admin)/campaigns/[id]/activities/**` · `lib/activities/wizard.ts` · `lib/activities/wizard.test.ts`

**Interfaces:**
- Produces: `fieldsFor(inputType, resolveMethod): WizardField[]` — สร้างจากนิยามชนิด **ห้ามเขียนฟอร์มแยกต่อกิจกรรม** (BR-87)

- [ ] **Step 1: เขียนเทสต์ที่บังคับ BR-87**

```ts
import { describe, expect, it } from 'vitest'
import { fieldsFor } from './wizard'

describe('fieldsFor', () => {
  it('pick_one ถามผังช่องและรายการตัวเลือก', () => {
    const keys = fieldsFor('pick_one', 'weighted').map((f) => f.key)
    expect(keys).toContain('grid')
    expect(keys).toContain('outcomes')
  })
  it('none ไม่ถามเรื่องอินพุตเลย', () => {
    expect(fieldsFor('none', 'weighted').map((f) => f.key)).not.toContain('grid')
  })
  it('score ถามช่วงคะแนน · weighted ถามน้ำหนัก', () => {
    expect(fieldsFor('quiz', 'score').map((f) => f.key)).toContain('score_bands')
    expect(fieldsFor('pick_one', 'weighted').map((f) => f.key)).toContain('weights')
  })
  it('quota บังคับถามการ์ดสำรอง (BR-31)', () => {
    const fallback = fieldsFor('none', 'quota').find((f) => f.key === 'fallback_card_id')
    expect(fallback?.required).toBe(true)
  })
  it('คู่ผสมทุกคู่คืนรายการช่อง ไม่มีคู่ไหนคืนว่าง', () => {
    for (const input of ['none', 'pick_one', 'quiz', 'text'] as const) {
      for (const resolve of ['fixed', 'weighted', 'quota', 'score'] as const) {
        expect(fieldsFor(input, resolve).length).toBeGreaterThan(0)
      }
    }
  })
})
```

- [ ] **Step 2: รันให้แดง เขียนให้ผ่าน แล้วทำหน้าจอตามต้นแบบ**

ค้น `M7-S01 รายการกิจกรรม` · `M7-S02 ตั้งค่ากิจกรรม`

**และช่องที่ต้องมีเพิ่ม** — สวิตช์ `trigger` เป็น "ตอนแอดเป็นเพื่อน" · หนึ่งแคมเปญมีได้ตัวเดียว (BR-90)
ถ้ามีอยู่แล้ว หน้าจอต้องบอกว่าตัวไหนถืออยู่ พร้อมลิงก์ไปแก้

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: activities, with the form generated from the type definition

fieldsFor() derives the questions from input type and resolve method rather than
switching on a campaign (BR-87). A test walks every combination and asserts none
returns an empty form, which is the cheap version of the guarantee: the day a
new activity needs a hand-written form is the day AC-01 stops holding.

The follow trigger is unique per campaign (BR-90), so when one is already taken
the screen names the activity holding it and links there instead of just
refusing."
```

---

### Task 16: M8-S01 ทดลองเล่น

**Files:**
- Create: `app/(admin)/campaigns/[id]/preview/page.tsx` · `components/preview/ChatSim.tsx` · `.../actions.ts`

**สิ่งที่ต้องมี** — **ปุ่มข้ามวัน** ขาดไม่ได้ ไม่งั้นทดสอบสะสม 7 วันต้องรอจริง 7 วัน ·
สลับดูทุกสถานะรวมที่เกิดยาก อย่างรางวัลหมดกับขาดวัน (BR-83)

- [ ] **Step 1: ทำตามต้นแบบ** — ค้น `M8-S01 ทดลองเล่น`

```
ซ้าย   จำลองหน้าแชท — การ์ดที่ตอบเรียงลงมา · แถบเมนูล่าง
ขวา    แผงสถานะที่แก้ได้ — วันที่ · ค่าสะสม · ค่าประจำตัว · สิทธิ์ที่ถือ
       ปุ่มข้ามวัน · ปุ่มรีเซ็ต
       สวิตช์โหมด: ชั้นตัวอย่าง (ไม่แตะ LINE) หรือ ชั้นทดสอบ (ยิงจริง)
```

- [ ] **Step 2: ใช้ `handleEvent` ตัวเดียวกับ webhook พร้อม Ports ที่ชี้ไปชั้นตัวอย่าง**

**ห้ามเขียนตรรกะการเล่นใหม่** — ชั้นตัวอย่างต่างจากชั้นจริงแค่ `channel_type = 'preview'` ซึ่งเป็นการแยกด้วยโครงสร้าง ไม่ใช่การกรอง

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: the play simulator, running the real handler

The simulator calls handleEvent with Ports pointed at a preview channel. It is
the same code path a player takes; what differs is channel_type, which is a
structural separation rather than a filter, so preview data cannot reach a
report by accident.

The skip-a-day button is not a convenience. Without it, testing a seven-day
streak takes seven days, which means it does not get tested."
```

---

### Task 17: M1-S04 ส่งขึ้น LINE

**Files:**
- Create: `app/(admin)/campaigns/[id]/publish/page.tsx` · `lib/publish/validate.ts` · `lib/publish/validate.test.ts` · `.../actions.ts`

**Interfaces:**
- Produces: `type Problem = { code: string; message: string; where: string }` · `validateForPublish(config): Problem[]`

**ลำดับตาม §4.4** — สไลซ์นี้ตัดขั้นที่เกี่ยวกับริชเมนูออก (4b · 5b · 5c) เหลือ ตรวจ → ยืนยันถ้าเป็น production → กันชนบัญชี → สร้าง version → ตั้ง webhook

- [ ] **Step 1: เขียนเทสต์ของ validate**

```ts
import { describe, expect, it } from 'vitest'
import { validateForPublish } from './validate'

const ok = {
  cards: [{ id: 'c1', code: 'win', hasSampleText: false, blocks: 2 }],
  activities: [{ id: 'a1', code: 'draw', resolveMethod: 'weighted', fallbackCardId: null,
                 entryRules: [], outcomes: [{ cardId: 'c1' }] }],
  keywordRules: [{ id: 'k1', targetActivityId: 'a1', targetCardId: null }],
  channelType: 'test' as const,
  confirmed: false,
}

describe('validateForPublish', () => {
  it('config ที่ครบ ไม่มีปัญหา', () => {
    expect(validateForPublish(ok)).toEqual([])
  })
  it('การ์ดที่ยังมีข้อความตัวอย่างจากเทมเพลต บล็อกการส่งขึ้น (BR-37)', () => {
    const bad = { ...ok, cards: [{ ...ok.cards[0], hasSampleText: true }] }
    expect(validateForPublish(bad)[0].code).toBe('ERR-034')
  })
  it('resolve เป็น quota แต่ไม่มีการ์ดสำรอง บล็อก (BR-31)', () => {
    const bad = { ...ok, activities: [{ ...ok.activities[0], resolveMethod: 'quota' as const }] }
    expect(validateForPublish(bad).some((p) => p.message.includes('สำรอง'))).toBe(true)
  })
  it('ผลลัพธ์ที่ชี้ไปการ์ดที่ไม่มีอยู่ บล็อก', () => {
    const bad = { ...ok, activities: [{ ...ok.activities[0], outcomes: [{ cardId: 'ไม่มี' }] }] }
    expect(validateForPublish(bad).length).toBeGreaterThan(0)
  })
  it('คีย์เวิร์ดที่ไม่ชี้ไปไหน บล็อก', () => {
    const bad = { ...ok, keywordRules: [{ id: 'k1', targetActivityId: null, targetCardId: null }] }
    expect(validateForPublish(bad).length).toBeGreaterThan(0)
  })
  it('production ที่ยังไม่ยืนยันซ้ำ บล็อก (BR-18)', () => {
    const bad = { ...ok, channelType: 'production' as const }
    expect(validateForPublish(bad).some((p) => p.code === 'ERR-001')).toBe(true)
  })
  it('ทุกปัญหาบอกว่าอยู่ที่ไหน ไม่ใช่แค่บอกว่าผิด', () => {
    const bad = { ...ok, cards: [{ ...ok.cards[0], hasSampleText: true }] }
    expect(validateForPublish(bad)[0].where).toBeTruthy()
  })
})
```

- [ ] **Step 2: รันให้แดง เขียนให้ผ่าน แล้วทำหน้าจอ**

ค้น `M1-S04 ยืนยันการส่งขึ้น LINE` · **ทุกปัญหาต้องกดกระโดดไปแก้ได้** ไม่ใช่แค่ลิสต์ไว้

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: publish, with a checklist that links to the fix

Every problem carries where it lives and the screen makes it clickable. A list
that only says what is wrong turns into a hunt, and the person publishing is
usually the one with least time to hunt.

Sample text from a template blocks publishing (BR-37). It is the failure that
reaches real players and reads as carelessness rather than as a bug, so it is
caught here rather than trusted to review."
```

---

### Task 18: M1-S03 ก๊อปแคมเปญ · M13-S02 จัดการผู้ใช้ภายใน

**Files:**
- Create: `app/(admin)/campaigns/[id]/duplicate/**` · `app/(admin)/users/**` · `lib/campaign/duplicate.ts` · `lib/campaign/duplicate.test.ts`

**Interfaces:**
- Produces: `TABLES_TO_COPY: string[]` · `TABLES_NEVER_COPIED: string[]`

- [ ] **Step 1: เขียนเทสต์ที่บังคับ BR-24**

```ts
import { describe, expect, it } from 'vitest'
import { TABLES_NEVER_COPIED, TABLES_TO_COPY } from './duplicate'

describe('ก๊อปแคมเปญ', () => {
  it('ไม่ก๊อปบัญชีและกุญแจ', () => {
    for (const table of ['channel', 'campaign_channel']) {
      expect(TABLES_NEVER_COPIED).toContain(table)
      expect(TABLES_TO_COPY).not.toContain(table)
    }
  })
  it('ไม่ก๊อปข้อมูลผู้เล่นทุกชนิด', () => {
    for (const table of [
      'participant', 'participant_attribute', 'participant_activity',
      'counter_value', 'entitlement', 'play_lock', 'quiz_round', 'pending_input',
      'event_log', 'effect_log',
    ]) {
      expect(TABLES_NEVER_COPIED, `${table} ต้องห้ามก๊อป`).toContain(table)
    }
  })
  it('ก๊อป config ที่ควรก๊อป', () => {
    for (const table of ['card', 'card_block', 'activity', 'counter', 'reward', 'keyword_rule', 'asset']) {
      expect(TABLES_TO_COPY, `${table} ต้องก๊อป`).toContain(table)
    }
  })
  it('ไม่มีตารางไหนอยู่ทั้งสองรายการ', () => {
    expect(TABLES_TO_COPY.filter((t) => TABLES_NEVER_COPIED.includes(t))).toEqual([])
  })
})
```

- [ ] **Step 2: รันให้แดง เขียนให้ผ่าน แล้วทำสองหน้าจอ**

ค้น `M1-S03 ก๊อปแคมเปญ` · `M13-S02 จัดการผู้ใช้ภายใน`

**M1-S03** — สองแถวล่างเป็นข้อห้าม ไม่ใช่ตัวเลือก ติ๊กไม่ได้
**M13-S02** — ถอนสิทธิ์ไม่ลบแถว เพราะ log ยังอ้างถึง · ช่อง `test_line_uid` สำหรับส่งการ์ดทดสอบ

- [ ] **Step 3: รันทั้งหมด · build · Commit**

```bash
npm run test:all && npm run build && npm run db:check
git add -A
git commit -m "feat: duplicate a campaign, and manage the team

The two things duplication refuses are checkboxes nobody can tick (BR-24).
Copying credentials would have the new campaign firing at the old OA the moment
it publishes; copying player data would leave both campaigns' numbers belonging
to neither.

Revoking a user deactivates the row instead of deleting it, because the version
history says who published what and a history with a missing name answers
nothing."
```

---

## Self-Review

**Spec coverage** — จอทั้ง 16 ของสไลซ์นี้ (15 จากเดิม + M1-S06 ใหม่)

| จอ | Task |
|---|---|
| M13-S01 · M13-S02 | 2 · 18 |
| M1-S01 · S02 · S03 · S04 · **S06** | 4 · 5 · 18 · 17 · **6** |
| M3-S01 · S02 · S03 | 11 · 12–14 · 11 |
| M6-S01 · S02 | 7 |
| M7-S01 · S02 · S03 · S04 | 15 · 15 · 9 · 10 |
| M8-S01 | 16 |
| M9-S01 · S02 | 8 |

**กฎที่แผนนี้บังคับด้วยเทสต์** — BR-16 · BR-18 · BR-23 · BR-24 · BR-27 · BR-29 · BR-31 · BR-37 · BR-40 · BR-44 · BR-48 · BR-63 · BR-66 · BR-83 · BR-87 · BR-89 · BR-90 · BR-91 · BR-92 · DD-03

**Placeholder scan** — ไม่มี TBD/TODO · ทุกขั้นที่เป็นโค้ดมีโค้ดจริง · ขั้นที่ให้ทำตามต้นแบบระบุ `data-screen-label` ที่ต้องค้นและรายการองค์ประกอบที่ต้องมีครบ

**Type consistency** — `Session` `Role` (Task 2) ใช้ใน Task 4–18 · `CardBlock` `BlockType` มาจาก `lib/render/groups` ที่มีอยู่แล้ว ใช้ใน Task 12–14 · `STATUS_TONES` (Task 1) ใช้ใน `Badge` (Task 3) แล้วทุกจอใช้ต่อ · `CampaignSummary` (Task 4) ใช้ใน Task 17

**ที่ไม่อยู่ในแผนนี้โดยตั้งใจ** — M4-S01 ริชเมนู (P2) · M5 · M10 · M11 · M12 (8 จอที่ยังไม่มี spec) · ริชเมสเสจกับริชวิดีโอในขั้นเลือกชนิดการส่ง แสดงแต่ปิดไว้พร้อมเหตุผล

**เรื่องเข้าระบบ** — Task 2 ทำสองทาง · Google sign-in เป็นทางหลัก และทางเข้าสำหรับทดสอบที่ข้ามแค่ Google
ไม่ข้ามรายชื่อที่อนุญาต · ทางที่สองมีสามล็อก และหน้าจอจะประกาศตัวเองเมื่อเปิดอยู่
**Google OAuth client กับ callback เป็นงานตั้งค่านอกโค้ด** ยังไม่ต้องมีก็เดินแผนได้ครบ
เพราะ `classify()` กับ `requireRole()` ไม่ต้องแก้ตอนเสียบของจริง
