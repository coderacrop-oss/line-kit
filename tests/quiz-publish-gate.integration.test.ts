// tests/quiz-publish-gate.integration.test.ts
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import { testDb } from '../lib/db/client'
import { configFor, loadPublishScreen, snapshotOf, writePublish } from '../lib/db/publish'
import { validateForPublish } from '../lib/publish/validate'
import type { QuizConfig } from '../lib/quiz/schema'

/**
 * Finding 1 ของรีวิวรอบสุดท้าย · จบครบ end-to-end จริง — ไม่ใช่แค่ unit test ของ
 * activityProblems()/checkPublish() (ซึ่งมีอยู่แล้วใน lib/db/activities.test.ts และ
 * lib/publish/validate.test.ts) และไม่ใช่การ INSERT campaign_channel(is_published=true)
 * ตรงๆ — เทสต์เหล่านั้นทุกตัวเดินผ่านด่าน publish gate จริงไปไม่ได้ ก่อนแก้ Finding 1 เพราะ
 * personality_quiz ติดด่าน "ยังไม่มีผลลัพธ์สักอัน" เสมอ (resolve_config.outcomes ว่าง
 * เป็นค่าเริ่มต้นที่ไม่มีวันถูกเติม — เนื้อหาของควิซอยู่ใน input_config แทน) ซึ่งไม่มี
 * เทสต์ไหนในระบบเคยจับได้เพราะทุกตัวข้ามด่านนี้ไปด้วยการ seed is_published=true เอง
 *
 * เทสต์นี้เดินสายจริงทั้งหมด: สร้างกิจกรรมผ่าน createActivity() (Server Action จริง)
 * → กรอกเนื้อหาควิซผ่าน saveQuizConfigAction() (Server Action จริง) → เดิน
 * loadPublishScreen()/validateForPublish() ตัวเดียวกับที่จอ M1-S04 และ publish()
 * Server Action ใช้ → ยืนยันว่าไม่มีตัวบล็อกค้าง → writePublish() (DB writer ตัวจริง
 * ของ publish()) → ยืนยันว่า campaign_channel.is_published เป็น true จริง
 *
 * ข้ามเฉพาะขั้นยิงออกไปหา LINE จริง (runAtLine: no-op) เหมือนที่
 * tests/publish.integration.test.ts ทำอยู่แล้ว — นั่นเป็นเรื่องภายนอกระบบ
 * (LINE Messaging API) ไม่ใช่สิ่งที่ Finding 1 พูดถึง
 */
let cookie: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'fsb_email' && cookie ? { value: cookie } : undefined),
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/db/client')>()),
  db: () => sql,
}))

