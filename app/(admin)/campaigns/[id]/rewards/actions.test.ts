import { beforeEach, describe, expect, it, vi } from 'vitest'

type UserRow = { id: string; email: string; role: string; is_active: boolean }

type RewardRow = {
  id: string
  code: string
  reward_type: string
  issued_count: number
  has_coupon: boolean
}

const reward = (patch: Partial<RewardRow> = {}): RewardRow => ({
  id: 'rw-1',
  code: 'discount_100',
  reward_type: 'code',
  issued_count: 0,
  has_coupon: false,
  ...patch,
})

const state: {
  cookie: string | undefined
  user: UserRow | undefined
  campaigns: string[]
  rewards: RewardRow[]
  existingCodes: string[]
  users: Array<{ label: string }>
  deletedCodes: string[]
  writes: Array<{ text: string; values: unknown[] }>
  failNextWriteWith: string | undefined
  redirectedTo: string | undefined
} = {
  cookie: undefined, user: undefined, campaigns: ['camp-1'],
  rewards: [reward()], existingCodes: [], users: [], deletedCodes: ['code-1'],
  writes: [], failNextWriteWith: undefined, redirectedTo: undefined,
}

const sql = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ? ').replace(/\s+/g, ' ').trim()

    if (/^SELECT/.test(text)) {
      if (/FROM app_user/.test(text)) return Promise.resolve(state.user ? [state.user] : [])
      if (/SELECT id FROM campaign/.test(text)) {
        return Promise.resolve(state.campaigns.includes(String(values[0])) ? [{ id: values[0] }] : [])
      }
      if (/FROM reward r WHERE r\.id/.test(text)) {
        const found = state.rewards.find((row) => row.id === values[0])
        return Promise.resolve(found && String(values[1]) === 'camp-1' ? [found] : [])
      }
      if (/SELECT code_value FROM reward_code/.test(text)) {
        return Promise.resolve(state.existingCodes.map((code_value) => ({ code_value })))
      }
      if (/UNION/.test(text)) return Promise.resolve(state.users)
      return Promise.resolve([])
    }

    if (state.failNextWriteWith) {
      const code = state.failNextWriteWith
      state.failNextWriteWith = undefined
      return Promise.reject(Object.assign(new Error('duplicate key value'), { code }))
    }

    state.writes.push({ text, values })
    if (/INSERT INTO reward /.test(text)) return Promise.resolve([{ id: 'rw-new' }])
    if (/DELETE FROM reward_code/.test(text)) {
      return Promise.resolve(state.deletedCodes.includes(String(values[0])) ? [{ id: values[0] }] : [])
    }
    return Promise.resolve([])
  },
  { array: (value: unknown) => value, json: (value: unknown) => value },
)

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'fsb_email' && state.cookie ? { value: state.cookie } : undefined,
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { state.redirectedTo = to },
}))
vi.mock('@/lib/db/client', () => ({ db: () => sql }))

const { deleteReward, deleteRewardCode, importRewardCodes, saveReward } = await import('./actions')

