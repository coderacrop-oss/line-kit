# LINE OA Fortune Cookie Game — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้างเกมคุกกี้เสี่ยงทายใน LINE OA ที่เล่นจบในแชท — ส่งตาราง 3×3 ให้ผู้ใช้แตะเลือก 1 ชิ้น แล้วตอบคำทำนายที่ผูกกับชิ้นนั้น

**Architecture:** Stateless ทั้งระบบ คำทำนายทั้ง 9 ใบถูกสุ่มตอนสร้างการ์ดตาราง แล้วฝัง id ไว้ใน `postback.data` ของแต่ละไทล์ เซิร์ฟเวอร์จึงไม่ต้องจำอะไรระหว่างสองข้อความ ตรรกะเกมทั้งหมดเป็น pure function แยกออกจาก `lib/line/client.ts` ซึ่งเป็นจุดเดียวในระบบที่ออกเน็ตเวิร์ก ทำให้เทสต์ครบทุกพฤติกรรมได้โดยไม่ต้องต่อ LINE จริง

**Tech Stack:** Next.js 15 (App Router) · TypeScript strict · Vitest · Vercel Hobby · LINE Messaging API เรียกผ่าน `fetch` ตรง ๆ (ไม่ใช้ SDK)

**Spec:** `docs/superpowers/specs/2026-08-07-line-fortune-cookie-design.md`

---

## Global Constraints

ข้อกำหนดต่อไปนี้ใช้กับทุก Task โดยไม่ต้องเขียนซ้ำ

- **ห้ามใช้ LINE Push API / Multicast / Broadcast เด็ดขาด** ทุกการตอบกลับต้องผ่าน Reply API ด้วย `replyToken` เท่านั้น — push มีค่าใช้จ่าย reply ฟรีไม่จำกัด
- **ห้ามเพิ่ม dependency ที่ไม่ได้ระบุในแผนนี้** ทุกอย่างต้องอยู่ในแผนฟรี dependency ทั้งหมดคือ `next`, `react`, `react-dom` และ dev คือ `typescript`, `vitest`, `@types/node`, `@types/react`
- **ห้าม commit ค่า `LINE_CHANNEL_SECRET` หรือ `LINE_CHANNEL_ACCESS_TOKEN` ลง repo** ค่าจริงอยู่ใน `.env.local` (gitignore แล้ว) และ Vercel dashboard เท่านั้น
- **ห้ามเพิ่ม database, session store, หรือ in-memory cache ใด ๆ** ระบบต้อง stateless 100%
- **`Fortune.id` ห้ามเปลี่ยนหลังกำหนดแล้ว** เพราะการ์ดตารางเก่าที่ค้างในแชทอ้างอิง id เดิม
- ข้อความที่ผู้ใช้เห็นทั้งหมดเป็น **ภาษาไทย** ส่วนชื่อตัวแปร ฟังก์ชัน และคอมเมนต์ในโค้ดเป็น **ภาษาอังกฤษ**
- ไฟล์เทสต์วางไว้ **ข้าง ๆ ไฟล์ต้นฉบับ** เช่น `lib/game/draw.ts` คู่กับ `lib/game/draw.test.ts`
- ทุกคอมมิตปิดท้ายด้วยบรรทัด `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` ตามรูปแบบ heredoc ที่แสดงในทุก Task
- ก่อนคอมมิตทุกครั้ง ต้องผ่าน `npm test` และ `npm run typecheck`

---

## File Structure

| ไฟล์ | หน้าที่ | Task |
|---|---|---|
| `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts` | scaffold และ config | 1 |
| `app/layout.tsx`, `app/page.tsx` | หน้า landing ง่าย ๆ ไว้เช็กว่า deploy ติด | 1 |
| `lib/game/fortunes.ts` | คลังคำทำนาย 60 ใบ + type `Fortune`, `Tone` | 2 |
| `lib/game/draw.ts` | สุ่มคำทำนาย 9 ใบ / สุ่ม 1 ใบ (pure, รับ rng) | 3 |
| `lib/test-utils/rng.ts` | seeded rng สำหรับเทสต์ | 3 |
| `lib/game/postback.ts` | encode / decode `postback.data` | 4 |
| `lib/flex/types.ts` | type ของ Flex Message | 5 |
| `lib/flex/theme.ts` | สี ป้ายโทน ค่าคงที่งานดีไซน์ | 5 |
| `lib/flex/grid.ts` | การ์ดตาราง 3×3 | 5 |
| `lib/flex/fortune.ts` | การ์ดคำทำนาย | 6 |
| `lib/flex/prompt.ts` | การ์ดต้อนรับ + การ์ดใบ้วิธีเล่น | 7 |
| `lib/line/types.ts` | type ของ webhook event | 8 |
| `lib/game/handler.ts` | event → ข้อความที่จะตอบ (pure) | 8 |
| `lib/line/verify.ts` | ตรวจ `x-line-signature` | 9 |
| `lib/line/client.ts` | เรียก Reply API + อ่าน env | 10 |
| `app/api/line/webhook/route.ts` | จุดรับ webhook ประกอบทุกชิ้นเข้าด้วยกัน | 11 |
| `README.md`, `.env.example` | คู่มือสมัคร LINE OA และ deploy | 12 |

---

