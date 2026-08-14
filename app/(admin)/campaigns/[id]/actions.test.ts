import { beforeEach, describe, expect, it, vi } from 'vitest'

type UserRow = { id: string; email: string; role: string; is_active: boolean }
type CampaignRow = {
  status: string
  name: string
  timezone: string
  day_length_sec: number
  start_at: Date
  theme: Record<string, string>
}

const state: {
  cookie: string | undefined
  user: UserRow | undefined
  campaign: CampaignRow | undefined
  writes: Array<{ text: string; values: unknown[] }>
} = { cookie: undefined, user: undefined, campaign: undefined, writes: [] }

const sql = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ? ').replace(/\s+/g, ' ').trim()
    if (/FROM app_user/.test(text)) return Promise.resolve(state.user ? [state.user] : [])
    if (/^SELECT .* FROM campaign/.test(text)) {
      return Promise.resolve(state.campaign ? [state.campaign] : [])
    }
    state.writes.push({ text, values })
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
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ db: () => sql }))

const { saveCampaignInfo } = await import('./actions')

const signedInAs = (role: string, isActive = true) => {
  state.cookie = 'someone@example.com'
  state.user = { id: 'u1', email: 'someone@example.com', role, is_active: isActive }
}

const campaignIs = (patch: Partial<CampaignRow> = {}) => {
  state.campaign = {
    status: 'draft', name: 'เดิม', timezone: 'Asia/Bangkok', day_length_sec: 86400,
    start_at: new Date('2026-08-01T00:00:00Z'), theme: {}, ...patch,
  }
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const validForm = () => form({ name: 'ชื่อใหม่', end_at: '2026-12-31', day_length_sec: '86400' })

const lastWrite = () => {
  const write = state.writes.at(-1)
  if (!write) throw new Error('ไม่มีการเขียนเกิดขึ้น')
  return write
}

beforeEach(() => {
  state.cookie = undefined
  state.user = undefined
  state.writes = []
  campaignIs()
})

/**
 * เหมือน createCampaign — ด่านอยู่ในตัว action ไม่ใช่ในหน้าจอ
 *
 * The form disables itself for a published campaign and never renders at all for
 * a content editor. Neither of those is a lock; both are hints drawn on a page
 * that the person calling this function may never have loaded.
 */
describe('saveCampaignInfo · ด่านสิทธิ์', () => {
  it('ยังไม่ได้เข้าระบบ แก้ไม่ได้', async () => {
    await expect(saveCampaignInfo('c1', validForm())).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it('มีคุกกี้แต่ไม่มีชื่อในรายชื่อที่อนุญาต แก้ไม่ได้', async () => {
    state.cookie = 'ghost@example.com'
    await expect(saveCampaignInfo('c1', validForm())).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it('ผู้ดูแลเนื้อหาแก้ข้อมูลแคมเปญไม่ได้', async () => {
    signedInAs('content_editor')
    await expect(saveCampaignInfo('c1', validForm())).rejects.toThrow('ไม่มีสิทธิ์')
    expect(state.writes).toEqual([])
  })

  it('ผู้ดูรายงานแก้ข้อมูลแคมเปญไม่ได้', async () => {
    signedInAs('reporter')
    await expect(saveCampaignInfo('c1', validForm())).rejects.toThrow('ไม่มีสิทธิ์')
    expect(state.writes).toEqual([])
  })

  it('สิทธิ์ถูกถอนแล้ว role เดิมไม่ช่วย', async () => {
    signedInAs('configurator', false)
    await expect(saveCampaignInfo('c1', validForm())).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it('ผู้ตั้งค่าแคมเปญแก้ได้', async () => {
    signedInAs('configurator')
    await saveCampaignInfo('c1', validForm())
    expect(lastWrite().text).toContain('UPDATE campaign')
  })
})

describe('saveCampaignInfo · แคมเปญที่ส่งขึ้นแล้ว (BR-05)', () => {
  beforeEach(() => { signedInAs('configurator') })

  // ห้ามที่ตัวเขียน ไม่ใช่แค่ปิดช่องกรอกในหน้าจอ
  it('แคมเปญที่ส่งขึ้นแล้วแก้ไม่ได้ แม้ส่งฟอร์มมาตรงๆ', async () => {
    campaignIs({ status: 'published' })
    await expect(saveCampaignInfo('c1', validForm())).rejects.toThrow('ส่งขึ้นแล้ว')
    expect(state.writes).toEqual([])
  })

  it('แคมเปญที่ปิดแล้วก็แก้ไม่ได้ — เคยส่งขึ้นมาแล้วเหมือนกัน', async () => {
    campaignIs({ status: 'closed' })
    await expect(saveCampaignInfo('c1', validForm())).rejects.toThrow('ส่งขึ้นแล้ว')
    expect(state.writes).toEqual([])
  })

  it('ข้อความบอกทางออก ไม่ใช่บอกแค่ว่าไม่ได้', async () => {
    campaignIs({ status: 'published' })
    await expect(saveCampaignInfo('c1', validForm())).rejects.toThrow(/ถอน|ก๊อป/)
  })

  it('แคมเปญร่างแก้ได้', async () => {
    campaignIs({ status: 'draft' })
    await saveCampaignInfo('c1', validForm())
    expect(state.writes).toHaveLength(1)
  })

  it('id ที่ไม่มีอยู่ บอกว่าไม่พบ ไม่ใช่เขียนทิ้งไปเงียบๆ', async () => {
    state.campaign = undefined
    await expect(saveCampaignInfo('nope', validForm())).rejects.toThrow('ไม่พบ')
    expect(state.writes).toEqual([])
  })
})

describe('saveCampaignInfo · ตรวจค่าที่กรอก', () => {
  beforeEach(() => { signedInAs('configurator') })

  it('ไม่มีวันจบ แก้ไม่ได้', async () => {
    await expect(saveCampaignInfo('c1', form({ name: 'ชื่อ', end_at: '' })))
      .rejects.toThrow('วันจบ')
    expect(state.writes).toEqual([])
  })

  it('วันจบก่อนวันเริ่ม แก้ไม่ได้ — บอกก่อนถึง CHECK ของตาราง', async () => {
    await expect(saveCampaignInfo('c1', form({ name: 'ชื่อ', end_at: '2026-07-01' })))
      .rejects.toThrow('วันเริ่ม')
    expect(state.writes).toEqual([])
  })

  it('ชื่อว่าง แก้ไม่ได้', async () => {
    await expect(saveCampaignInfo('c1', form({ name: '   ', end_at: '2026-12-31' })))
      .rejects.toThrow('ชื่อ')
    expect(state.writes).toEqual([])
  })

  it('ความยาววันที่ไม่ใช่ตัวเลข แก้ไม่ได้ ไม่ปล่อยให้ NaN ไปถึงฐานข้อมูล', async () => {
    for (const value of ['abc', '', '1.5', '-1']) {
      state.writes = []
      await expect(saveCampaignInfo('c1', form({ name: 'ชื่อ', end_at: '2026-12-31', day_length_sec: value })), value)
        .rejects.toThrow('ความยาว')
      expect(state.writes, value).toEqual([])
    }
  })

  // ต้นแบบกำหนดต่ำสุด 10 วินาที · ศูนย์ไม่ใช่ "วันสั้น" แต่แปลว่าจำกัดตลอดแคมเปญ
  it('ความยาววันต่ำกว่าสิบวินาทีแต่ไม่ใช่ศูนย์ แก้ไม่ได้', async () => {
    for (const value of ['1', '9']) {
      state.writes = []
      await expect(saveCampaignInfo('c1', form({ name: 'ชื่อ', end_at: '2026-12-31', day_length_sec: value })), value)
        .rejects.toThrow('ความยาว')
      expect(state.writes, value).toEqual([])
    }
  })

  it('ศูนย์กับสิบขึ้นไปผ่าน', async () => {
    for (const value of ['0', '10', '30', '86400']) {
      state.writes = []
      await saveCampaignInfo('c1', form({ name: 'ชื่อ', end_at: '2026-12-31', day_length_sec: value }))
      expect(state.writes, value).toHaveLength(1)
      expect(lastWrite().values, value).toContain(Number(value))
    }
  })
})

/**
 * ช่องที่หน้าจอไม่ได้ส่งมา ต้องคงค่าเดิม ไม่ใช่กลายเป็นค่าเริ่มต้น
 *
 * A disabled input submits nothing. Reading such a field as "absent, therefore
 * default" is how a campaign in Asia/Tokyo silently becomes a campaign in
 * Asia/Bangkok the first time anyone touches its name.
 */
describe('saveCampaignInfo · ช่องที่ไม่ได้ส่งมา', () => {
  beforeEach(() => { signedInAs('configurator') })

  it('เขตเวลาที่หน้าจอไม่ได้ส่งมา คงค่าเดิม ไม่ใช่ทับด้วยค่าเริ่มต้น', async () => {
    campaignIs({ timezone: 'Asia/Tokyo' })
    await saveCampaignInfo('c1', validForm())

    expect(lastWrite().values).toContain('Asia/Tokyo')
    expect(lastWrite().values).not.toContain('Asia/Bangkok')
  })

  it('ความยาววันที่ไม่ได้ส่งมา คงค่าเดิม', async () => {
    campaignIs({ day_length_sec: 30 })
    await saveCampaignInfo('c1', form({ name: 'ชื่อ', end_at: '2026-12-31' }))

    expect(lastWrite().values).toContain(30)
  })

  // theme ทั้งก้อนถูกเขียนทับ ถ้าไม่รวมของเดิมเข้าไป สีอื่นในธีมจะหายทุกครั้งที่กดบันทึก
  it('แก้สีหลักแล้วสีอื่นในธีมยังอยู่', async () => {
    campaignIs({ theme: { primary: '#111111', secondary: '#EEEEEE', text: '#222222' } })
    const data = validForm()
    data.append('theme_primary', '#abcdef')
    await saveCampaignInfo('c1', data)

    expect(lastWrite().values).toContainEqual({
      primary: '#abcdef', secondary: '#EEEEEE', text: '#222222',
    })
  })

  it('ไม่ได้ส่งสีมา ธีมเดิมไม่ถูกแตะ', async () => {
    campaignIs({ theme: { primary: '#111111', secondary: '#EEEEEE' } })
    await saveCampaignInfo('c1', validForm())

    expect(lastWrite().values).toContainEqual({ primary: '#111111', secondary: '#EEEEEE' })
  })

  it('สีที่ไม่ใช่รหัสสีหกหลัก ไม่ถูกเขียนลงไป', async () => {
    const data = validForm()
    data.append('theme_primary', 'red; DROP TABLE campaign')
    await expect(saveCampaignInfo('c1', data)).rejects.toThrow('สี')
    expect(state.writes).toEqual([])
  })
})
