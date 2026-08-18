import { beforeEach, describe, expect, it, vi } from 'vitest'

type UserRow = { id: string; email: string; role: string; is_active: boolean }

const state: {
  cookie: string | undefined
  user: UserRow | undefined
  runs: Array<Record<string, unknown>>
  resets: string[]
} = { cookie: undefined, user: undefined, runs: [], resets: [] }

const sql = Object.assign(
  (strings: TemplateStringsArray) => {
    const text = strings.join(' ')
    if (/FROM app_user/.test(text)) return Promise.resolve(state.user ? [state.user] : [])
    return Promise.resolve([])
  },
  { json: (value: unknown) => value },
)

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'fsb_email' && state.cookie ? { value: state.cookie } : undefined,
  }),
}))
vi.mock('@/lib/db/client', () => ({ db: () => sql }))
vi.mock('@/lib/db/preview', () => ({
  runPreviewEvent: (_sql: unknown, args: Record<string, unknown>) => {
    state.runs.push(args)
    return Promise.resolve({
      message: { type: 'text', text: 'ตอบแล้ว' },
      snapshot: { attributes: [], counters: [], entitlements: [] },
    })
  },
  resetPreview: (_sql: unknown, campaignId: string) => {
    state.resets.push(campaignId)
    return Promise.resolve()
  },
  loadPreviewSnapshot: () =>
    Promise.resolve({ attributes: [], counters: [], entitlements: [] }),
}))

const { playPreview, resetPreviewPlayer } = await import('./actions')

const signedInAs = (role: string, isActive = true) => {
  state.cookie = 'someone@example.com'
  state.user = { id: 'u1', email: 'someone@example.com', role, is_active: isActive }
}

const sim = { dayOffset: 0, stock: 'as_configured' as const }

beforeEach(() => {
  state.cookie = undefined
  state.user = undefined
  state.runs = []
  state.resets = []
})

/**
 * ปุ่มที่จอซ่อนไว้ไม่ใช่ด่าน · ด่านอยู่ที่นี่
 *
 * The screen hides the play controls from a reporter, and that is a hint rather
 * than a rule: the action is reachable by anyone who can reach the page. A
 * simulated play writes real rows on a real channel, so it has to check for
 * itself, every time.
 */
describe('ทุก action ตรวจสิทธิ์เอง', () => {
  it('ยังไม่เข้าระบบก็เล่นไม่ได้', async () => {
    await expect(playPreview('camp-1', { kind: 'text', text: 'เล่น' }, sim)).rejects.toThrow(
      'ต้องเข้าสู่ระบบก่อน',
    )
    expect(state.runs).toEqual([])
  })

  it('ผู้ดูรายงานกดเล่นไม่ได้ — ต้นแบบเขียนไว้ว่าดูได้อย่างเดียว', async () => {
    signedInAs('reporter')
    await expect(playPreview('camp-1', { kind: 'text', text: 'เล่น' }, sim)).rejects.toThrow(
      'ไม่มีสิทธิ์',
    )
    expect(state.runs).toEqual([])
  })

  it('ผู้ดูรายงานกดเริ่มใหม่ไม่ได้', async () => {
    signedInAs('reporter')
    await expect(resetPreviewPlayer('camp-1')).rejects.toThrow('ไม่มีสิทธิ์')
    expect(state.resets).toEqual([])
  })

  it('บัญชีที่ถูกถอนสิทธิ์แล้วเล่นไม่ได้ แม้คุกกี้ยังอยู่', async () => {
    signedInAs('configurator', false)
    await expect(playPreview('camp-1', { kind: 'text', text: 'เล่น' }, sim)).rejects.toThrow(
      'ต้องเข้าสู่ระบบก่อน',
    )
  })

  it('ผู้ตั้งค่าและผู้ดูแลเนื้อหาเล่นได้ทั้งคู่', async () => {
    for (const role of ['configurator', 'content_editor']) {
      signedInAs(role)
      await expect(playPreview('camp-1', { kind: 'text', text: 'เล่น' }, sim)).resolves.toBeTruthy()
    }
    expect(state.runs.length).toBe(2)
  })
})