## Task 1: Scaffold โปรเจกต์และ test runner

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`
- Create: `app/layout.tsx`, `app/page.tsx`

**Interfaces:**
- Consumes: ไม่มี (task แรก)
- Produces: คำสั่ง `npm test`, `npm run typecheck`, `npm run build` และ path alias `@/` ที่ชี้ไปรากโปรเจกต์ ใช้ได้ทั้งใน Next และ Vitest

- [ ] **Step 1: สร้าง `package.json`**

```json
{
  "name": "line-kit",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^15.5.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.15.0",
    "@types/react": "^19.1.0",
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 2: สร้าง `tsconfig.json`**

`strict: true` เป็นข้อบังคับ — โค้ดทั้งโปรเจกต์พึ่งพา null safety ของ TypeScript ในการตรวจจับ postback data ที่หายไป

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: สร้าง `next.config.ts`**

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {}

export default nextConfig
```

- [ ] **Step 4: สร้าง `vitest.config.ts`**

`resolve.alias` จำเป็น เพราะ Vitest ไม่ได้อ่าน `paths` จาก tsconfig เอง การตั้งตรงนี้ทำให้ไม่ต้องลง `vite-tsconfig-paths` เพิ่ม

```ts
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
```

- [ ] **Step 5: สร้าง `app/layout.tsx`**

```tsx
import type { ReactNode } from 'react'

export const metadata = {
  title: 'LINE Fortune Cookie',
  description: 'LINE OA fortune cookie game',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 6: สร้าง `app/page.tsx`**

หน้านี้มีไว้เปิดในเบราว์เซอร์เพื่อยืนยันว่า deploy สำเร็จ ก่อนไปไล่หาปัญหาที่ webhook

```tsx
export default function Page() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 40, lineHeight: 1.6 }}>
      <h1>🥠 LINE Fortune Cookie</h1>
      <p>Bot is running. Webhook endpoint: <code>/api/line/webhook</code></p>
    </main>
  )
}
```

- [ ] **Step 7: ติดตั้ง dependencies**

Run: `npm install`
Expected: ติดตั้งสำเร็จ เกิดโฟลเดอร์ `node_modules/` และไฟล์ `package-lock.json`

- [ ] **Step 8: ยืนยันว่า test runner ทำงาน**

Run: `npx vitest run --passWithNoTests`
Expected: PASS — ขึ้น "No test files found" แล้วจบด้วย exit code 0
(ใช้ `--passWithNoTests` เฉพาะ Task นี้เท่านั้น เพราะยังไม่มีเทสต์ ตั้งแต่ Task 2 ไปใช้ `npm test` ปกติ)

- [ ] **Step 9: ยืนยันว่า typecheck และ build ผ่าน**

Run: `npm run typecheck && npm run build`
Expected: typecheck ไม่มี error และ build สำเร็จ ขึ้นรายการ route มี `/` และไม่มี error

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts vitest.config.ts app/
git commit -F - <<'EOF'
chore: scaffold Next.js app with TypeScript and Vitest

Hand-written scaffold instead of create-next-app so the dependency set
stays minimal: no ESLint, no Tailwind, no LINE SDK. Vitest resolves the
@/ alias through resolve.alias so no extra tsconfig-paths plugin is needed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: คลังคำทำนาย 60 ใบ

**Files:**
- Create: `lib/game/fortunes.ts`
- Test: `lib/game/fortunes.test.ts`

**Interfaces:**
- Consumes: ไม่มี
- Produces:
  - `type Tone = 'daily' | 'funny' | 'inspire'`
  - `interface Fortune { id: number; tone: Tone; text: string }`
  - `const FORTUNES: readonly Fortune[]` — 60 ใบ โทนละ 20
  - `const TONES: readonly Tone[]` — `['daily', 'funny', 'inspire']`
  - `function findFortune(id: number): Fortune | undefined`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `lib/game/fortunes.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { FORTUNES, TONES, findFortune } from './fortunes'

describe('FORTUNES catalog', () => {
  it('has exactly 60 fortunes', () => {
    expect(FORTUNES).toHaveLength(60)
  })

  it('has unique ids', () => {
    const ids = FORTUNES.map((fortune) => fortune.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has 20 fortunes per tone', () => {
    for (const tone of TONES) {
      expect(FORTUNES.filter((fortune) => fortune.tone === tone)).toHaveLength(20)
    }
  })

  it('has non-empty text everywhere', () => {
    for (const fortune of FORTUNES) {
      expect(fortune.text.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('findFortune', () => {
  it('returns the fortune matching the id', () => {
    expect(findFortune(1)?.id).toBe(1)
  })

  it('returns undefined for an id that does not exist', () => {
    expect(findFortune(9999)).toBeUndefined()
  })
})
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run lib/game/fortunes.test.ts`
Expected: FAIL — resolve module `./fortunes` ไม่ได้

- [ ] **Step 3: สร้าง `lib/game/fortunes.ts`**

```ts
export type Tone = 'daily' | 'funny' | 'inspire'

export interface Fortune {
  /** Stable identifier embedded in postback data. Never reuse or change. */
  id: number
  tone: Tone
  text: string
}

export const TONES: readonly Tone[] = ['daily', 'funny', 'inspire']

export const FORTUNES: readonly Fortune[] = [
  { id: 1, tone: 'daily', text: 'วันนี้มีคนคิดถึงคุณอยู่ แต่เขาขี้อายเกินจะทักมาก่อน' },
  { id: 2, tone: 'daily', text: 'ช่วงบ่ายจะมีเรื่องดีเล็ก ๆ แทรกเข้ามา อย่าเพิ่งรีบปิดโทรศัพท์' },
  { id: 3, tone: 'daily', text: 'ดวงการเดินทางวันนี้ราบรื่น ออกจากบ้านเร็วขึ้นสิบนาทีจะดีมาก' },
  { id: 4, tone: 'daily', text: 'วันนี้เหมาะกับการเริ่มเรื่องที่ดองไว้ ไม่ต้องทำให้เสร็จ แค่เริ่มก็พอ' },
  { id: 5, tone: 'daily', text: 'มีข่าวดีรออยู่ปลายสัปดาห์ ตอนนี้ทำวันนี้ให้ดีไปก่อน' },
  { id: 6, tone: 'daily', text: 'วันนี้คนที่ใส่เสื้อสีอ่อนจะนำโชคมาให้คุณ' },
  { id: 7, tone: 'daily', text: 'ระวังของหายเล็กน้อย เช็กกระเป๋าก่อนลุกทุกครั้ง' },
  { id: 8, tone: 'daily', text: 'บทสนทนาสั้น ๆ วันนี้จะเปลี่ยนความคิดคุณบางอย่าง' },
  { id: 9, tone: 'daily', text: 'ดวงการเงินนิ่ง ๆ ไม่เข้าไม่ออก ถือว่าปลอดภัยดี' },
  { id: 10, tone: 'daily', text: 'วันนี้เหมาะกับการปฏิเสธ สิ่งที่คุณไม่อยากทำ ไม่ต้องรับไว้' },
  { id: 11, tone: 'daily', text: 'มีคนกำลังจะขอความช่วยเหลือจากคุณ ช่วยเท่าที่ไหวก็พอ' },
  { id: 12, tone: 'daily', text: 'เลขที่คุณเห็นซ้ำ ๆ วันนี้ ไม่ใช่เรื่องบังเอิญ' },
  { id: 13, tone: 'daily', text: 'ดวงสุขภาพเตือนให้ดื่มน้ำมากกว่าเมื่อวาน แค่นั้นจริง ๆ' },
  { id: 14, tone: 'daily', text: 'ของที่หาไม่เจอมานาน จะโผล่มาในที่ที่คุณหาไปแล้ว' },
  { id: 15, tone: 'daily', text: 'ช่วงเย็นเหมาะกับการเก็บตัว พรุ่งนี้ค่อยลุยเต็มที่' },
  { id: 16, tone: 'daily', text: 'คนใกล้ตัวจะพูดอะไรที่ฟังดูธรรมดา แต่คุณจะจำไปอีกนาน' },
  { id: 17, tone: 'daily', text: 'วันนี้ทำอะไรช้าลงหนึ่งจังหวะ แล้วจะพลาดน้อยลงสามเรื่อง' },
  { id: 18, tone: 'daily', text: 'มีโอกาสเข้ามาแบบไม่ทันตั้งตัว ตอบรับไปก่อน คิดทีหลังได้' },
  { id: 19, tone: 'daily', text: 'ดวงความรักวันนี้ขึ้นอยู่กับว่าคุณกดส่งข้อความนั้นหรือเปล่า' },
  { id: 20, tone: 'daily', text: 'วันนี้เป็นวันธรรมดา และวันธรรมดาก็เป็นวันที่ดีได้' },

  { id: 21, tone: 'funny', text: 'ดวงการเงินวันนี้ดีมาก ถ้าคุณไม่เปิดแอปช้อปปิ้ง' },
  { id: 22, tone: 'funny', text: 'วันนี้คุณจะได้พักผ่อน ทันทีที่ทำงานเสร็จ ซึ่งก็คือไม่ได้พัก' },
  { id: 23, tone: 'funny', text: 'โชคชะตาบอกว่าคุณควรนอนเร็ว โชคชะตาก็รู้ว่าคุณจะไม่ทำ' },
  { id: 24, tone: 'funny', text: 'วันนี้เหมาะกับการออกกำลังกาย พรุ่งนี้ก็เหมาะ มะรืนก็เหมาะ' },
  { id: 25, tone: 'funny', text: 'คุกกี้ใบนี้บอกว่าคุณหิว ไปกินข้าวก่อนแล้วค่อยกลับมา' },
  { id: 26, tone: 'funny', text: 'ดวงชะตาเผยว่ามีคนแอบชอบคุณ แต่ขอสงวนสิทธิ์ไม่บอกว่าใคร' },
  { id: 27, tone: 'funny', text: 'วันนี้คุณจะพูดคำว่า "อีกแป๊บเดียว" ประมาณสิบสองครั้ง' },
  { id: 28, tone: 'funny', text: 'ดวงบอกว่าคุณจะรวย แต่ไม่ได้บอกว่าปีไหน' },
  { id: 29, tone: 'funny', text: 'วันนี้จะมีคนเห็นด้วยกับคุณ อาจจะเป็นตัวคุณเองในกระจก' },
  { id: 30, tone: 'funny', text: 'ตะกร้าสินค้าของคุณกำลังส่งเสียงเรียก อย่าไปฟังมัน' },
  { id: 31, tone: 'funny', text: 'ดวงการงานวันนี้ดี ตราบใดที่ยังไม่มีใครถามว่าเสร็จหรือยัง' },
  { id: 32, tone: 'funny', text: 'วันนี้เหมาะจะทำสิ่งที่ผัดไว้ตั้งแต่ปีที่แล้ว แต่ผัดต่อก็ไม่ว่ากัน' },
  { id: 33, tone: 'funny', text: 'โชคชะตาส่งสัญญาณให้คุณลุกไปยืดเส้นยืดสาย ใช่ ตอนนี้แหละ' },
  { id: 34, tone: 'funny', text: 'วันนี้คุณจะเจอคนที่เข้าใจคุณ ถ้าไม่เจอ พรุ่งนี้ค่อยลองใหม่' },
  { id: 35, tone: 'funny', text: 'ดวงบอกว่าอย่าเพิ่งสั่งชานมแก้วที่สอง แต่ดวงก็ไม่ใช่คนจ่าย' },
  { id: 36, tone: 'funny', text: 'วันนี้เหมาะกับการเคลียร์กล่องข้อความ ทั้งในมือถือและในใจ' },
  { id: 37, tone: 'funny', text: 'คุณกำลังจะเลื่อนหน้าจอต่อ ทั้งที่เพิ่งบอกตัวเองว่าจะเลิกเลื่อน' },
  { id: 38, tone: 'funny', text: 'ห้ามตอบแชทตอนง่วง คุณจะพิมพ์อะไรที่พรุ่งนี้จำไม่ได้' },
  { id: 39, tone: 'funny', text: 'วันนี้จะมีคนชมคุณ ถ้าไม่มี ชมตัวเองไปก่อนก็ได้' },
  { id: 40, tone: 'funny', text: 'โชคชะตาบอกว่าถึงเวลาซักผ้าแล้ว โชคชะตาไม่ได้พูดเล่น' },

  { id: 41, tone: 'inspire', text: 'สิ่งที่คุณทำอยู่ยังไม่เห็นผล ไม่ได้แปลว่ามันไม่ได้ผล' },
  { id: 42, tone: 'inspire', text: 'คุณไม่ต้องเก่งที่สุดในห้อง แค่ไม่หยุดอยู่ที่เดิมก็พอ' },
  { id: 43, tone: 'inspire', text: 'วันที่รู้สึกว่าไม่ได้ทำอะไรเลย คือวันที่คุณกำลังพัก และการพักก็นับ' },
  { id: 44, tone: 'inspire', text: 'เปรียบเทียบตัวเองกับเมื่อปีที่แล้ว ไม่ใช่กับคนอื่นเมื่อวานนี้' },
  { id: 45, tone: 'inspire', text: 'เริ่มช้าดีกว่าไม่เริ่ม และไม่มีใครจำได้ว่าคุณเริ่มตอนไหน' },
  { id: 46, tone: 'inspire', text: 'ความกลัวส่วนใหญ่ของคุณ จะไม่เกิดขึ้นจริงสักเรื่อง' },
  { id: 47, tone: 'inspire', text: 'คุณผ่านวันที่คิดว่าผ่านไม่ได้มาแล้วหลายวัน วันนี้ก็เหมือนกัน' },
  { id: 48, tone: 'inspire', text: 'ขอความช่วยเหลือไม่ใช่ความอ่อนแอ มันคือทางลัดที่คนเก่งใช้กัน' },
  { id: 49, tone: 'inspire', text: 'สิ่งเล็ก ๆ ที่ทำทุกวัน ชนะสิ่งใหญ่ ๆ ที่ทำวันเดียวเสมอ' },
  { id: 50, tone: 'inspire', text: 'คุณไม่จำเป็นต้องอธิบายทุกการตัดสินใจให้ทุกคนเข้าใจ' },
  { id: 51, tone: 'inspire', text: 'ความผิดพลาดวันนี้ คือข้อมูลที่คุณยังไม่มีเมื่อวาน' },
  { id: 52, tone: 'inspire', text: 'ถ้ายังไม่รู้ว่าจะไปทางไหน เดินต่อไปก่อน ทางจะชัดขึ้นเอง' },
  { id: 53, tone: 'inspire', text: 'คนที่คุณชื่นชม ก็เคยยืนอยู่จุดเดียวกับที่คุณยืนอยู่ตอนนี้' },
  { id: 54, tone: 'inspire', text: 'พักได้ แต่อย่าเลิก ระยะทางไม่ได้วัดจากความเร็ว' },
  { id: 55, tone: 'inspire', text: 'คุณใจดีกับคนอื่นมามากพอแล้ว ลองใจดีกับตัวเองบ้าง' },
  { id: 56, tone: 'inspire', text: 'สิ่งที่ยังไม่เกิด ยังไม่ต้องกังวลก็ได้ วันนี้พอแล้วสำหรับวันนี้' },
  { id: 57, tone: 'inspire', text: 'การเปลี่ยนใจไม่ใช่ความไม่แน่นอน แต่คือการที่คุณรู้มากขึ้นกว่าเดิม' },
  { id: 58, tone: 'inspire', text: 'ไม่มีใครมองคุณละเอียดเท่าที่คุณกลัวว่าเขาจะมอง' },
  { id: 59, tone: 'inspire', text: 'ความสำเร็จที่ไม่มีใครเห็น ก็ยังเป็นความสำเร็จอยู่ดี' },
  { id: 60, tone: 'inspire', text: 'วันนี้คุณทำได้ดีแล้ว แม้จะยังไม่รู้สึกแบบนั้นก็ตาม' },
]

export function findFortune(id: number): Fortune | undefined {
  return FORTUNES.find((fortune) => fortune.id === id)
}
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `npm test`
Expected: PASS ทั้ง 6 เทสต์

- [ ] **Step 5: Commit**

```bash
git add lib/game/fortunes.ts lib/game/fortunes.test.ts
git commit -F - <<'EOF'
feat: add fortune catalog with 60 entries across three tones

Ids are stable and never reused: grid cards already sent to users embed
these ids in their postback payload, so changing an id would repoint an
old card at different text.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: สุ่มคำทำนาย

**Files:**
- Create: `lib/game/draw.ts`
- Create: `lib/test-utils/rng.ts`
- Test: `lib/game/draw.test.ts`

**Interfaces:**
- Consumes: `FORTUNES`, `TONES`, `type Fortune`, `type Tone` จาก `lib/game/fortunes.ts`
- Produces:
  - `const GRID_SIZE = 9`
  - `function drawNine(rng?: () => number): Fortune[]` — คืน 9 ใบไม่ซ้ำ โทนละ 3 สับตำแหน่งแล้ว
  - `function randomFortune(rng?: () => number): Fortune`
  - `function seededRng(seed: number): () => number` จาก `lib/test-utils/rng.ts`

- [ ] **Step 1: สร้าง seeded rng สำหรับเทสต์**

สร้าง `lib/test-utils/rng.ts` — เป็น linear congruential generator ธรรมดา ไม่ได้ต้องการคุณภาพการสุ่ม
ต้องการแค่ว่า seed เดิมให้ลำดับเดิมเสมอ เพื่อให้เทสต์ตรวจผลได้แน่นอน

```ts
/** Deterministic pseudo-random generator for tests. Same seed, same sequence. */
export function seededRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}
```

- [ ] **Step 2: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `lib/game/draw.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { seededRng } from '../test-utils/rng'
import { FORTUNES, TONES } from './fortunes'
import { GRID_SIZE, drawNine, randomFortune } from './draw'

describe('drawNine', () => {
  it('returns exactly nine fortunes', () => {
    expect(drawNine(seededRng(1))).toHaveLength(GRID_SIZE)
  })

  it('never repeats a fortune within one draw', () => {
    const ids = drawNine(seededRng(2)).map((fortune) => fortune.id)
    expect(new Set(ids).size).toBe(GRID_SIZE)
  })

  it('always includes three fortunes of every tone', () => {
    for (let seed = 0; seed < 25; seed += 1) {
      const drawn = drawNine(seededRng(seed))
      for (const tone of TONES) {
        expect(drawn.filter((fortune) => fortune.tone === tone)).toHaveLength(3)
      }
    }
  })

  it('is deterministic for a given seed', () => {
    const first = drawNine(seededRng(7)).map((fortune) => fortune.id)
    const second = drawNine(seededRng(7)).map((fortune) => fortune.id)
    expect(first).toEqual(second)
  })

  it('does not always return tones in the same order', () => {
    const toneOrders = new Set(
      Array.from({ length: 20 }, (_, seed) =>
        drawNine(seededRng(seed))
          .map((fortune) => fortune.tone)
          .join(','),
      ),
    )
    expect(toneOrders.size).toBeGreaterThan(1)
  })
})

describe('randomFortune', () => {
  it('returns a fortune from the catalog', () => {
    const fortune = randomFortune(seededRng(3))
    expect(FORTUNES).toContainEqual(fortune)
  })
})
```

- [ ] **Step 3: รันเทสต์ให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run lib/game/draw.test.ts`
Expected: FAIL — resolve module `./draw` ไม่ได้

- [ ] **Step 4: สร้าง `lib/game/draw.ts`**

การสุ่มโทนละ 3 ใบก่อนแล้วค่อยสับตำแหน่ง เป็นวิธีที่รับประกันว่าทุกตารางมีครบทั้ง 3 โทน
ถ้าสุ่ม 9 ใบจากกองรวม ผู้เล่นมีโอกาสเจอตารางที่มีแต่มุกตลกล้วน ซึ่งทำให้เกมจืด

```ts
import { FORTUNES, TONES, type Fortune } from './fortunes'

export const GRID_SIZE = 9

const PER_TONE = 3

/** Draws nine distinct fortunes, three of each tone, in shuffled positions. */
export function drawNine(rng: () => number = Math.random): Fortune[] {
  const picked: Fortune[] = []
  for (const tone of TONES) {
    const pool = FORTUNES.filter((fortune) => fortune.tone === tone)
    picked.push(...shuffle(pool, rng).slice(0, PER_TONE))
  }
  return shuffle(picked, rng)
}

export function randomFortune(rng: () => number = Math.random): Fortune {
  return FORTUNES[Math.floor(rng() * FORTUNES.length)]
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
```

- [ ] **Step 5: รันเทสต์ให้ผ่าน**

Run: `npm test`
Expected: PASS ทั้งหมด

- [ ] **Step 6: Commit**

```bash
git add lib/game/draw.ts lib/game/draw.test.ts lib/test-utils/rng.ts
git commit -F - <<'EOF'
feat: draw nine fortunes with guaranteed tone balance

Sampling three per tone before shuffling positions means no grid can come
out all-jokes, which would flatten the game. rng is injectable so tests
assert exact sequences instead of statistical properties.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: เข้ารหัสและถอดรหัส postback

**Files:**
- Create: `lib/game/postback.ts`
- Test: `lib/game/postback.test.ts`

**Interfaces:**
- Consumes: ไม่มี (ไม่แตะคลังคำทำนายโดยตั้งใจ — ดูหมายเหตุใน Step 4)
- Produces:
  - `type GameAction = { kind: 'open'; fortuneId: number } | { kind: 'new' }`
  - `const NEW_GAME_DATA = 'a=new'`
  - `function encodeOpen(fortuneId: number): string`
  - `function decodeAction(data: string): GameAction | null`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `lib/game/postback.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { NEW_GAME_DATA, decodeAction, encodeOpen } from './postback'

describe('encodeOpen', () => {
  it('encodes the fortune id into the payload', () => {
    expect(encodeOpen(42)).toBe('a=open&f=42')
  })

  it('stays well under the 300 character postback limit', () => {
    expect(encodeOpen(999999).length).toBeLessThan(300)
  })
})

describe('decodeAction', () => {
  it('round-trips an encoded open action', () => {
    expect(decodeAction(encodeOpen(42))).toEqual({ kind: 'open', fortuneId: 42 })
  })

  it('decodes the new-game payload', () => {
    expect(decodeAction(NEW_GAME_DATA)).toEqual({ kind: 'new' })
  })

  it('accepts an id that is not in the catalog and lets the caller decide', () => {
    expect(decodeAction('a=open&f=9999')).toEqual({ kind: 'open', fortuneId: 9999 })
  })

  it('rejects a non-numeric fortune id', () => {
    expect(decodeAction('a=open&f=abc')).toBeNull()
  })

  it('rejects a missing fortune id', () => {
    expect(decodeAction('a=open')).toBeNull()
  })

  it('rejects an unknown action', () => {
    expect(decodeAction('a=bogus')).toBeNull()
  })

  it('rejects empty data', () => {
    expect(decodeAction('')).toBeNull()
  })
})
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run lib/game/postback.test.ts`
Expected: FAIL — resolve module `./postback` ไม่ได้

- [ ] **Step 3: สร้าง `lib/game/postback.ts`**

โมดูลนี้ตรวจแค่ **รูปแบบ** ของ data ไม่ตรวจว่า id มีอยู่จริงในคลัง เพราะสองเรื่องนี้ต้องการ
การตอบสนองต่างกัน — data ผิดรูปแปลว่าไม่รู้ว่าผู้ใช้อยากทำอะไร (ตอบการ์ดใบ้) ส่วน id ที่ไม่มีจริง
แปลว่าผู้ใช้อยากเปิดคุกกี้แต่เราหาใบนั้นไม่เจอ (ตอบคำทำนายสุ่มแทน) การแยกจึงอยู่ที่ handler

```ts
export type GameAction = { kind: 'open'; fortuneId: number } | { kind: 'new' }

export const NEW_GAME_DATA = 'a=new'

export function encodeOpen(fortuneId: number): string {
  return new URLSearchParams({ a: 'open', f: String(fortuneId) }).toString()
}

/**
 * Parses postback data. Returns null when the payload is not something this
 * game produced. Validates shape only — whether the id exists in the catalog
 * is the caller's call, since a stale id still means "open a cookie".
 */
export function decodeAction(data: string): GameAction | null {
  const params = new URLSearchParams(data)
  const action = params.get('a')

  if (action === 'new') return { kind: 'new' }
  if (action !== 'open') return null

  const raw = params.get('f')
  if (raw === null || raw.trim() === '') return null

  const fortuneId = Number(raw)
  if (!Number.isInteger(fortuneId)) return null

  return { kind: 'open', fortuneId }
}
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `npm test`
Expected: PASS ทั้งหมด

- [ ] **Step 5: Commit**

```bash
git add lib/game/postback.ts lib/game/postback.test.ts
git commit -F - <<'EOF'
feat: encode and decode postback payloads

Shape validation only. A well-formed payload carrying an id we no longer
have still means "open a cookie", and the handler answers with a random
fortune rather than an error the player would see.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: Flex foundations และการ์ดตาราง 3×3

**Files:**
- Create: `lib/flex/types.ts`, `lib/flex/theme.ts`, `lib/flex/grid.ts`
- Test: `lib/flex/grid.test.ts`

**Interfaces:**
- Consumes: `type Fortune` จาก `lib/game/fortunes.ts`, `encodeOpen` จาก `lib/game/postback.ts`
- Produces:
  - จาก `types.ts`: `FlexMessage`, `FlexBubble`, `FlexBox`, `FlexText`, `FlexButton`, `FlexComponent`, `FlexAction`
  - จาก `theme.ts`: `COLORS`, `TONE_STYLE` (map จาก `Tone` ไป `{ label, color }`)
  - จาก `grid.ts`: `GRID_ALT_TEXT`, `function buildGridCard(fortunes: readonly Fortune[]): FlexMessage`

- [ ] **Step 1: สร้าง `lib/flex/types.ts`**

เขียน type เองแทนการลง SDK เพื่อคุมจำนวน dependency ครอบเฉพาะส่วนของ Flex ที่เกมนี้ใช้จริง

```ts
export interface FlexAction {
  type: 'postback'
  label: string
  data: string
  displayText?: string
}

export interface FlexText {
  type: 'text'
  text: string
  size?: string
  weight?: 'regular' | 'bold'
  color?: string
  align?: 'start' | 'center' | 'end'
  wrap?: boolean
  margin?: string
  flex?: number
}

export interface FlexButton {
  type: 'button'
  action: FlexAction
  style?: 'primary' | 'secondary' | 'link'
  color?: string
  height?: 'sm' | 'md'
}

export interface FlexSeparator {
  type: 'separator'
  margin?: string
  color?: string
}

export interface FlexBox {
  type: 'box'
  layout: 'vertical' | 'horizontal'
  contents: FlexComponent[]
  spacing?: string
  margin?: string
  paddingAll?: string
  paddingTop?: string
  paddingBottom?: string
  backgroundColor?: string
  cornerRadius?: string
  borderColor?: string
  borderWidth?: string
  justifyContent?: 'center' | 'flex-start' | 'flex-end'
  alignItems?: 'center' | 'flex-start' | 'flex-end'
  height?: string
  flex?: number
  action?: FlexAction
}

export type FlexComponent = FlexBox | FlexText | FlexButton | FlexSeparator

export interface FlexBubble {
  type: 'bubble'
  size?: 'nano' | 'micro' | 'kilo' | 'mega' | 'giga'
  header?: FlexBox
  body?: FlexBox
  footer?: FlexBox
}

export interface FlexMessage {
  type: 'flex'
  altText: string
  contents: FlexBubble
}
```

- [ ] **Step 2: สร้าง `lib/flex/theme.ts`**

```ts
import type { Tone } from '../game/fortunes'

export const COLORS = {
  cream: '#FFF8EC',
  tile: '#FFE9C2',
  tileBorder: '#E6C88E',
  ink: '#4A3A28',
  muted: '#9B8A74',
  accent: '#D98324',
  white: '#FFFFFF',
} as const

export const TONE_STYLE: Record<Tone, { label: string; color: string }> = {
  daily: { label: 'ดวงวันนี้', color: '#4C6EF5' },
  funny: { label: 'แซ่บ ๆ', color: '#E64980' },
  inspire: { label: 'ข้อคิด', color: '#2F9E44' },
}
```

- [ ] **Step 3: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `lib/flex/grid.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { drawNine } from '../game/draw'
import { decodeAction } from '../game/postback'
import { seededRng } from '../test-utils/rng'
import type { FlexBox } from './types'
import { GRID_ALT_TEXT, buildGridCard } from './grid'

const fortunes = drawNine(seededRng(11))
const card = buildGridCard(fortunes)
const rows = (card.contents.body as FlexBox).contents as FlexBox[]
const tiles = rows.flatMap((row) => row.contents as FlexBox[])

describe('buildGridCard', () => {
  it('is a flex message with the grid alt text', () => {
    expect(card.type).toBe('flex')
    expect(card.altText).toBe(GRID_ALT_TEXT)
  })

  it('lays out three rows of three tiles', () => {
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.layout).toBe('horizontal')
      expect(row.contents).toHaveLength(3)
    }
  })

  it('gives every tile a postback action carrying its own fortune id', () => {
    const decoded = tiles.map((tile) => decodeAction(tile.action!.data))
    expect(decoded).toEqual(fortunes.map((fortune) => ({ kind: 'open', fortuneId: fortune.id })))
  })

  it('numbers the tiles one through nine in the display text', () => {
    expect(tiles.map((tile) => tile.action!.displayText)).toEqual([
      'ทุบคุกกี้ชิ้นที่ 1',
      'ทุบคุกกี้ชิ้นที่ 2',
      'ทุบคุกกี้ชิ้นที่ 3',
      'ทุบคุกกี้ชิ้นที่ 4',
      'ทุบคุกกี้ชิ้นที่ 5',
      'ทุบคุกกี้ชิ้นที่ 6',
      'ทุบคุกกี้ชิ้นที่ 7',
      'ทุบคุกกี้ชิ้นที่ 8',
      'ทุบคุกกี้ชิ้นที่ 9',
    ])
  })

  it('makes every tile equal width so the grid stays square on any screen', () => {
    for (const tile of tiles) {
      expect(tile.flex).toBe(1)
    }
  })

  it('never leaks the fortune text into the unopened grid', () => {
    const serialised = JSON.stringify(card)
    for (const fortune of fortunes) {
      expect(serialised).not.toContain(fortune.text)
    }
  })
})
```

- [ ] **Step 4: รันเทสต์ให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run lib/flex/grid.test.ts`
Expected: FAIL — resolve module `./grid` ไม่ได้

- [ ] **Step 5: สร้าง `lib/flex/grid.ts`**

ไทล์ใช้ `box` ที่ใส่ `action` ได้ แทนที่จะใช้ `button` มาตรฐาน เพราะ button ของ Flex เป็นแถบยาว
เต็มความกว้าง ทำเป็นตารางสี่เหลี่ยมไม่ได้ ส่วน box ตั้ง `cornerRadius` กับ `height` เองได้
และไม่ต้องพึ่งไฟล์รูปเลย จึงไม่มีค่าโฮสต์รูปเพิ่ม

```ts
import type { Fortune } from '../game/fortunes'
import { encodeOpen } from '../game/postback'
import { COLORS } from './theme'
import type { FlexBox, FlexMessage } from './types'

export const GRID_ALT_TEXT = 'คุกกี้เสี่ยงทาย — แตะเลือกคุกกี้ 1 ชิ้น'

const COLUMNS = 3

export function buildGridCard(fortunes: readonly Fortune[]): FlexMessage {
  const rows: FlexBox[] = []
  for (let row = 0; row < fortunes.length / COLUMNS; row += 1) {
    rows.push({
      type: 'box',
      layout: 'horizontal',
      spacing: 'md',
      margin: row === 0 ? 'none' : 'md',
      contents: fortunes
        .slice(row * COLUMNS, row * COLUMNS + COLUMNS)
        .map((fortune, column) => buildTile(fortune, row * COLUMNS + column)),
    })
  }

  return {
    type: 'flex',
    altText: GRID_ALT_TEXT,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        backgroundColor: COLORS.accent,
        contents: [
          { type: 'text', text: '🥠 คุกกี้เสี่ยงทาย', weight: 'bold', size: 'lg', color: COLORS.white },
          { type: 'text', text: 'แตะเลือกคุกกี้ 1 ชิ้น', size: 'sm', color: COLORS.white, margin: 'sm' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        backgroundColor: COLORS.cream,
        contents: rows,
      },
    },
  }
}

function buildTile(fortune: Fortune, index: number): FlexBox {
  return {
    type: 'box',
    layout: 'vertical',
    flex: 1,
    height: '64px',
    backgroundColor: COLORS.tile,
    borderColor: COLORS.tileBorder,
    borderWidth: '1px',
    cornerRadius: '12px',
    justifyContent: 'center',
    alignItems: 'center',
    action: {
      type: 'postback',
      label: `คุกกี้ ${index + 1}`,
      data: encodeOpen(fortune.id),
      displayText: `ทุบคุกกี้ชิ้นที่ ${index + 1}`,
    },
    contents: [
      { type: 'text', text: '🥠', size: 'xxl', align: 'center' },
      { type: 'text', text: String(index + 1), size: 'xxs', color: COLORS.muted, align: 'center' },
    ],
  }
}
```

- [ ] **Step 6: รันเทสต์ให้ผ่าน**

Run: `npm test && npm run typecheck`
Expected: PASS ทั้งหมด และ typecheck ไม่มี error

- [ ] **Step 7: Commit**

```bash
git add lib/flex/types.ts lib/flex/theme.ts lib/flex/grid.ts lib/flex/grid.test.ts
git commit -F - <<'EOF'
feat: build the 3x3 cookie grid flex card

Tiles are boxes with an action rather than Flex buttons, which are always
full-width bars and cannot form a square grid. Flex types are hand-written
so the project needs no LINE SDK dependency.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 6: การ์ดคำทำนาย

**Files:**
- Create: `lib/flex/fortune.ts`
- Test: `lib/flex/fortune.test.ts`

**Interfaces:**
- Consumes: `type Fortune`, `findFortune` จาก `lib/game/fortunes.ts` · `NEW_GAME_DATA` จาก `lib/game/postback.ts` · `COLORS`, `TONE_STYLE` จาก `lib/flex/theme.ts` · type จาก `lib/flex/types.ts`
- Produces:
  - `function fortuneAltText(fortune: Fortune): string`
  - `function buildFortuneCard(fortune: Fortune): FlexMessage`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `lib/flex/fortune.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { findFortune } from '../game/fortunes'
import { NEW_GAME_DATA } from '../game/postback'
import { TONE_STYLE } from './theme'
import type { FlexBox, FlexButton, FlexText } from './types'
import { buildFortuneCard, fortuneAltText } from './fortune'

const fortune = findFortune(1)!

describe('buildFortuneCard', () => {
  it('shows the fortune text in the body', () => {
    const card = buildFortuneCard(fortune)
    expect(JSON.stringify(card.contents.body)).toContain(fortune.text)
  })

  it('wraps the fortune text so long lines are not cut off', () => {
    const card = buildFortuneCard(fortune)
    const body = card.contents.body as FlexBox
    const textNode = body.contents.find(
      (node): node is FlexText => node.type === 'text' && node.text === fortune.text,
    )
    expect(textNode?.wrap).toBe(true)
  })

  it('colours the tone badge to match the tone', () => {
    for (const id of [1, 21, 41]) {
      const current = findFortune(id)!
      const card = buildFortuneCard(current)
      const header = card.contents.header as FlexBox
      const badge = header.contents[0] as FlexText
      expect(badge.text).toBe(TONE_STYLE[current.tone].label)
      expect(badge.color).toBe(TONE_STYLE[current.tone].color)
    }
  })

  it('offers a play-again button', () => {
    const card = buildFortuneCard(fortune)
    const footer = card.contents.footer as FlexBox
    const button = footer.contents[0] as FlexButton
    expect(button.type).toBe('button')
    expect(button.action.data).toBe(NEW_GAME_DATA)
  })

  it('uses an alt text that previews the fortune', () => {
    expect(fortuneAltText(fortune)).toContain(fortune.text)
    expect(buildFortuneCard(fortune).altText).toBe(fortuneAltText(fortune))
  })

  it('keeps alt text within the 400 character LINE limit', () => {
    for (const id of [1, 21, 41]) {
      expect(fortuneAltText(findFortune(id)!).length).toBeLessThanOrEqual(400)
    }
  })
})
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run lib/flex/fortune.test.ts`
Expected: FAIL — resolve module `./fortune` ไม่ได้

- [ ] **Step 3: สร้าง `lib/flex/fortune.ts`**

```ts
import type { Fortune } from '../game/fortunes'
import { NEW_GAME_DATA } from '../game/postback'
import { COLORS, TONE_STYLE } from './theme'
import type { FlexMessage } from './types'

export function fortuneAltText(fortune: Fortune): string {
  return `คำทำนายของคุณ: ${fortune.text}`
}

export function buildFortuneCard(fortune: Fortune): FlexMessage {
  const tone = TONE_STYLE[fortune.tone]

  return {
    type: 'flex',
    altText: fortuneAltText(fortune),
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        backgroundColor: COLORS.cream,
        contents: [{ type: 'text', text: tone.label, size: 'sm', weight: 'bold', color: tone.color }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        backgroundColor: COLORS.cream,
        contents: [
          { type: 'text', text: '🥠', size: 'xxl', align: 'center' },
          {
            type: 'text',
            text: fortune.text,
            size: 'lg',
            color: COLORS.ink,
            align: 'center',
            wrap: true,
            margin: 'lg',
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        backgroundColor: COLORS.cream,
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: COLORS.accent,
            height: 'sm',
            action: {
              type: 'postback',
              label: 'เสี่ยงใหม่อีกครั้ง',
              data: NEW_GAME_DATA,
              displayText: 'เสี่ยงใหม่อีกครั้ง',
            },
          },
        ],
      },
    },
  }
}
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `npm test && npm run typecheck`
Expected: PASS ทั้งหมด

- [ ] **Step 5: Commit**

```bash
git add lib/flex/fortune.ts lib/flex/fortune.test.ts
git commit -F - <<'EOF'
feat: build the opened-fortune flex card

Alt text previews the fortune so the notification preview is already
worth reading, and the tone badge colour tells daily/funny/inspire apart
at a glance.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 7: การ์ดต้อนรับและการ์ดใบ้วิธีเล่น

**Files:**
- Create: `lib/flex/prompt.ts`
- Test: `lib/flex/prompt.test.ts`

**Interfaces:**
- Consumes: `NEW_GAME_DATA` จาก `lib/game/postback.ts` · `COLORS` จาก `lib/flex/theme.ts` · type จาก `lib/flex/types.ts`
- Produces:
  - `const WELCOME_ALT_TEXT: string`
  - `const HINT_ALT_TEXT: string`
  - `function buildWelcomeCard(): FlexMessage`
  - `function buildHintCard(): FlexMessage`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `lib/flex/prompt.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { NEW_GAME_DATA } from '../game/postback'
import type { FlexBox, FlexButton } from './types'
import {
  HINT_ALT_TEXT,
  WELCOME_ALT_TEXT,
  buildHintCard,
  buildWelcomeCard,
} from './prompt'

describe('prompt cards', () => {
  it('both put the player one tap from a new game', () => {
    for (const card of [buildWelcomeCard(), buildHintCard()]) {
      const footer = card.contents.footer as FlexBox
      const button = footer.contents[0] as FlexButton
      expect(button.action.data).toBe(NEW_GAME_DATA)
    }
  })

  it('uses distinct alt text so the two cards are tellable apart', () => {
    expect(buildWelcomeCard().altText).toBe(WELCOME_ALT_TEXT)
    expect(buildHintCard().altText).toBe(HINT_ALT_TEXT)
    expect(WELCOME_ALT_TEXT).not.toBe(HINT_ALT_TEXT)
  })

  it('tells the player which word starts the game', () => {
    expect(JSON.stringify(buildHintCard())).toContain('เสี่ยงทาย')
  })
})
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run lib/flex/prompt.test.ts`
Expected: FAIL — resolve module `./prompt` ไม่ได้

- [ ] **Step 3: สร้าง `lib/flex/prompt.ts`**

การ์ดสองใบนี้ต่างกันแค่ข้อความ จึงใช้ตัวสร้างร่วมกัน ทั้งคู่มีปุ่มเริ่มเกม เพื่อให้ผู้ใช้
อยู่ห่างจากการเล่นแค่หนึ่งแตะเสมอ ไม่ว่าจะพิมพ์อะไรเข้ามา

```ts
import { NEW_GAME_DATA } from '../game/postback'
import { COLORS } from './theme'
import type { FlexMessage } from './types'

export const WELCOME_ALT_TEXT = 'ยินดีต้อนรับสู่คุกกี้เสี่ยงทาย'
export const HINT_ALT_TEXT = 'พิมพ์ว่า เสี่ยงทาย เพื่อเริ่มเล่น'

export function buildWelcomeCard(): FlexMessage {
  return buildPromptCard(
    WELCOME_ALT_TEXT,
    'ยินดีต้อนรับ 🥠',
    'กดปุ่มด้านล่าง หรือพิมพ์ว่า "เสี่ยงทาย" แล้วเลือกคุกกี้ 1 ชิ้นจากตาราง 9 ช่อง เล่นได้ไม่จำกัด',
  )
}

export function buildHintCard(): FlexMessage {
  return buildPromptCard(
    HINT_ALT_TEXT,
    'อยากรู้ดวงไหม? 🥠',
    'พิมพ์ว่า "เสี่ยงทาย" หรือกดปุ่มด้านล่างได้เลย',
  )
}

function buildPromptCard(altText: string, title: string, body: string): FlexMessage {
  return {
    type: 'flex',
    altText,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        backgroundColor: COLORS.cream,
        contents: [
          { type: 'text', text: title, size: 'lg', weight: 'bold', color: COLORS.ink, wrap: true },
          { type: 'text', text: body, size: 'sm', color: COLORS.muted, wrap: true, margin: 'md' },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        backgroundColor: COLORS.cream,
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: COLORS.accent,
            height: 'sm',
            action: {
              type: 'postback',
              label: 'เสี่ยงทายเลย',
              data: NEW_GAME_DATA,
              displayText: 'เสี่ยงทายเลย',
            },
          },
        ],
      },
    },
  }
}
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `npm test && npm run typecheck`
Expected: PASS ทั้งหมด

- [ ] **Step 5: Commit**

```bash
git add lib/flex/prompt.ts lib/flex/prompt.test.ts
git commit -F - <<'EOF'
feat: add welcome and hint prompt cards

Both carry a start button so any unrecognised message still leaves the
player one tap from playing instead of facing a dead end.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 8: ตรรกะตอบกลับ event

**Files:**
- Create: `lib/line/types.ts`, `lib/game/handler.ts`
- Test: `lib/game/handler.test.ts`

**Interfaces:**
- Consumes: ทุกอย่างจาก Task 2–7
- Produces:
  - จาก `lib/line/types.ts`: `LineEvent`, `LineWebhookBody`
  - จาก `lib/game/handler.ts`: `TRIGGER_WORDS`, `function handleEvent(event: LineEvent, rng?: () => number): FlexMessage | null`

- [ ] **Step 1: สร้าง `lib/line/types.ts`**

```ts
export type LineEvent =
  | { type: 'message'; replyToken: string; message: { type: string; text?: string } }
  | { type: 'postback'; replyToken: string; postback: { data: string } }
  | { type: 'follow'; replyToken: string }
  | { type: 'unfollow' | 'join' | 'leave' | 'unsend' | 'memberJoined' | 'memberLeft' }

export interface LineWebhookBody {
  destination?: string
  events?: LineEvent[]
}
```

- [ ] **Step 2: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `lib/game/handler.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { GRID_ALT_TEXT } from '../flex/grid'
import { fortuneAltText } from '../flex/fortune'
import { HINT_ALT_TEXT, WELCOME_ALT_TEXT } from '../flex/prompt'
import type { LineEvent } from '../line/types'
import { seededRng } from '../test-utils/rng'
import { findFortune } from './fortunes'
import { NEW_GAME_DATA, encodeOpen } from './postback'
import { handleEvent } from './handler'

function textEvent(text: string): LineEvent {
  return { type: 'message', replyToken: 'token', message: { type: 'text', text } }
}

function postbackEvent(data: string): LineEvent {
  return { type: 'postback', replyToken: 'token', postback: { data } }
}

describe('handleEvent', () => {
  it('greets a new follower', () => {
    const reply = handleEvent({ type: 'follow', replyToken: 'token' }, seededRng(1))
    expect(reply?.altText).toBe(WELCOME_ALT_TEXT)
  })

  it('sends the grid for a trigger word', () => {
    expect(handleEvent(textEvent('เสี่ยงทาย'), seededRng(1))?.altText).toBe(GRID_ALT_TEXT)
  })

  it('recognises a trigger word inside a longer sentence', () => {
    expect(handleEvent(textEvent('ขอเสี่ยงทายหน่อยครับ'), seededRng(1))?.altText).toBe(GRID_ALT_TEXT)
  })

  it('ignores surrounding whitespace and letter case', () => {
    expect(handleEvent(textEvent('  FORTUNE  '), seededRng(1))?.altText).toBe(GRID_ALT_TEXT)
  })

  it('sends the hint card for an unrecognised message', () => {
    expect(handleEvent(textEvent('สวัสดีครับ'), seededRng(1))?.altText).toBe(HINT_ALT_TEXT)
  })

  it('opens the exact fortune the tapped tile carries', () => {
    const fortune = findFortune(42)!
    const reply = handleEvent(postbackEvent(encodeOpen(42)), seededRng(1))
    expect(reply?.altText).toBe(fortuneAltText(fortune))
  })

  it('falls back to a random fortune when the id no longer exists', () => {
    const reply = handleEvent(postbackEvent(encodeOpen(9999)), seededRng(1))
    expect(reply?.altText).toContain('คำทำนายของคุณ:')
  })

  it('sends a fresh grid for the play-again postback', () => {
    expect(handleEvent(postbackEvent(NEW_GAME_DATA), seededRng(1))?.altText).toBe(GRID_ALT_TEXT)
  })

  it('sends the hint card for malformed postback data', () => {
    expect(handleEvent(postbackEvent('a=bogus'), seededRng(1))?.altText).toBe(HINT_ALT_TEXT)
  })

  it('stays silent for non-text messages', () => {
    const sticker: LineEvent = {
      type: 'message',
      replyToken: 'token',
      message: { type: 'sticker' },
    }
    expect(handleEvent(sticker, seededRng(1))).toBeNull()
  })

  it('stays silent for events it does not handle', () => {
    expect(handleEvent({ type: 'unfollow' }, seededRng(1))).toBeNull()
  })
})
```

- [ ] **Step 3: รันเทสต์ให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run lib/game/handler.test.ts`
Expected: FAIL — resolve module `./handler` ไม่ได้

- [ ] **Step 4: สร้าง `lib/game/handler.ts`**

ฟังก์ชันนี้ **คืนข้อความที่จะตอบ ไม่ได้ส่งเอง** การแยกการตัดสินใจออกจากผลข้างเคียงทำให้
เทสต์ทุกเส้นทางได้โดยไม่ต้อง mock เน็ตเวิร์กเลย มีแค่ `rng` ตัวเดียวที่ต้องฉีดเข้ามา

```ts
import { buildFortuneCard } from '../flex/fortune'
import { buildGridCard } from '../flex/grid'
import { buildHintCard, buildWelcomeCard } from '../flex/prompt'
import type { FlexMessage } from '../flex/types'
import type { LineEvent } from '../line/types'
import { drawNine, randomFortune } from './draw'
import { findFortune } from './fortunes'
import { decodeAction } from './postback'

export const TRIGGER_WORDS = ['เสี่ยงทาย', 'เสี่ยงโชค', 'คุกกี้', 'ดวง', 'เล่น', 'fortune']

/** Decides what to reply with. Returns null when the event needs no reply. */
export function handleEvent(event: LineEvent, rng: () => number = Math.random): FlexMessage | null {
  if (event.type === 'follow') {
    return buildWelcomeCard()
  }

  if (event.type === 'message') {
    const text = event.message.text
    if (event.message.type !== 'text' || text === undefined) return null
    return isTrigger(text) ? buildGridCard(drawNine(rng)) : buildHintCard()
  }

  if (event.type === 'postback') {
    const action = decodeAction(event.postback.data)
    if (action === null) return buildHintCard()
    if (action.kind === 'new') return buildGridCard(drawNine(rng))
    return buildFortuneCard(findFortune(action.fortuneId) ?? randomFortune(rng))
  }

  return null
}

function isTrigger(text: string): boolean {
  const normalised = text.trim().toLowerCase()
  return TRIGGER_WORDS.some((word) => normalised.includes(word))
}
```

- [ ] **Step 5: รันเทสต์ให้ผ่าน**

Run: `npm test && npm run typecheck`
Expected: PASS ทั้งหมด

- [ ] **Step 6: Commit**

```bash
git add lib/line/types.ts lib/game/handler.ts lib/game/handler.test.ts
git commit -F - <<'EOF'
feat: decide replies from webhook events

handleEvent returns the message to send rather than sending it, so every
path is testable without mocking the network. Trigger matching uses
substring so "ขอเสี่ยงทายหน่อย" starts a game too.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 9: ตรวจลายเซ็น webhook

**Files:**
- Create: `lib/line/verify.ts`
- Test: `lib/line/verify.test.ts`

**Interfaces:**
- Consumes: `node:crypto`
- Produces: `function verifySignature(rawBody: string, signature: string | null, channelSecret: string): boolean`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `lib/line/verify.test.ts`

```ts
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifySignature } from './verify'

const SECRET = 'test-channel-secret'
const BODY = JSON.stringify({ events: [] })

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64')
}

describe('verifySignature', () => {
  it('accepts a signature produced with the right secret', () => {
    expect(verifySignature(BODY, sign(BODY), SECRET)).toBe(true)
  })

  it('rejects a signature produced with a different secret', () => {
    expect(verifySignature(BODY, sign(BODY, 'wrong-secret'), SECRET)).toBe(false)
  })

  it('rejects a body that was tampered with after signing', () => {
    const signature = sign(BODY)
    expect(verifySignature(BODY + ' ', signature, SECRET)).toBe(false)
  })

  it('rejects a missing signature header', () => {
    expect(verifySignature(BODY, null, SECRET)).toBe(false)
  })

  it('rejects an empty signature header', () => {
    expect(verifySignature(BODY, '', SECRET)).toBe(false)
  })

  it('rejects a signature of the wrong length without throwing', () => {
    expect(() => verifySignature(BODY, 'short', SECRET)).not.toThrow()
    expect(verifySignature(BODY, 'short', SECRET)).toBe(false)
  })

  it('handles a body containing Thai text', () => {
    const thaiBody = JSON.stringify({ text: 'เสี่ยงทาย' })
    expect(verifySignature(thaiBody, sign(thaiBody), SECRET)).toBe(true)
  })
})
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run lib/line/verify.test.ts`
Expected: FAIL — resolve module `./verify` ไม่ได้

- [ ] **Step 3: สร้าง `lib/line/verify.ts`**

เช็กความยาวก่อนเรียก `timingSafeEqual` เป็นเรื่องจำเป็น ไม่ใช่การกันไว้ก่อน — ฟังก์ชันนั้น
โยน error ทันทีถ้าบัฟเฟอร์สองฝั่งยาวไม่เท่ากัน และค่า signature มาจากผู้ส่งภายนอกซึ่งยาวเท่าไรก็ได้

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verifies the x-line-signature header against the raw request body.
 * The body must be the exact bytes LINE sent — re-serialising parsed JSON
 * changes whitespace and key order, which breaks the signature.
 */
export function verifySignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string,
): boolean {
  if (!signature) return false

  const expected = Buffer.from(
    createHmac('sha256', channelSecret).update(rawBody, 'utf8').digest('base64'),
  )
  const received = Buffer.from(signature)

  if (expected.length !== received.length) return false
  return timingSafeEqual(expected, received)
}
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `npm test && npm run typecheck`
Expected: PASS ทั้งหมด

- [ ] **Step 5: Commit**

```bash
git add lib/line/verify.ts lib/line/verify.test.ts
git commit -F - <<'EOF'
feat: verify the x-line-signature header

Length is checked before timingSafeEqual because that function throws on
mismatched buffer lengths, and the header is attacker-controlled input of
arbitrary length.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 10: LINE Reply API client

**Files:**
- Create: `lib/line/client.ts`
- Test: `lib/line/client.test.ts`

**Interfaces:**
- Consumes: `type FlexMessage` จาก `lib/flex/types.ts`
- Produces:
  - `function getChannelSecret(): string`
  - `function getAccessToken(): string`
  - `async function replyMessage(replyToken: string, message: FlexMessage): Promise<void>`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `lib/line/client.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildHintCard } from '../flex/prompt'
import { getAccessToken, getChannelSecret, replyMessage } from './client'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('LINE_CHANNEL_ACCESS_TOKEN', 'test-token')
  vi.stubEnv('LINE_CHANNEL_SECRET', 'test-secret')
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('environment readers', () => {
  it('reads both LINE credentials', () => {
    expect(getAccessToken()).toBe('test-token')
    expect(getChannelSecret()).toBe('test-secret')
  })

  it('names the missing variable when it is not set', () => {
    vi.stubEnv('LINE_CHANNEL_SECRET', '')
    expect(() => getChannelSecret()).toThrow(/LINE_CHANNEL_SECRET/)
  })
})

describe('replyMessage', () => {
  it('posts the message to the LINE reply endpoint', async () => {
    const message = buildHintCard()
    await replyMessage('reply-token-123', message)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.line.me/v2/bot/message/reply')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer test-token')
    expect(JSON.parse(init.body)).toEqual({
      replyToken: 'reply-token-123',
      messages: [message],
    })
  })

  it('throws when LINE rejects the reply', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => 'Invalid reply token' })
    await expect(replyMessage('stale-token', buildHintCard())).rejects.toThrow(/400/)
  })
})
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run lib/line/client.test.ts`
Expected: FAIL — resolve module `./client` ไม่ได้

- [ ] **Step 3: สร้าง `lib/line/client.ts`**

ไฟล์นี้เป็น **จุดเดียวในระบบที่ออกเน็ตเวิร์ก** และใช้ endpoint `/message/reply` เท่านั้น
ห้ามเพิ่มฟังก์ชันที่ยิงไป `/message/push`, `/message/multicast` หรือ `/message/broadcast`
เพราะสามตัวนั้นมีค่าใช้จ่าย ส่วน reply ฟรีไม่จำกัด

```ts
import type { FlexMessage } from '../flex/types'

const REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply'

export function getChannelSecret(): string {
  return requireEnv('LINE_CHANNEL_SECRET')
}

export function getAccessToken(): string {
  return requireEnv('LINE_CHANNEL_ACCESS_TOKEN')
}

/** Replies to a single event. Reply messages are free; push messages are not. */
export async function replyMessage(replyToken: string, message: FlexMessage): Promise<void> {
  const response = await fetch(REPLY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAccessToken()}`,
    },
    body: JSON.stringify({ replyToken, messages: [message] }),
  })

  if (!response.ok) {
    throw new Error(`LINE reply failed: ${response.status} ${await response.text()}`)
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`)
  }
  return value
}
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `npm test && npm run typecheck`
Expected: PASS ทั้งหมด

- [ ] **Step 5: Commit**

```bash
git add lib/line/client.ts lib/line/client.test.ts
git commit -F - <<'EOF'
feat: add LINE reply API client

Reply endpoint only, by design: push, multicast and broadcast are billed
while replies are free, so the paid endpoints stay out of the codebase
entirely rather than sitting one call away.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 11: Webhook route

**Files:**
- Create: `app/api/line/webhook/route.ts`
- Test: `app/api/line/webhook/route.test.ts`

**Interfaces:**
- Consumes: `verifySignature`, `getChannelSecret`, `replyMessage`, `handleEvent`, `type LineWebhookBody`
- Produces: `POST` handler ที่ `/api/line/webhook` และค่า `runtime = 'nodejs'`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `app/api/line/webhook/route.test.ts`

```ts
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GRID_ALT_TEXT } from '@/lib/flex/grid'