const { createActivity } = await import('../app/(admin)/campaigns/[id]/activities/actions')
const { saveQuizConfigAction, saveTemplateCopyAction } =
  await import('../app/(admin)/campaigns/[id]/activities/[activityId]/quiz/actions')

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
  `qpg${Date.now().toString(36)}${(unique++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

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
    { id: 'q1', text: 'ข้อ 1', options: [
      { id: 'a', label: 'A', scores: { ei: 2 } }, { id: 'b', label: 'B', scores: { ei: -2 } },
    ] },
    { id: 'q2', text: 'ข้อ 2', options: [
      { id: 'a', label: 'A', scores: { sn: 2 } }, { id: 'b', label: 'B', scores: { sn: -2 } },
    ] },
    { id: 'q3', text: 'ข้อ 3', options: [
      { id: 'a', label: 'A', scores: {} }, { id: 'b', label: 'B', scores: {} },
    ] },
  ],
  results: [
    { code: 'ES', title: 'นักผจญภัย', body: 'บอดี้ ES' },
    { code: 'IN', title: 'นักคิด', body: 'บอดี้ IN' },
  ],
  fallbackResultCode: 'ES',
}

describe('quiz publish gate · end to end (Finding 1)', () => {
  it('a personality_quiz activity, configured through the real screens, actually publishes (Finding 1: the empty-outcomes gate no longer blocks it)', async () => {
    const t = tag()

    const [user] = await sql<{ id: string; email: string }[]>`
      INSERT INTO app_user (email, role) VALUES (${`qpg-${t}@example.com`}, 'configurator')
      RETURNING id, email`
    cookie = user.email

    const [campaign] = await sql<{ id: string }[]>`
      INSERT INTO campaign (name, code, start_at, end_at, created_by)
      VALUES ('ควิซ publish gate', ${`qpg_${t}`}, now() - interval '1 day', now() + interval '30 days', ${user.id})
      RETURNING id`

    // ต้องมีการ์ดอย่างน้อยหนึ่งใบที่มีบล็อก ไม่งั้นด่านตรวจที่ไม่เกี่ยวกับควิซเลย
    // ("แคมเปญนี้ยังไม่มีการ์ดสักใบ") จะบล็อกแทน ทำให้เทสต์นี้พิสูจน์ผิดจุด
    const [card] = await sql<{ id: string }[]>`
      INSERT INTO card (campaign_id, code) VALUES (${campaign.id}, 'welcome') RETURNING id`
    await sql`
      INSERT INTO card_block (card_id, block_type, sort_order, content)
      VALUES (${card.id}, 'title', 0, 'ยินดีต้อนรับ')`

    // ── สร้างกิจกรรมผ่าน Server Action จริง ไม่ใช่ INSERT ตรงๆ ────────────────
    await createActivity(campaign.id, form({
      name: `ควิซบุคลิกภาพ ${t}`, input_type: 'personality_quiz', quiz_mode: 'solo',
    }))

    const [activityRow] = await sql<{ id: string; code: string }[]>`
      SELECT id, code FROM activity WHERE campaign_id = ${campaign.id} AND input_type = 'personality_quiz'`
    expect(activityRow, 'createActivity() ควรสร้างกิจกรรมควิซจริงในฐานข้อมูล').toBeTruthy()

    // ต้องมีทางเข้าถึง ไม่งั้นด่าน "ยังไม่มีทางเข้าสักทาง" (ไม่เกี่ยวกับ Finding 1) จะบล็อก
    await sql`
      INSERT INTO keyword_rule (campaign_id, keyword, match_mode, target_activity_id, sort_order)
      VALUES (${campaign.id}, ${`ควิซ${t}`}, 'exact', ${activityRow.id}, 0)`

    // ── กรอกเนื้อหาควิซผ่าน Server Action จริง ไม่ใช่ UPDATE input_config ตรงๆ ──
    const saveResult = await saveQuizConfigAction(campaign.id, activityRow.id, form({
      config: JSON.stringify(validQuizConfig),
    }))
    expect(saveResult.ok, saveResult.ok ? '' : (saveResult as { message: string }).message).toBe(true)

    // ชั้น 'test'/'production' บังคับต้องมีกุญแจ (CHECK ของตาราง channel) — กุญแจเป็น
    // ข้อความมั่วได้เพราะไม่มีขั้นไหนในเทสต์นี้ถอดรหัสมัน (runAtLine เป็น no-op)
    // เหมือน tests/publish.integration.test.ts's scene()
    const [channel] = await sql<{ id: string }[]>`
      INSERT INTO channel (name, channel_type, encrypted_token, encrypted_secret,
                           token_last4, key_version, created_by)
      VALUES (${`OA qpg ${t}`}, 'test', 'cipher', 'cipher', '9f2a', 1, ${user.id}) RETURNING id`

    // ── ด่านตรวจจริง ตัวเดียวกับที่จอ M1-S04 และ publish() Server Action ใช้ ──
    const screen = await loadPublishScreen(sql, campaign.id)
    const publishChannel = screen.channels.find((row) => row.id === channel.id)
    expect(publishChannel).toBeTruthy()
    const config = configFor(screen.base, publishChannel!, false)
    const problems = validateForPublish(config)

    // นี่คือ assertion ที่พิสูจน์ Finding 1 ตรงๆ: ก่อนแก้ ควิซที่ตั้งค่าครบแล้วยังคง
    // ติด "ยังไม่มีผลลัพธ์สักอัน" อยู่ดี เพราะ resolve_config.outcomes ว่างเสมอสำหรับ
    // personality_quiz — ควรว่างเปล่า (ผ่านหมด) หลังแก้
    expect(problems).toEqual([])

    // ── writePublish() ตัวจริง (ไม่ใช่ INSERT campaign_channel(is_published=true) เอง) ──
    const result = await writePublish(sql, {
      campaignId: campaign.id,
      channelId: channel.id,
      publishedBy: user.id,
      snapshot: snapshotOf(screen.base, publishChannel!),
      runAtLine: async () => {}, // ขั้นยิงหา LINE จริงเป็นเรื่องภายนอก ไม่ใช่สิ่งที่ Finding 1 พูดถึง
    })
    expect(result.versionNo).toBe(1)

    const [publishedRow] = await sql<{ is_published: boolean }[]>`
      SELECT is_published FROM campaign_channel
       WHERE campaign_id = ${campaign.id} AND channel_id = ${channel.id}`
    expect(publishedRow.is_published).toBe(true)

    const [campaignRow] = await sql<{ status: string }[]>`
      SELECT status FROM campaign WHERE id = ${campaign.id}`
    expect(campaignRow.status).toBe('published')

    // ── Finding 3 ของรีวิว liff-template export — templateCopy ต้องแก้ได้แม้แคมเปญ
    // published/live แล้ว (ต่างจาก mode/axes/questions/results ที่ saveQuizConfigAction
    // คุมและ requireDraftCampaign บล็อกไว้ตาม BR-05) เพราะเป็น metadata ของเทมเพลตแบบ
    // standalone ที่ export แยกไปต่างหาก ไม่กระทบผู้เล่นที่กำลังเล่นแคมเปญนี้อยู่จริงเลย
    const templateCopyResult = await saveTemplateCopyAction(campaign.id, activityRow.id, form({
      config: JSON.stringify({
        templateCopy: {
          brand: { name: 'Published campaign brand' },
          intro: { title: 't', body: 'b', ctaLabel: 'c' },
          friendGate: { title: 't', body: 'b', ctaLabel: 'c' },
          openInLine: { title: 't', body: 'b' },
          rewards: { milestones: [] },
          messages: {
            resultCard: { eyebrow: 'e', ctaLabel: 'c' },
            keywordCard: { title: 't', body: 'b', ctaLabel: 'c' },
            soloShare: { badge: 'b', ctaLabel: 'c', secondaryCtaLabel: 'd' },
          },
        },
      }),
    }))
    expect(
      templateCopyResult.ok,
      templateCopyResult.ok ? '' : (templateCopyResult as { message: string }).message,
    ).toBe(true)

    // ยืนยันด้วยว่า saveQuizConfigAction (เนื้อหาควิซจริง) ยังคงถูก BR-05 บล็อกอยู่เหมือนเดิม
    // — การแยก action ให้ templateCopy ไม่ได้เผลอปลดล็อกฝั่งเนื้อหาควิซไปด้วย
    const quizConfigResult = await saveQuizConfigAction(campaign.id, activityRow.id, form({
      config: JSON.stringify(validQuizConfig),
    }))
    expect(quizConfigResult.ok).toBe(false)
    if (!quizConfigResult.ok) expect(quizConfigResult.message).toContain('BR-05')
  })
})
