// tests/quiz-export.integration.test.ts
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import { testDb } from '../lib/db/client'
import type { QuizConfig } from '../lib/quiz/schema'

/**
 * ยิงจริงผ่าน export/route.ts (Task 14 ที่เหลือ, docs/superpowers/specs/
 * 2026-08-28-liff-template-export-design.md §9) — เดินสายจริงเหมือน
 * quiz-publish-gate.integration.test.ts: สร้างกิจกรรมผ่าน Server Action จริง →
 * กรอกเนื้อหาควิซ + templateCopy ผ่าน saveQuizConfigAction จริง → ยิง GET
 * export route ตรงๆ → ยืนยันว่าได้ zip กลับมา (magic bytes + ขนาดไม่เล็กเกินไป
 * ควรมีหลายไฟล์จาก liff-template/ ทั้งโปรเจกต์) ความถูกต้องของเนื้อหาไฟล์ในซิป
 * ทีละไฟล์ทดสอบแล้วที่ lib/liffExport/assemble.test.ts — เทสต์นี้พิสูจน์แค่ว่า
 * "สาย" (auth → DB → assemble → zip → response) ต่อกันถูกจริง
 */
let cookie: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'fsb_email' && cookie ? { value: cookie } : undefined),
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }))
vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/db/client')>()),
  db: () => sql,
}))

const { createActivity } = await import('../app/(admin)/campaigns/[id]/activities/actions')
const { saveQuizConfigAction } =
  await import('../app/(admin)/campaigns/[id]/activities/[activityId]/quiz/actions')
const { GET: exportTemplate } =
  await import('../app/(admin)/campaigns/[id]/activities/[activityId]/quiz/export/route')

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'
let sql: postgres.Sql

beforeAll(async () => {
  process.env.SECRET_KEY_V1 = randomBytes(32).toString('base64')
  sql = testDb(url)
  await sql`SELECT 1`
})

afterAll(async () => { await sql?.end({ timeout: 5 }) })

let unique = 0
const tag = () =>
  `${Date.now().toString(36)}${(unique++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

const form = (fields: Record<string, string>) => {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.append(key, value)
  return fd
}

const validQuizConfig: QuizConfig = {
  mode: 'solo',
  axes: [
    { id: 'ei', label: 'E/I', poles: ['E', 'I'] },
    { id: 'sn', label: 'S/N', poles: ['S', 'N'] },
  ],
  questions: [
    { id: 'q1', text: 'q1', options: [{ id: 'a', label: 'A', scores: { ei: 2 } }, { id: 'b', label: 'B', scores: { ei: -2 } }] },
    { id: 'q2', text: 'q2', options: [{ id: 'a', label: 'A', scores: { sn: 2 } }, { id: 'b', label: 'B', scores: { sn: -2 } }] },
    { id: 'q3', text: 'q3', options: [{ id: 'a', label: 'A', scores: {} }, { id: 'b', label: 'B', scores: {} }] },
  ],
  results: [
    { code: 'ES', title: 'ES title', body: 'ES body' },
    { code: 'IN', title: 'IN title', body: 'IN body' },
  ],
  fallbackResultCode: 'ES',
  templateCopy: {
    brand: { name: 'Export test brand' },
    intro: { title: 'Intro', body: 'Intro body', ctaLabel: 'Start' },
    friendGate: { title: 'FG', body: 'FG body', ctaLabel: 'Add' },
    openInLine: { title: 'OIL', body: 'OIL body' },
    rewards: { milestones: [] },
    messages: {
      resultCard: { eyebrow: 'e', ctaLabel: 'c' },
      keywordCard: { title: 't', body: 'b', ctaLabel: 'c' },
      soloShare: { badge: 'b', ctaLabel: 'c', secondaryCtaLabel: 'd' },
    },
  },
}

describe('quiz template export · end to end', () => {
  it('exports a fully-configured quiz activity as a downloadable zip', async () => {
    const t = tag()

    const [user] = await sql<{ id: string; email: string }[]>`
      INSERT INTO app_user (email, role) VALUES (${`qex-${t}@example.com`}, 'configurator')
      RETURNING id, email`
    cookie = user.email

    const [campaign] = await sql<{ id: string }[]>`
      INSERT INTO campaign (name, code, start_at, end_at, created_by)
      VALUES ('Export test campaign', ${`qex_${t}`}, now() - interval '1 day', now() + interval '30 days', ${user.id})
      RETURNING id`

    await createActivity(campaign.id, form({
      name: `Quiz ${t}`, input_type: 'personality_quiz', quiz_mode: 'solo',
    }))
    const [activityRow] = await sql<{ id: string }[]>`
      SELECT id FROM activity WHERE campaign_id = ${campaign.id} AND input_type = 'personality_quiz'`

    const saveResult = await saveQuizConfigAction(campaign.id, activityRow.id, form({
      config: JSON.stringify(validQuizConfig),
    }))
    expect(saveResult.ok, saveResult.ok ? '' : (saveResult as { message: string }).message).toBe(true)

    const res = await exportTemplate(
      new Request('https://example.com'),
      { params: Promise.resolve({ id: campaign.id, activityId: activityRow.id }) },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(res.headers.get('content-disposition')).toContain('attachment')

    const buffer = Buffer.from(await res.arrayBuffer())
    expect(buffer.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    // liff-template/ มีไฟล์หลายสิบไฟล์ (engine/render/store/screens/config/README ฯลฯ) —
    // zip ที่ได้ต้องไม่เล็กจนน่าสงสัยว่าขาดไฟล์ไปทั้งชุด
    expect(buffer.length).toBeGreaterThan(2000)
  })

  it('rejects with 400 when the activity has no templateCopy configured yet', async () => {
    const t = tag()
    const [user] = await sql<{ id: string; email: string }[]>`
      INSERT INTO app_user (email, role) VALUES (${`qex-notc-${t}@example.com`}, 'configurator')
      RETURNING id, email`
    cookie = user.email

    const [campaign] = await sql<{ id: string }[]>`
      INSERT INTO campaign (name, code, start_at, end_at, created_by)
      VALUES ('Export test campaign no tc', ${`qexntc_${t}`}, now() - interval '1 day', now() + interval '30 days', ${user.id})
      RETURNING id`

    await createActivity(campaign.id, form({
      name: `Quiz no tc ${t}`, input_type: 'personality_quiz', quiz_mode: 'solo',
    }))
    const [activityRow] = await sql<{ id: string }[]>`
      SELECT id FROM activity WHERE campaign_id = ${campaign.id} AND input_type = 'personality_quiz'`

    // บันทึกเนื้อหาควิซโดยตั้งใจไม่ใส่ templateCopy
    const { templateCopy: _omit, ...withoutTemplateCopy } = validQuizConfig
    const saveResult = await saveQuizConfigAction(campaign.id, activityRow.id, form({
      config: JSON.stringify(withoutTemplateCopy),
    }))
    expect(saveResult.ok).toBe(true)

    const res = await exportTemplate(
      new Request('https://example.com'),
      { params: Promise.resolve({ id: campaign.id, activityId: activityRow.id }) },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(String(body.error)).toContain('templateCopy')
  })
})
