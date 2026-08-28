import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuizConfig } from '@/lib/quiz/schema'

let session: { userId: string; email: string; role: 'configurator' | 'content_editor' | 'reporter' } | null = null

const validConfig: QuizConfig = {
  mode: 'solo',
  axes: [{ id: 'a', label: 'A', poles: ['X', 'Y'] }, { id: 'b', label: 'B', poles: ['P', 'Q'] }],
  questions: [
    { id: 'q1', text: 't', options: [{ id: 'o1', label: 'o', scores: { a: 1 } }, { id: 'o2', label: 'o2', scores: { a: -1 } }] },
    { id: 'q2', text: 't', options: [{ id: 'o1', label: 'o', scores: { a: 1 } }, { id: 'o2', label: 'o2', scores: { a: -1 } }] },
    { id: 'q3', text: 't', options: [{ id: 'o1', label: 'o', scores: { a: 1 } }, { id: 'o2', label: 'o2', scores: { a: -1 } }] },
  ],
  results: [{ code: 'X', title: 't', body: 'b' }, { code: 'Y', title: 't', body: 'b' }],
  fallbackResultCode: 'X',
  templateCopy: {
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
  },
}

const activityRow = { id: 'act-1', name: 'Test quiz', input_type: 'personality_quiz', input_config: validConfig }

const sqlMock = (strings: TemplateStringsArray) => {
  const text = strings.join(' ? ')
  if (/FROM activity\s+WHERE/.test(text)) return Promise.resolve([activityRow])
  return Promise.resolve([])
}

const assembleTemplateFiles = vi.fn(async (_config: QuizConfig) => [{ path: 'package.json', content: Buffer.from('{}') }])
const zipToBuffer = vi.fn(async (_files: { path: string; content: Buffer }[]) => Buffer.from('PK\x03\x04fake-zip-bytes'))

vi.mock('@/lib/auth/session', () => ({ getSession: async () => session }))
vi.mock('@/lib/db/client', () => ({ db: () => sqlMock }))
vi.mock('@/lib/db/campaigns', () => ({
  loadCampaign: async (_sql: unknown, id: string) => (id === 'camp-missing' ? null : { id, name: 'Camp', status: 'draft' }),
}))
vi.mock('@/lib/liffExport/assemble', () => ({
  assembleTemplateFiles: (config: QuizConfig) => assembleTemplateFiles(config),
}))
vi.mock('@/lib/liffExport/zip', () => ({
  zipToBuffer: (files: { path: string; content: Buffer }[]) => zipToBuffer(files),
}))

const { GET } = await import('./route')

function paramsFor(id: string, activityId: string) {
  return { params: Promise.resolve({ id, activityId }) }
}

beforeEach(() => {
  session = { userId: 'u1', email: 'u1@example.com', role: 'configurator' }
  assembleTemplateFiles.mockClear()
  zipToBuffer.mockClear()
  assembleTemplateFiles.mockImplementation(async () => [{ path: 'package.json', content: Buffer.from('{}') }])
  zipToBuffer.mockImplementation(async () => Buffer.from('PK\x03\x04fake-zip-bytes'))
})

describe('GET quiz export route', () => {
  it('401s when there is no session at all', async () => {
    session = null
    const res = await GET(new Request('https://example.com'), paramsFor('camp-1', 'act-1'))
    expect(res.status).toBe(401)
  })

  /**
   * Finding 4 — route นี้เคย 403 ทุก role ที่ไม่ใช่ 'configurator' ทั้งที่จอพี่น้องกันที่อ่าน
   * ข้อมูลชุดเดียวกัน (quiz/page.tsx) อนุญาตทุก session ที่ล็อกอินแล้วดูได้อยู่แล้ว — route
   * อ่านอย่างเดียวเหมือนกัน ไม่มีเหตุผลให้เข้มกว่า
   */
  it.each(['content_editor', 'reporter'] as const)(
    'allows a non-configurator authenticated session (%s) to export — read-only, matches sibling pages',
    async (role) => {
      session = { userId: 'u2', email: 'u2@example.com', role }
      const res = await GET(new Request('https://example.com'), paramsFor('camp-1', 'act-1'))
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/zip')
    },
  )

  it('404s when the campaign does not exist', async () => {
    const res = await GET(new Request('https://example.com'), paramsFor('camp-missing', 'act-1'))
    expect(res.status).toBe(404)
  })

  it('succeeds with a 200 zip response for a valid config', async () => {
    const res = await GET(new Request('https://example.com'), paramsFor('camp-1', 'act-1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('attachment')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.length).toBeGreaterThan(0)
  })

  /**
   * Finding 1 — zip.ts เคยทิ้ง promise ของ archive.finalize() ไว้เฉยๆ ไม่มีใคร catch เลย ถ้า
   * finalize() ล้มเหลว (เช่น zlib/module error ภายใน archiver) จะกลายเป็น unhandled promise
   * rejection ที่ทำให้ process ทั้งตัวล่มได้ ตอนนี้ route ต้อง await/catch zipToBuffer() แล้ว
   * ตอบ error response ปกติสำหรับ request นั้นเพียง request เดียว ไม่ throw ขึ้นไปแบบ uncaught
   */
  it('returns a normal error response (not an uncaught throw) when zipping fails', async () => {
    zipToBuffer.mockRejectedValueOnce(new Error('simulated finalize failure'))
    const res = await GET(new Request('https://example.com'), paramsFor('camp-1', 'act-1'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(String(body.error)).toContain('simulated finalize failure')
  })

  it('returns a 400 error response when assembling the template files fails', async () => {
    assembleTemplateFiles.mockRejectedValueOnce(new Error('Cannot export: templateCopy is missing required fields: templateCopy'))
    const res = await GET(new Request('https://example.com'), paramsFor('camp-1', 'act-1'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(String(body.error)).toContain('templateCopy')
  })
})