const replyMessage = vi.fn()

vi.mock('@/lib/line/client', () => ({
  replyMessage: (...args: unknown[]) => replyMessage(...args),
  getChannelSecret: () => 'test-secret',
  getAccessToken: () => 'test-token',
}))

const { POST } = await import('./route')

function signedRequest(body: unknown, secret = 'test-secret'): Request {
  const raw = JSON.stringify(body)
  const signature = createHmac('sha256', secret).update(raw, 'utf8').digest('base64')
  return new Request('https://example.com/api/line/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-line-signature': signature },
    body: raw,
  })
}

beforeEach(() => {
  replyMessage.mockReset()
  replyMessage.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/line/webhook', () => {
  it('rejects a request signed with the wrong secret', async () => {
    const response = await POST(signedRequest({ events: [] }, 'wrong-secret'))
    expect(response.status).toBe(401)
    expect(replyMessage).not.toHaveBeenCalled()
  })

  it('rejects a request with no signature header', async () => {
    const request = new Request('https://example.com/api/line/webhook', {
      method: 'POST',
      body: JSON.stringify({ events: [] }),
    })
    expect((await POST(request)).status).toBe(401)
  })

  it('accepts the empty verification payload LINE sends from the console', async () => {
    const response = await POST(signedRequest({ events: [] }))
    expect(response.status).toBe(200)
    expect(replyMessage).not.toHaveBeenCalled()
  })

  it('replies with the grid when a player sends a trigger word', async () => {
    const response = await POST(
      signedRequest({
        events: [
          {
            type: 'message',
            replyToken: 'reply-token',
            message: { type: 'text', text: 'เสี่ยงทาย' },
          },
        ],
      }),
    )

    expect(response.status).toBe(200)
    expect(replyMessage).toHaveBeenCalledTimes(1)
    const [token, message] = replyMessage.mock.calls[0]
    expect(token).toBe('reply-token')
    expect(message.altText).toBe(GRID_ALT_TEXT)
  })

  it('still returns 200 when replying fails, so LINE does not retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    replyMessage.mockRejectedValue(new Error('LINE reply failed: 400'))

    const response = await POST(
      signedRequest({
        events: [
          {
            type: 'message',
            replyToken: 'reply-token',
            message: { type: 'text', text: 'เสี่ยงทาย' },
          },
        ],
      }),
    )

    expect(response.status).toBe(200)
  })

  it('returns 200 for a signed body that is not valid JSON', async () => {
    const raw = 'not json'
    const signature = createHmac('sha256', 'test-secret').update(raw, 'utf8').digest('base64')
    const request = new Request('https://example.com/api/line/webhook', {
      method: 'POST',
      headers: { 'x-line-signature': signature },
      body: raw,
    })
    expect((await POST(request)).status).toBe(200)
  })
})
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run app/api/line/webhook/route.test.ts`
Expected: FAIL — resolve module `./route` ไม่ได้

- [ ] **Step 3: สร้าง `app/api/line/webhook/route.ts`**

จุดที่พลาดกันบ่อยที่สุดคือ body — ต้องใช้ `req.text()` เอาไบต์ดิบมาตรวจลายเซ็น
ถ้า `req.json()` ก่อนแล้ว stringify กลับ ลำดับคีย์กับช่องว่างจะเปลี่ยน ลายเซ็นจะไม่ตรงตลอดกาล

```ts
import { NextResponse } from 'next/server'
import { handleEvent } from '@/lib/game/handler'
import { getChannelSecret, replyMessage } from '@/lib/line/client'
import type { LineWebhookBody } from '@/lib/line/types'
import { verifySignature } from '@/lib/line/verify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text()

  if (!verifySignature(rawBody, request.headers.get('x-line-signature'), getChannelSecret())) {
    return new NextResponse('Invalid signature', { status: 401 })
  }

  let body: LineWebhookBody
  try {
    body = JSON.parse(rawBody) as LineWebhookBody
  } catch {
    // Signature checked out, so this came from LINE. Nothing to act on.
    return NextResponse.json({ ok: true })
  }

  for (const event of body.events ?? []) {
    try {
      const message = handleEvent(event)
      if (message && 'replyToken' in event && event.replyToken) {
        await replyMessage(event.replyToken, message)
      }
    } catch (error) {
      // Never surface this as a non-200: LINE retries failed deliveries,
      // which would send the player the same card twice.
      console.error('[line-webhook] failed to handle event', error)
    }
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `npm test && npm run typecheck`
Expected: PASS ทั้งหมด

- [ ] **Step 5: ยืนยันว่า build ผ่านและเห็น route**

Run: `npm run build`
Expected: build สำเร็จ และในตาราง route มี `/api/line/webhook`

- [ ] **Step 6: Commit**

```bash
git add app/api/line/webhook/route.ts app/api/line/webhook/route.test.ts
git commit -F - <<'EOF'
feat: wire up the LINE webhook endpoint

Reads the raw body with request.text() because re-serialising parsed JSON
changes key order and whitespace, which would break signature checks. Any
handler failure is logged but still answered with 200, since a non-200
makes LINE redeliver and the player would get the card twice.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 12: คู่มือติดตั้งและ deploy

**Files:**
- Create: `README.md`, `.env.example`

**Interfaces:**
- Consumes: ชื่อ env var จาก `lib/line/client.ts` และ path `/api/line/webhook` จาก Task 11
- Produces: เอกสารที่คนที่ไม่เคยเห็นโปรเจกต์นี้ทำตามแล้วเปิดใช้งานบอทได้จริง

- [ ] **Step 1: สร้าง `.env.example`**

```bash
# LINE Developers Console → ช่อง Messaging API ของคุณ → แท็บ Basic settings
LINE_CHANNEL_SECRET=

# LINE Developers Console → แท็บ Messaging API → Channel access token (long-lived)
LINE_CHANNEL_ACCESS_TOKEN=
```

- [ ] **Step 2: สร้าง `README.md`**

````markdown
# 🥠 LINE Fortune Cookie

เกมคุกกี้เสี่ยงทายใน LINE Official Account เล่นจบในหน้าแชท
ผู้ใช้ได้ตารางคุกกี้ 3×3 แตะเลือก 1 ชิ้น แล้วได้คำทำนายที่ผูกกับชิ้นนั้น

- **ไม่มี database** — คำทำนายทั้ง 9 ใบถูกฝัง id ไว้ในปุ่มตอนสร้างการ์ด
- **ฟรีทั้งหมด** — Vercel Hobby + LINE reply message (ซึ่ง LINE ไม่คิดเงิน)
- **ไม่ใช้ Push API** ทุกการตอบกลับใช้ `replyToken` เท่านั้น

## เริ่มพัฒนา

```bash
npm install
npm test          # รันเทสต์ทั้งหมด ไม่ต้องต่อเน็ต ไม่ต้องมี LINE account
npm run typecheck
npm run dev       # เปิด http://localhost:3000
```

ตรรกะเกมทั้งหมดเป็น pure function เทสต์ครอบคลุมโดยไม่ต้องยิง LINE จริง
ดังนั้นแก้คำทำนายหรือหน้าตาการ์ดแล้วรัน `npm test` ได้ทันที

## ตั้งค่า LINE OA ตั้งแต่ต้น

1. สร้าง **LINE Official Account** ที่ [LINE Official Account Manager](https://manager.line.biz/) (ฟรี)
2. ไปที่ [LINE Developers Console](https://developers.line.biz/console/)
   สร้าง provider แล้วสร้าง **Messaging API channel** เชื่อมกับ OA ที่เพิ่งสร้าง
3. เก็บค่าสองตัวนี้ไว้
   - **Channel secret** — แท็บ *Basic settings*
   - **Channel access token** (long-lived) — แท็บ *Messaging API* กด Issue
4. ในแท็บ *Messaging API* — **ปิด** "Auto-reply messages" และ "Greeting messages"
   ถ้าไม่ปิด บอทอัตโนมัติของ LINE จะตอบทับข้อความของเกม
5. ใส่ค่าลง `.env.local` (ดูรูปแบบใน `.env.example`) — ไฟล์นี้ถูก gitignore ไว้แล้ว
   **ห้าม commit ค่าจริงลง repo** ใครได้ token ไปก็ส่งข้อความในนาม OA ของคุณได้

## Deploy ขึ้น Vercel

1. Import repo นี้เข้า [Vercel](https://vercel.com/new) เลือกแผน **Hobby** (ฟรี)
2. ใส่ environment variable สองตัว: `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`
3. Deploy แล้วเปิด `https://<app>.vercel.app/` ให้เห็นหน้า "Bot is running" ก่อน
   ถ้าหน้านี้ยังไม่ขึ้น ปัญหาอยู่ที่ deploy ไม่ใช่ที่ webhook
4. กลับไปที่ LINE Developers Console แท็บ *Messaging API*
   - ตั้ง **Webhook URL** เป็น `https://<app>.vercel.app/api/line/webhook`
   - กด **Verify** ต้องขึ้น Success
   - เปิดสวิตช์ **Use webhook**
5. แอด OA เป็นเพื่อนจาก QR code ในแท็บ *Messaging API* แล้วพิมพ์ว่า `เสี่ยงทาย`

ตอนพัฒนา ใช้ **preview deployment** ของ Vercel เป็น webhook URL ได้เลย (ฟรี อยู่ในบัญชีเดียวกัน)
ไม่ต้องพึ่ง ngrok ซึ่งแผนฟรีมีข้อจำกัด

## วิธีเล่น

| ผู้ใช้ทำอะไร | บอทตอบอะไร |
|---|---|
| แอดเป็นเพื่อน | การ์ดต้อนรับ + ปุ่มเริ่มเล่น |
| พิมพ์ `เสี่ยงทาย` `ดวง` `คุกกี้` `เล่น` `fortune` | ตารางคุกกี้ 3×3 |
| แตะคุกกี้ 1 ชิ้น | คำทำนายของชิ้นนั้น + ปุ่มเสี่ยงใหม่ |
| พิมพ์อย่างอื่น | การ์ดใบ้วิธีเล่น + ปุ่มเริ่มเล่น |

การ์ดตารางเก่าที่ค้างอยู่ในแชทยังกดได้เสมอ เพราะระบบไม่มีสถานะให้หมดอายุ

## แก้คำทำนาย

แก้ที่ `lib/game/fortunes.ts` — **`id` ที่ปล่อยไปแล้วห้ามเปลี่ยนหรือนำกลับมาใช้ซ้ำ**
เพราะการ์ดตารางที่ส่งไปหาผู้ใช้แล้วอ้างอิง id เดิมอยู่ ถ้าเปลี่ยน คุกกี้ใบเดิมจะเปลี่ยนคำทำนาย
เพิ่มใบใหม่ให้ใช้ id ถัดจากตัวที่มากที่สุด และรัน `npm test` เพื่อยืนยันว่ายังครบโทนละ 20 ใบ

## โครงสร้าง

```
app/api/line/webhook/route.ts   จุดรับ webhook — ตรวจลายเซ็นแล้วส่งต่อ
lib/game/fortunes.ts            คลังคำทำนาย 60 ใบ
lib/game/draw.ts                สุ่ม 9 ใบ โทนละ 3
lib/game/postback.ts            เข้ารหัส/ถอดรหัส postback
lib/game/handler.ts             event → ข้อความที่จะตอบ (pure)
lib/flex/                       ตัวสร้างการ์ด Flex ทั้งหมด (pure)
lib/line/verify.ts              ตรวจ x-line-signature
lib/line/client.ts              เรียก Reply API (จุดเดียวที่ออกเน็ต)
```

เอกสารออกแบบอยู่ที่ `docs/superpowers/specs/2026-08-07-line-fortune-cookie-design.md`
````

- [ ] **Step 3: ยืนยันว่าคำสั่งใน README ใช้ได้จริง**

Run: `npm test && npm run typecheck && npm run build`
Expected: ผ่านทั้งสามคำสั่ง — README บอกให้คนอื่นรันคำสั่งพวกนี้ จึงต้องแน่ใจว่ารันแล้วผ่านจริง

- [ ] **Step 4: ยืนยันว่าไม่มีความลับหลุดขึ้น repo**

Run: `git ls-files | grep -E '^\.env' | grep -v '^\.env\.example$' || echo 'no secret env files tracked'`
Expected: `no secret env files tracked` — ไฟล์ `.env` ตัวเดียวที่ถูก track ได้คือ `.env.example` ซึ่งเป็นเทมเพลตค่าว่าง

- [ ] **Step 5: Commit**

```bash
git add README.md .env.example
git commit -F - <<'EOF'
docs: add setup and deployment guide

Written for someone with no LINE OA yet. Calls out the two steps people
miss most: turning off LINE's built-in auto-reply, which otherwise talks
over the game, and checking the landing page before blaming the webhook.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

- [ ] **Step 6: Push**

```bash
git push origin main
```

---

## ตรวจสอบด้วยตนเองหลังทำครบทุก Task

ขั้นตอนเหล่านี้ต้องใช้ LINE OA จริง ทำหลัง deploy เสร็จ

- [ ] เปิด `https://<app>.vercel.app/` เห็นหน้า "Bot is running"
- [ ] กด Verify ที่ Webhook URL ใน LINE Developers Console แล้วขึ้น Success
- [ ] แอด OA เป็นเพื่อน แล้วได้การ์ดต้อนรับ
- [ ] พิมพ์ `เสี่ยงทาย` แล้วได้ตาราง 3×3 ที่ไทล์เรียงเป็นสี่เหลี่ยมจัตุรัส ไม่ใช่แถบยาว
- [ ] แตะคุกกี้คนละชิ้นสองครั้งจากตารางเดียวกัน แล้วได้คำทำนายคนละใบ
- [ ] กด "เสี่ยงใหม่อีกครั้ง" แล้วได้ตารางใหม่
- [ ] เลื่อนกลับไปกดตารางเก่าที่ส่งไปก่อนหน้า แล้วยังได้คำทำนายปกติ
- [ ] พิมพ์ข้อความมั่ว ๆ แล้วได้การ์ดใบ้วิธีเล่น
- [ ] ส่งสติกเกอร์ แล้วบอทเงียบ ไม่ตอบอะไร