const signedInAs = (role: string, isActive = true) => {
  state.cookie = 'someone@example.com'
  state.user = { id: 'u1', email: 'someone@example.com', role, is_active: isActive }
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const rewardForm = (patch: Record<string, string> = {}) =>
  form({ code: 'discount_100', reward_type: 'code', ...patch })

const writesTo = (pattern: RegExp) => state.writes.filter((w) => pattern.test(w.text))

beforeEach(() => {
  state.cookie = undefined
  state.user = undefined
  state.campaigns = ['camp-1']
  state.rewards = [reward()]
  state.existingCodes = []
  state.users = []
  state.deletedCodes = ['code-1']
  state.writes = []
  state.failNextWriteWith = undefined
  state.redirectedTo = undefined
})

describe('สิทธิ์ของทั้งสี่ action', () => {
  const calls: Array<[string, () => Promise<void>]> = [
    ['saveReward', () => saveReward('camp-1', '', rewardForm())],
    ['deleteReward', () => deleteReward('camp-1', 'rw-1')],
    ['importRewardCodes', () => importRewardCodes('camp-1', 'rw-1', form({ codes: 'MELO-A1B2' }))],
    ['deleteRewardCode', () => deleteRewardCode('camp-1', 'rw-1', 'code-1')],
  ]

  it.each(calls)('%s · ยังไม่เข้าระบบ ทำไม่ได้', async (_name, call) => {
    await expect(call()).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it.each(calls)('%s · อีเมลที่ไม่อยู่ในรายชื่อ ทำไม่ได้', async (_name, call) => {
    state.cookie = 'stranger@example.com'
    await expect(call()).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it.each(calls)('%s · บัญชีที่ถูกถอนสิทธิ์ ทำไม่ได้แม้ยังมีแถวอยู่', async (_name, call) => {
    signedInAs('configurator', false)
    await expect(call()).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it.each(calls)('%s · ผู้ดูรายงานทำไม่ได้', async (_name, call) => {
    signedInAs('reporter')
    await expect(call()).rejects.toThrow('ไม่มีสิทธิ์')
    expect(state.writes).toEqual([])
  })

  /**
   * ผู้ดูแลเนื้อหาแก้รางวัลไม่ได้
   *
   * A reward is what a campaign owes people, and the quota is how much of it
   * exists. That is not content, and the person who edits the copy on a card
   * has no reason to be able to promise another five hundred coupons.
   */
  it.each(calls)('%s · ผู้ดูแลเนื้อหาทำไม่ได้ เพราะโควตาคือของที่แจกจริง', async (_name, call) => {
    signedInAs('content_editor')
    await expect(call()).rejects.toThrow('ไม่มีสิทธิ์')
    expect(state.writes).toEqual([])
  })

  it.each(calls)('%s · ผู้ตั้งค่าแคมเปญทำได้', async (_name, call) => {
    signedInAs('configurator')
    await call()
    expect(state.writes.length).toBeGreaterThan(0)
  })
})

describe('saveReward · ค่าที่รับและไม่รับ', () => {
  beforeEach(() => signedInAs('configurator'))

  it('แคมเปญที่ไม่มีอยู่ ไม่มีอะไรถูกเขียน', async () => {
    await expect(saveReward('camp-ไม่มี', '', rewardForm())).rejects.toThrow('ไม่พบแคมเปญนี้')
    expect(state.writes).toEqual([])
  })

  it('ชนิดที่ไม่ได้อยู่ใน CHECK ของตาราง ถูกปฏิเสธก่อนถึงฐานข้อมูล', async () => {
    for (const type of ['', 'coupon', 'CODE', 'sticker']) {
      await expect(saveReward('camp-1', '', rewardForm({ reward_type: type })), type)
        .rejects.toThrow('ต้องเลือกชนิดรางวัล')
    }
    expect(state.writes).toEqual([])
  })

  it('รหัสที่ไม่ใช่ a-z 0-9 ขีดล่าง ถูกปฏิเสธ', async () => {
    for (const code of ['', 'Discount', 'discount-100', 'ส่วนลด', 'x'.repeat(21)]) {
      await expect(saveReward('camp-1', '', rewardForm({ code })), code)
        .rejects.toThrow('รหัสรางวัล')
    }
    expect(state.writes).toEqual([])
  })

  it('ลิงก์ที่ไม่ใช่ https ถูกปฏิเสธ · LINE ไม่เปิดลิงก์ http ให้', async () => {
    // ค่าว่างไม่อยู่ในชุดนี้ — มันเป็นคนละเรื่องกับรูปแบบผิด ดูเทสต์ถัดไป
    for (const value of ['example.com', 'http://example.com', 'ftp://x.co']) {
      await expect(
        saveReward('camp-1', '', rewardForm({ reward_type: 'link', value })), value,
      ).rejects.toThrow('https')
    }
    expect(state.writes).toEqual([])
  })

  it('ลิงก์ https ผ่าน และถูกเก็บลงคอลัมน์ค่า', async () => {
    await saveReward('camp-1', '', rewardForm({ reward_type: 'link', value: 'https://x.co/c' }))
    expect(writesTo(/INSERT INTO reward /)[0].values).toContain('https://x.co/c')
  })

  /**
   * ตอนสร้างกับตอนแก้ไม่เหมือนกัน และตั้งใจให้ไม่เหมือน
   *
   * ฟอร์มสร้างมีแต่ตัวตนของรางวัล เพราะช่องที่ใส่ภาพเป็นรายการภาพของแคมเปญ
   * ส่วนช่องที่ใส่ลิงก์เป็นกล่องข้อความ · หน้าจอที่ไม่มี client state จะโชว์
   * อันหนึ่งโดยไม่โชว์อีกอันไม่ได้ · หน้าถัดไปรู้ชนิดแล้วจึงถามให้ตรง
   *
   * แลกมาด้วยรางวัลที่สร้างแล้วยังไม่มีค่าอยู่ในระบบได้ชั่วคราว — จึงต้องมีคำเตือน
   * ค้างบนรางวัลนั้น และ publish ต้องไม่ปล่อยผ่าน
   */
  it('สร้างรางวัลโดยยังไม่ใส่ค่าได้ · เก็บเป็น null ไม่ใช่สตริงว่าง', async () => {
    await saveReward('camp-1', '', rewardForm({ reward_type: 'text', value: '' }))
    expect(state.writes).toHaveLength(1)
    expect(state.writes[0].values).toContain(null)
  })

  it('แก้รางวัลข้อความให้เหลือค่าว่าง ถูกปฏิเสธ', async () => {
    await expect(saveReward('camp-1', 'rw-1', rewardForm({ reward_type: 'text', value: '  ' })))
      .rejects.toThrow('ข้อความรางวัล')
    expect(state.writes).toEqual([])
  })

  it('แก้รางวัลภาพให้ไม่มีภาพ ถูกปฏิเสธ', async () => {
    await expect(saveReward('camp-1', 'rw-1', rewardForm({ reward_type: 'image', value: '' })))
      .rejects.toThrow('ภาพรางวัล')
    expect(state.writes).toEqual([])
  })

  it('รูปแบบลิงก์ผิด ถูกปฏิเสธทั้งตอนสร้างและตอนแก้ — คนละเรื่องกับค่าว่าง', async () => {
    for (const rewardId of ['', 'rw-1']) {
      await expect(
        saveReward('camp-1', rewardId, rewardForm({ reward_type: 'link', value: 'http://x.co' })),
        rewardId || 'สร้างใหม่',
      ).rejects.toThrow('https')
    }
  })

  /**
   * ชนิดรหัสไม่มีช่องค่า · ค่าอยู่ในคลังรหัส หนึ่งแถวต่อหนึ่งรหัส
   */
  it('ชนิดรหัส เก็บค่าเป็น null แม้ฟอร์มจะแอบส่งค่ามา', async () => {
    await saveReward('camp-1', '', rewardForm({ reward_type: 'code', value: 'MELO-XXXX' }))
    const [insert] = writesTo(/INSERT INTO reward /)
    expect(insert.values).toContain(null)
    expect(insert.values).not.toContain('MELO-XXXX')
  })

  it('โควตาที่ไม่ใช่จำนวนเต็ม ถูกปฏิเสธ', async () => {
    for (const quota of ['-1', '1.5', 'ห้าร้อย', '500 ใบ']) {
      await expect(saveReward('camp-1', '', rewardForm({ quota })), quota)
        .rejects.toThrow('โควตา')
    }
    expect(state.writes).toEqual([])
  })

  it('โควตาที่เว้นว่าง แปลว่าไม่จำกัด ไม่ใช่ศูนย์', async () => {
    await saveReward('camp-1', '', rewardForm({ quota: '' }))
    expect(writesTo(/INSERT INTO reward /)[0].values).toContain(null)
  })

  it('อายุสิทธิ์และจำนวนครั้งที่ไม่ใช่จำนวนเต็มบวก ถูกปฏิเสธ', async () => {
    await expect(saveReward('camp-1', '', rewardForm({ valid_days: '0' })))
      .rejects.toThrow('อายุสิทธิ์')
    await expect(saveReward('camp-1', '', rewardForm({ use_limit: '0' })))
      .rejects.toThrow('จำนวนครั้ง')
    expect(state.writes).toEqual([])
  })

  /**
   * แจกไปแล้วเป็นของที่จอนี้อ่านอย่างเดียว
   *
   * The column belongs to the transaction that issues an entitlement. A form
   * field that reaches it would drift from the number of entitlements that
   * exist, and nothing in this system compares the two.
   */
  it('ค่า issued_count ที่ฟอร์มแอบส่งมา ไม่ไปถึงคอลัมน์', async () => {
    await saveReward('camp-1', '', rewardForm({ issued_count: '999' }))
    const [insert] = writesTo(/INSERT INTO reward /)
    expect(insert.text).not.toContain('issued_count')
    expect(insert.values).not.toContain('999')
    expect(insert.values).not.toContain(999)
  })

  it('แก้ของเดิมก็ไม่แตะ issued_count เหมือนกัน', async () => {
    await saveReward('camp-1', 'rw-1', rewardForm({ issued_count: '999' }))
    const [update] = writesTo(/UPDATE reward/)
    expect(update.text).not.toContain('issued_count')
    expect(update.values).not.toContain('999')
  })

  it('รหัสซ้ำในแคมเปญเดียวกัน ได้ประโยคที่บอกทางออก', async () => {
    state.failNextWriteWith = '23505'
    await expect(saveReward('camp-1', '', rewardForm({ code: 'discount_100' })))
      .rejects.toThrow('มีรางวัลรหัส "discount_100" อยู่แล้ว')
  })

  it('ข้อผิดพลาดอื่นของฐานข้อมูล ไม่ถูกแปลงเป็นเรื่องรหัสซ้ำ', async () => {
    state.failNextWriteWith = '23503'
    await expect(saveReward('camp-1', '', rewardForm())).rejects.toThrow('duplicate key value')
  })

  it('สร้างเสร็จพาไปหน้าของรางวัลที่เพิ่งสร้าง', async () => {
    await saveReward('camp-1', '', rewardForm())
    expect(state.redirectedTo).toBe('/campaigns/camp-1/rewards/rw-new')
  })
})

describe('saveReward · ตอนแก้ของเดิม', () => {
  beforeEach(() => signedInAs('configurator'))

  it('รางวัลของแคมเปญอื่น แก้ผ่าน id ของแคมเปญนี้ไม่ได้', async () => {
    state.campaigns = ['camp-1', 'camp-2']
    await expect(saveReward('camp-2', 'rw-1', rewardForm()))
      .rejects.toThrow('ไม่พบรางวัลนี้ในแคมเปญนี้')
    expect(state.writes).toEqual([])
  })

  it('แก้แล้วผูก campaign_id ไว้ใน WHERE ด้วย', async () => {
    await saveReward('camp-1', 'rw-1', rewardForm())
    const [update] = writesTo(/UPDATE reward/)
    expect(update.values).toContain('camp-1')
    expect(update.values).toContain('rw-1')
  })

  it('รหัสที่ส่งมาตอนแก้ ไม่ถูกเขียนทับของเดิม', async () => {
    await saveReward('camp-1', 'rw-1', rewardForm({ code: 'รหัสใหม่ที่ส่งแอบมา' }))
    const [update] = writesTo(/UPDATE reward/)
    expect(update.text).not.toContain('code =')
    expect(update.values).not.toContain('รหัสใหม่ที่ส่งแอบมา')
  })

  it('เปลี่ยนชนิดหลังมีคนได้รับไปแล้ว ถูกปฏิเสธพร้อมบอกจำนวนคน', async () => {
    state.rewards = [reward({ reward_type: 'code', issued_count: 8 })]
    await expect(saveReward('camp-1', 'rw-1', rewardForm({ reward_type: 'text', value: 'x' })))
      .rejects.toThrow('8')
    expect(state.writes).toEqual([])
  })

  it('มีคนได้รับแล้วแต่ไม่ได้เปลี่ยนชนิด ยังแก้โควตาได้', async () => {
    state.rewards = [reward({ reward_type: 'code', issued_count: 8 })]
    await saveReward('camp-1', 'rw-1', rewardForm({ quota: '500' }))
    expect(writesTo(/UPDATE reward/)).toHaveLength(1)
  })

  /** CHECK (quota IS NULL OR issued_count <= quota) · ที่นี่พูดเป็นประโยค */
  it('ลดโควตาต่ำกว่าที่แจกไปแล้ว ถูกปฏิเสธพร้อมตัวเลขจริง', async () => {
    state.rewards = [reward({ issued_count: 120 })]
    await expect(saveReward('camp-1', 'rw-1', rewardForm({ quota: '100' })))
      .rejects.toThrow('แจกไปแล้ว 120 สิทธิ์')
    expect(state.writes).toEqual([])
  })

  it('ลดโควตาลงมาเท่าที่แจกไปแล้วพอดี ยังทำได้', async () => {
    state.rewards = [reward({ issued_count: 120 })]
    await saveReward('camp-1', 'rw-1', rewardForm({ quota: '120' }))
    expect(writesTo(/UPDATE reward/)).toHaveLength(1)
  })

  it('เปลี่ยนเป็นไม่จำกัดโควตา ทำได้เสมอ', async () => {
    state.rewards = [reward({ issued_count: 120 })]
    await saveReward('camp-1', 'rw-1', rewardForm({ quota: '' }))
    expect(writesTo(/UPDATE reward/)).toHaveLength(1)
  })

  /** BR-55 · คูปองต้องมีอายุสิทธิ์และจำนวนครั้งเสมอ */
  it('รางวัลที่มีคูปองผูกอยู่ ปล่อยอายุสิทธิ์ว่างไม่ได้', async () => {
    state.rewards = [reward({ has_coupon: true })]
    await expect(saveReward('camp-1', 'rw-1', rewardForm({ valid_days: '', use_limit: '1' })))
      .rejects.toThrow('BR-55')
    expect(state.writes).toEqual([])
  })

  it('รางวัลที่มีคูปองผูกอยู่ ปล่อยจำนวนครั้งว่างไม่ได้', async () => {
    state.rewards = [reward({ has_coupon: true })]
    await expect(saveReward('camp-1', 'rw-1', rewardForm({ valid_days: '30', use_limit: '' })))
      .rejects.toThrow('BR-55')
  })

  it('รางวัลที่ไม่มีคูปอง ปล่อยว่างทั้งสองช่องได้', async () => {
    await saveReward('camp-1', 'rw-1', rewardForm({ valid_days: '', use_limit: '' }))
    expect(writesTo(/UPDATE reward/)).toHaveLength(1)
  })

  it('แก้เสร็จอยู่ที่เดิม ไม่พาไปไหน', async () => {
    await saveReward('camp-1', 'rw-1', rewardForm())
    expect(state.redirectedTo).toBeUndefined()
  })
})

describe('deleteReward', () => {
  beforeEach(() => signedInAs('configurator'))

  it('รางวัลที่ไม่ได้อยู่ในแคมเปญนี้ ลบไม่ได้', async () => {
    await expect(deleteReward('camp-1', 'ไม่มีตัวนี้')).rejects.toThrow('ไม่พบรางวัลนี้')
    expect(state.writes).toEqual([])
  })

  it('มีคนได้รับไปแล้ว ลบไม่ได้ และเหตุผลพูดถึง CASCADE', async () => {
    state.rewards = [reward({ issued_count: 3 })]
    await expect(deleteReward('camp-1', 'rw-1')).rejects.toThrow('CASCADE')
    expect(state.writes).toEqual([])
  })

  it('มีกิจกรรมหรือจุดปลดล็อกแจกอยู่ ลบไม่ได้ และบอกว่าใคร', async () => {
    state.users = [{ label: 'สุ่มรางวัล · ผลลัพธ์' }]
    await expect(deleteReward('camp-1', 'rw-1')).rejects.toThrow('สุ่มรางวัล')
    expect(state.writes).toEqual([])
  })

  it('ไม่มีใครเกี่ยวข้อง ลบได้ และผูก campaign_id ไว้ใน WHERE', async () => {
    await deleteReward('camp-1', 'rw-1')
    expect(writesTo(/DELETE FROM reward /)[0].values).toEqual(['rw-1', 'camp-1'])
  })
})

describe('importRewardCodes', () => {
  beforeEach(() => signedInAs('configurator'))

  it('รางวัลของแคมเปญอื่น นำเข้ารหัสใส่ไม่ได้', async () => {
    state.campaigns = ['camp-1', 'camp-2']
    await expect(importRewardCodes('camp-2', 'rw-1', form({ codes: 'MELO-A1B2' })))
      .rejects.toThrow('ไม่พบรางวัลนี้ในแคมเปญนี้')
    expect(state.writes).toEqual([])
  })

  it('รางวัลที่ไม่ใช่ชนิดรหัส นำเข้าไม่ได้ และบอกว่าต้องทำอะไรก่อน', async () => {
    state.rewards = [reward({ reward_type: 'link' })]
    await expect(importRewardCodes('camp-1', 'rw-1', form({ codes: 'MELO-A1B2' })))
      .rejects.toThrow('รหัสจากคลัง')
    expect(state.writes).toEqual([])
  })

  it('ทั้งชุดถูกเขียนด้วยคำสั่งเดียว · ครึ่งชุดจึงเป็นไปไม่ได้', async () => {
    await importRewardCodes('camp-1', 'rw-1', form({ codes: 'MELO-A1B2\nMELO-C3D4\nMELO-E5F6' }))
    const inserts = writesTo(/INSERT INTO reward_code/)
    expect(inserts).toHaveLength(1)
    expect(inserts[0].values).toContainEqual(['MELO-A1B2', 'MELO-C3D4', 'MELO-E5F6'])
  })

  it('มีแถวผิดปนมา ไม่นำเข้าเลยสักแถว', async () => {
    await expect(importRewardCodes('camp-1', 'rw-1', form({ codes: 'MELO-A1B2\nสั้น\nMELO-C3D4' })))
      .rejects.toThrow('ไม่นำเข้าเลยสักแถว')
    expect(writesTo(/INSERT INTO reward_code/)).toEqual([])
  })

  it('ซ้ำกันเองในชุดเดียว ไม่นำเข้าเลยสักแถว ไม่ใช่ตัดตัวซ้ำออกเงียบๆ', async () => {
    await expect(importRewardCodes('camp-1', 'rw-1', form({ codes: 'MELO-A1B2\nMELO-A1B2' })))
      .rejects.toThrow('ซ้ำกับแถว 1')
    expect(writesTo(/INSERT INTO reward_code/)).toEqual([])
  })

  it('ซ้ำกับรหัสที่มีอยู่แล้วในคลัง ไม่นำเข้าเลยสักแถว', async () => {
    state.existingCodes = ['MELO-A1B2']
    await expect(importRewardCodes('camp-1', 'rw-1', form({ codes: 'MELO-C3D4\nMELO-A1B2' })))
      .rejects.toThrow('มีอยู่ในคลังแล้ว')
    expect(writesTo(/INSERT INTO reward_code/)).toEqual([])
  })

  it('รหัสซ้ำที่แทรกเข้ามาระหว่างตรวจกับเขียน จบด้วยไม่มีแถวไหนเข้า', async () => {
    // คำสั่งเดียวล้มทั้งคำสั่ง · ไม่มีชุดย่อยไหนรอด และข้อความบอกให้โหลดหน้าใหม่
    state.failNextWriteWith = '23505'
    await expect(importRewardCodes('camp-1', 'rw-1', form({ codes: 'MELO-A1B2\nMELO-C3D4' })))
      .rejects.toThrow('ไม่นำเข้าเลยสักแถว')
  })

  it('วางมาแต่ช่องว่าง ถูกปฏิเสธ ไม่ใช่รายงานว่านำเข้าศูนย์รหัสสำเร็จ', async () => {
    await expect(importRewardCodes('camp-1', 'rw-1', form({ codes: '  \n\n' })))
      .rejects.toThrow('ยังไม่มีรหัส')
    expect(writesTo(/INSERT INTO reward_code/)).toEqual([])
  })

  it('รหัสที่นำเข้าผูกกับรางวัลนี้ ไม่ใช่ปล่อยลอย', async () => {
    await importRewardCodes('camp-1', 'rw-1', form({ codes: 'MELO-A1B2' }))
    expect(writesTo(/INSERT INTO reward_code/)[0].values).toContain('rw-1')
  })
})

describe('deleteRewardCode', () => {
  beforeEach(() => signedInAs('configurator'))

  it('รางวัลของแคมเปญอื่น ลบรหัสของมันไม่ได้', async () => {
    state.campaigns = ['camp-1', 'camp-2']
    await expect(deleteRewardCode('camp-2', 'rw-1', 'code-1'))
      .rejects.toThrow('ไม่พบรางวัลนี้ในแคมเปญนี้')
    expect(state.writes).toEqual([])
  })

  /**
   * รหัสที่จ่ายไปแล้วเป็นของที่ผู้เล่นถืออยู่
   *
   * entitlement.reward_code_id is the only record of which code went to whom,
   * so deleting an assigned row leaves somebody holding an entitlement that
   * names nothing.
   */
  it('รหัสที่จ่ายให้ผู้เล่นไปแล้ว ลบไม่ได้', async () => {
    state.deletedCodes = []
    await expect(deleteRewardCode('camp-1', 'rw-1', 'code-1'))
      .rejects.toThrow('ผู้เล่นไปแล้ว')
  })

  it('รหัสที่ยังไม่ได้จ่าย ลบได้ และคำสั่งกันรหัสที่จ่ายแล้วไว้ในตัวมันเอง', async () => {
    await deleteRewardCode('camp-1', 'rw-1', 'code-1')
    const [remove] = writesTo(/DELETE FROM reward_code/)
    expect(remove.text).toContain('assigned_to IS NULL')
    expect(remove.values).toEqual(['code-1', 'rw-1'])
  })
})