describe('สิ่งที่ส่งมาจากเบราว์เซอร์ถูกตรวจก่อนถึงกติกา', () => {
  beforeEach(() => signedInAs('configurator'))

  it('ข้อความว่างไม่ถูกส่งเข้าไป', async () => {
    await expect(playPreview('camp-1', { kind: 'text', text: '   ' }, sim)).rejects.toThrow(
      'พิมพ์ข้อความก่อนกดส่ง',
    )
    expect(state.runs).toEqual([])
  })

  it('ข้อความถูกตัดช่องว่างหัวท้ายก่อนจับคู่คีย์เวิร์ด', async () => {
    await playPreview('camp-1', { kind: 'text', text: '  เล่น  ' }, sim)
    expect(state.runs[0].input).toEqual({ kind: 'text', text: 'เล่น' })
  })

  // LINE ไม่รับข้อความยาวเกิน 2000 ตัว · ยอมให้พิมพ์ที่นี่แล้วบอกว่าเล่นได้
  // คือการทดสอบสิ่งที่ผู้เล่นจริงส่งไม่ได้
  it('ข้อความยาวเกินที่ LINE รับ ถูกปฏิเสธที่นี่ ไม่ใช่ไปโผล่ว่าเล่นได้', async () => {
    await expect(
      playPreview('camp-1', { kind: 'text', text: 'ก'.repeat(2001) }, sim),
    ).rejects.toThrow('ยาวเกิน')
  })

  // event_log.postback_data มี CHECK ว่ายาวได้ไม่เกิน 300 · ปล่อยผ่านแล้วจะพัง
  // ตอนเขียนบันทึก ซึ่งเกิดหลังจากแจกรางวัลไปแล้ว
  it('ข้อมูลปุ่มยาวเกินที่ตารางบันทึกรับได้ ถูกปฏิเสธก่อนเล่น', async () => {
    await expect(
      playPreview('camp-1', { kind: 'postback', data: 'x'.repeat(301) }, sim),
    ).rejects.toThrow('ยาวเกิน')
    expect(state.runs).toEqual([])
  })

  it('ชนิดอินพุตที่ไม่มีในระบบถูกปฏิเสธ', async () => {
    await expect(
      playPreview('camp-1', { kind: 'shout' } as never, sim),
    ).rejects.toThrow('ทดลองเล่นรับ')
  })

  it('สภาพคลังรางวัลที่ไม่รู้จักถูกปฏิเสธ ไม่ใช่ตกไปเป็นค่าเริ่มต้นเงียบๆ', async () => {
    await expect(
      playPreview('camp-1', { kind: 'text', text: 'เล่น' }, { dayOffset: 0, stock: 'free' as never }),
    ).rejects.toThrow('สภาพคลังรางวัล')
  })
})

/**
 * จำนวนวันที่ข้ามมาจากเบราว์เซอร์ จึงเป็นตัวเลขที่เชื่อไม่ได้
 *
 * previewNow multiplies it by a day, so a number nobody checked turns into a
 * date beyond what a Date can hold — and every query after that receives
 * "Invalid Date" instead of a time.
 */
describe('จำนวนวันที่ข้าม', () => {
  beforeEach(() => signedInAs('configurator'))

  it('ตัวเลขปกติผ่านไปทั้งอย่างนั้น', async () => {
    await playPreview('camp-1', { kind: 'text', text: 'เล่น' }, { dayOffset: 6, stock: 'as_configured' })
    expect(state.runs[0].dayOffset).toBe(6)
  })

  it('ติดลบกลายเป็นศูนย์ ไม่ใช่ย้อนเวลา', async () => {
    await playPreview('camp-1', { kind: 'text', text: 'เล่น' }, { dayOffset: -5, stock: 'as_configured' })
    expect(state.runs[0].dayOffset).toBe(0)
  })

  it('ตัวเลขมหาศาลถูกจำกัด ไม่ได้ปล่อยให้ไปคูณกับวันจนวันที่พัง', async () => {
    await playPreview('camp-1', { kind: 'text', text: 'เล่น' }, { dayOffset: 1e9, stock: 'as_configured' })
    expect(Number(state.runs[0].dayOffset)).toBeLessThanOrEqual(3650)
  })

  it('ค่าที่ไม่ใช่ตัวเลขกลายเป็นศูนย์', async () => {
    await playPreview(
      'camp-1', { kind: 'text', text: 'เล่น' }, { dayOffset: NaN, stock: 'as_configured' },
    )
    expect(state.runs[0].dayOffset).toBe(0)
  })
})

describe('สิ่งที่ action ส่งกลับให้จอ', () => {
  beforeEach(() => signedInAs('configurator'))

  it('ข้อความที่กติกาตอบมา ถูกแกะเป็นฟองแชทให้แล้ว', async () => {
    const out = await playPreview('camp-1', { kind: 'text', text: 'เล่น' }, sim)
    expect(out.bubble).toEqual({ kind: 'text', text: 'ตอบแล้ว' })
  })

  it('สถานะผู้เล่นกลับมาด้วยทุกครั้ง แผงขวาจะได้ไม่ค้างอยู่กับของเก่า', async () => {
    const out = await playPreview('camp-1', { kind: 'text', text: 'เล่น' }, sim)
    expect(out.snapshot).toEqual({ attributes: [], counters: [], entitlements: [] })
  })

  it('เริ่มใหม่แล้วคืนสถานะที่ว่างเปล่ามาให้ ไม่ใช่ให้จอเดาเอง', async () => {
    const out = await resetPreviewPlayer('camp-1')
    expect(state.resets).toEqual(['camp-1'])
    expect(out.bubble).toBe(null)
    expect(out.snapshot.entitlements).toEqual([])
  })
})
