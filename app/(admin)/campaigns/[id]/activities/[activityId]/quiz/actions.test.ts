import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let sessionRole: 'configurator' | 'content_editor' | null = 'configurator'
let campaignStatus: 'draft' | 'published' | 'closed' | undefined = 'draft'
// input_config ปัจจุบันของกิจกรรมที่ saveTemplateCopyAction โหลดสดๆ จาก DB มาผสานกับ
// templateCopy ที่ส่งมา — undefined หมายถึงไม่พบกิจกรรมนี้เลย
let currentActivityInputConfig: unknown

vi.mock('@/lib/auth/session', () => ({
  getSession: async () => (sessionRole ? { userId: 'u1', role: sessionRole } : null),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// sql.json ต้องมีติดมาด้วย — actions.ts เรียก sql.json(config) จริงตามธรรมเนียม
// เดียวกับทุกจอที่เขียนคอลัมน์ JSONB ในระบบนี้ (ดู lib/db/richmenu.ts,
// lib/db/liffSessions.ts) เหมือนกับที่ ../../actions.test.ts (จอ M7-S02) ประกอบ
// sql mock ของตัวเองด้วย `Object.assign(fn, { json: ... })` — vi.fn() เฉยๆ ไม่มี
// เมธอดนี้ให้ เรียกแล้วจะได้ "sql.json is not a function" ไม่ใช่ผลจาก action ที่ผิด
//
// ต้องตอบคำถาม "SELECT id, status FROM campaign WHERE id = ..." ด้วยตอนนี้ —
// saveQuizConfigAction เรียก requireDraftCampaign() ก่อนเขียนเสมอตั้งแต่แก้ Finding 3
// (ก่อนหน้านี้ action นี้ข้าม BR-05 ไปเฉยๆ ทั้งที่ action อื่นทุกตัวที่เขียน
// input_config ของกิจกรรมเรียกด่านนี้ก่อนหมด) — และ "SELECT input_config FROM activity
// WHERE ..." ที่ saveTemplateCopyAction ใหม่ (Finding 3 ของรีวิวรอบนี้) ใช้โหลด config
// ปัจจุบันสดๆ แทนที่จะเชื่อ axes/questions/results ที่มากับ client
const sqlMock = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ? ')
    if (/FROM campaign WHERE/.test(text)) {
      return Promise.resolve(campaignStatus ? [{ id: values[0], status: campaignStatus }] : [])
    }
    if (/SELECT input_config FROM activity/.test(text)) {
      return Promise.resolve(currentActivityInputConfig === undefined ? [] : [{ input_config: currentActivityInputConfig }])
    }
    return Promise.resolve(undefined)
  },
  { json: (value: unknown) => value },
)
vi.mock('@/lib/db/client', () => ({ db: () => sqlMock }))

const { saveQuizConfigAction, saveTemplateCopyAction } = await import('./actions')

beforeEach(() => {
  sessionRole = 'configurator'
  campaignStatus = 'draft'
  currentActivityInputConfig = undefined
})
afterEach(() => { vi.clearAllMocks() })

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

// สองแกน ไม่ใช่แกนเดียว — schema ของ Task 2 (lib/quiz/schema.ts) บังคับ axes.min(2)
// ก้อนที่มีแกนเดียวไม่ผ่าน validation จริง แม้จะตั้งใจให้เป็นก้อน "ที่ควรผ่าน" ก็ตาม
const validConfig = {
  mode: 'solo',
  axes: [{ id: 'a', label: 'A', poles: ['X', 'Y'] }, { id: 'b', label: 'B', poles: ['P', 'Q'] }],
  questions: [
    { id: 'q1', text: 't', options: [{ id: 'o1', label: 'o', scores: { a: 1 } }, { id: 'o2', label: 'o2', scores: { a: -1 } }] },
    { id: 'q2', text: 't', options: [{ id: 'o1', label: 'o', scores: { a: 1 } }, { id: 'o2', label: 'o2', scores: { a: -1 } }] },
    { id: 'q3', text: 't', options: [{ id: 'o1', label: 'o', scores: { a: 1 } }, { id: 'o2', label: 'o2', scores: { a: -1 } }] },
  ],
  results: [{ code: 'X', title: 't', body: 'b' }, { code: 'Y', title: 't', body: 'b' }],
  fallbackResultCode: 'X',
}

describe('saveQuizConfigAction', () => {
  it('rejects a non-configurator', async () => {
    sessionRole = 'content_editor'
    const result = await saveQuizConfigAction('camp-1', 'act-1', formData({ config: '{}' }))
    expect(result.ok).toBe(false)
  })

  it('rejects an invalid config with a specific validation message', async () => {
    const result = await saveQuizConfigAction('camp-1', 'act-1', formData({
      config: JSON.stringify({ mode: 'solo', axes: [], questions: [], results: [], fallbackResultCode: 'x' }),
    }))
    expect(result.ok).toBe(false)
  })

  /**
   * Finding 3 ของรีวิวรอบสุดท้าย · BR-05 — แคมเปญที่ publish แล้วแก้กิจกรรมไม่ได้
   * เหตุผลเดียวกับทุก action อื่นในระบบ: กติกาที่คนกำลังเล่นอยู่ต้องไม่เปลี่ยนกลางทาง
   * (design spec §2 เองก็กังวลไว้แล้วว่าแก้ควิซระหว่างมีคน duo เล่นค้างจะทำให้ผลเพี้ยน)
   */
  it('rejects editing a quiz whose campaign is no longer draft (BR-05)', async () => {
    campaignStatus = 'published'
    const result = await saveQuizConfigAction('camp-1', 'act-1', formData({
      config: JSON.stringify(validConfig),
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('BR-05')
  })

  it('rejects when the campaign does not exist', async () => {
    campaignStatus = undefined
    const result = await saveQuizConfigAction('camp-ghost', 'act-1', formData({
      config: JSON.stringify(validConfig),
    }))
    expect(result.ok).toBe(false)
  })

  it('saves a valid config', async () => {
    const result = await saveQuizConfigAction('camp-1', 'act-1', formData({ config: JSON.stringify(validConfig) }))
    expect(result).toEqual({ ok: true })
  })
})

const validSoloTemplateCopy = {
  brand: { name: 'Test brand' },
  intro: { title: 't', body: 'b', ctaLabel: 'c' },
  friendGate: { title: 't', body: 'b', ctaLabel: 'c' },
  openInLine: { title: 't', body: 'b' },
  rewards: { milestones: [] },
  messages: {
    resultCard: { eyebrow: 'e', ctaLabel: 'c' },
    keywordCard: { title: 't', body: 'b', ctaLabel: 'c' },
    soloShare: { badge: 'b', ctaLabel: 'c', secondaryCtaLabel: 'd' },
  },
}

describe('saveTemplateCopyAction', () => {
  it('rejects a non-configurator', async () => {
    sessionRole = 'content_editor'
    currentActivityInputConfig = validConfig
    const result = await saveTemplateCopyAction('camp-1', 'act-1', formData({
      config: JSON.stringify({ templateCopy: validSoloTemplateCopy }),
    }))
    expect(result.ok).toBe(false)
  })

  it('rejects when the activity does not exist', async () => {
    currentActivityInputConfig = undefined
    const result = await saveTemplateCopyAction('camp-1', 'act-ghost', formData({
      config: JSON.stringify({ templateCopy: validSoloTemplateCopy }),
    }))
    expect(result.ok).toBe(false)
  })

  it('rejects an invalid templateCopy with a specific validation message', async () => {
    currentActivityInputConfig = validConfig
    const result = await saveTemplateCopyAction('camp-1', 'act-1', formData({
      config: JSON.stringify({ templateCopy: { ...validSoloTemplateCopy, brand: { name: '' } } }),
    }))
    expect(result.ok).toBe(false)
  })

  it('saves templateCopy on a draft campaign', async () => {
    currentActivityInputConfig = validConfig
    const result = await saveTemplateCopyAction('camp-1', 'act-1', formData({
      config: JSON.stringify({ templateCopy: validSoloTemplateCopy }),
    }))
    expect(result).toEqual({ ok: true })
  })

  /**
   * Finding 3 ของรีวิวรอบนี้ — templateCopy เป็น metadata ของเทมเพลตแบบ standalone ที่ export
   * แยกไปต่างหาก ไม่ใช่ config ที่กระทบผู้เล่นที่กำลังเล่นแคมเปญนี้อยู่จริงเหมือน
   * mode/axes/questions/results ที่ saveQuizConfigAction คุม — action นี้จึงต้อง "ไม่" บล็อก
   * ด้วย BR-05 (requireDraftCampaign) ต่างจาก saveQuizConfigAction ข้างบนโดยตั้งใจ แม้แคมเปญ
   * จะ published/live อยู่แล้วก็ตาม
   */
  it('saves templateCopy even when the campaign is published/live — not blocked by BR-05, unlike saveQuizConfigAction', async () => {
    campaignStatus = 'published'
    currentActivityInputConfig = validConfig
    const result = await saveTemplateCopyAction('camp-1', 'act-1', formData({
      config: JSON.stringify({ templateCopy: validSoloTemplateCopy }),
    }))
    expect(result.ok, result.ok ? '' : (result as { message: string }).message).toBe(true)
  })

  it('ignores axes/questions/results/mode in the submitted payload — merges templateCopy onto the current DB config instead of trusting the client for quiz content', async () => {
    currentActivityInputConfig = validConfig
    const tamperedPayload = {
      mode: 'duo', // แตกต่างจาก currentActivityInputConfig.mode ('solo') โดยตั้งใจ
      axes: [],
      questions: [],
      results: [],
      fallbackResultCode: 'nope',
      templateCopy: validSoloTemplateCopy,
    }
    const result = await saveTemplateCopyAction('camp-1', 'act-1', formData({ config: JSON.stringify(tamperedPayload) }))
    // ผ่านเพราะ merge บน currentActivityInputConfig (solo, ครบตาม schema) ไม่ใช่ก้อนที่ส่งมา
    // (ซึ่งถ้าใช้ตรงๆ จะ fail เพราะ duo mode ต้องมี templateCopy.invite/duoInvite/... ด้วย)
    expect(result.ok, result.ok ? '' : (result as { message: string }).message).toBe(true)
  })
})
