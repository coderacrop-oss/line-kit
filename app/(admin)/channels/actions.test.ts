import { randomBytes } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptSecret } from '@/lib/crypto/secretbox'

type UserRow = { id: string; email: string; role: string; is_active: boolean }
type ChannelRow = { id: string; channel_type: string; token_last4: string | null }

const state: {
  cookie: string | undefined
  user: UserRow | undefined
  channel: ChannelRow | undefined
  writes: Array<{ text: string; values: unknown[] }>
} = { cookie: undefined, user: undefined, channel: undefined, writes: [] }

const sql = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ? ').replace(/\s+/g, ' ').trim()

    if (/^SELECT/.test(text)) {
      if (/FROM app_user/.test(text)) return Promise.resolve(state.user ? [state.user] : [])
      if (/FROM channel/.test(text)) return Promise.resolve(state.channel ? [state.channel] : [])
      return Promise.resolve([])
    }

    state.writes.push({ text, values })
    return Promise.resolve([{ id: 'new-channel' }])
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
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ db: () => sql }))

const { redirect } = await import('next/navigation')
const { saveChannel } = await import('./actions')

const saved = { ...process.env }
afterAll(() => { process.env = { ...saved } })

const signedInAs = (role: string, isActive = true) => {
  state.cookie = 'someone@example.com'
  state.user = { id: 'u1', email: 'someone@example.com', role, is_active: isActive }
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const TOKEN = 'aVeryLongLineChannelAccessToken0000wxyz'
const SECRET = 'aChannelSecret0000'

const validForm = (patch: Record<string, string> = {}) =>
  form({
    name: 'OA ทดสอบของทีม',
    channel_type: 'test',
    access_token: TOKEN,
    channel_secret: SECRET,
    existing_keywords: '',
    ...patch,
  })

const lastWrite = () => {
  const write = state.writes.at(-1)
  if (!write) throw new Error('ไม่มีการเขียนเกิดขึ้น')
  return write
}

beforeEach(() => {
  process.env.SECRET_KEY_V1 = randomBytes(32).toString('base64')
  state.cookie = undefined
  state.user = undefined
  state.channel = { id: 'ch1', channel_type: 'test', token_last4: 'oldk' }
  state.writes = []
  vi.mocked(redirect).mockClear()
})

/**
 * ด่านอยู่ในตัว action ไม่ใช่ในหน้าจอ
 *
 * This screen writes the one thing in the system that lets somebody speak as the
 * brand. The form is hidden from everyone but a configurator, but the form is
 * not the door — the action is, and it answers to anyone who can name it.
 */
describe('saveChannel · ด่านสิทธิ์', () => {
  it('ยังไม่ได้เข้าระบบ ผูกบัญชีไม่ได้', async () => {
    await expect(saveChannel(null, validForm())).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it('มีคุกกี้แต่ไม่มีชื่อในรายชื่อที่อนุญาต ผูกไม่ได้', async () => {
    state.cookie = 'ghost@example.com'
    await expect(saveChannel(null, validForm())).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it('สิทธิ์ถูกถอนแล้ว role เดิมไม่ช่วย', async () => {
    signedInAs('configurator', false)
    await expect(saveChannel(null, validForm())).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it('ผู้ดูรายงานผูกไม่ได้', async () => {
    signedInAs('reporter')
    await expect(saveChannel(null, validForm())).rejects.toThrow('ไม่มีสิทธิ์')
    expect(state.writes).toEqual([])
  })

  // คีย์เวิร์ดให้ผู้ดูแลเนื้อหาแก้ได้ · กุญแจของ OA ไม่ให้ · คนละระดับของความเสียหาย
  it('ผู้ดูแลเนื้อหาผูกไม่ได้ แม้จะแก้คีย์เวิร์ดได้', async () => {
    signedInAs('content_editor')
    await expect(saveChannel(null, validForm())).rejects.toThrow('ไม่มีสิทธิ์')
    expect(state.writes).toEqual([])
  })

  it('แก้ของเดิมก็ต้องผ่านด่านเดียวกัน', async () => {
    signedInAs('content_editor')
    await expect(saveChannel('ch1', validForm())).rejects.toThrow('ไม่มีสิทธิ์')
    expect(state.writes).toEqual([])
  })

  it('ผู้ตั้งค่าแคมเปญผูกได้', async () => {
    signedInAs('configurator')
    await saveChannel(null, validForm())
    expect(lastWrite().text).toContain('INSERT INTO channel')
  })
})

/**
 * กุญแจที่เขียนลงตารางต้องเป็นของที่เข้ารหัสแล้ว (DD-03)
 *
 * The one thing this action exists to get right. A plaintext token in the column
 * is not visible from any screen, so nothing else in the system would ever
 * notice — which is why it is asserted on the values that go to the database
 * rather than on what comes back out.
 */
describe('saveChannel · กุญแจที่เขียนลงไป', () => {
  beforeEach(() => { signedInAs('configurator') })

  it('ไม่มีค่าไหนที่เขียนลงไปเป็นกุญแจตัวจริง', async () => {
    await saveChannel(null, validForm())
    for (const value of lastWrite().values) {
      expect(String(value)).not.toContain(TOKEN)
      expect(String(value)).not.toContain(SECRET)
    }
  })

  it('ค่าที่เขียนถอดกลับได้เป็นกุญแจเดิมทั้งสองตัว', async () => {
    await saveChannel(null, validForm())
    const values = lastWrite().values.map(String)
    const decrypted = values
      .map((value) => { try { return decryptSecret(value, 1) } catch { return null } })
      .filter((plain): plain is string => plain !== null)

    expect(decrypted).toContain(TOKEN)
    expect(decrypted).toContain(SECRET)
  })

  it('เก็บสี่ตัวท้ายของโทเคนไว้ให้หน้าจอ และไม่เกินสี่ตัว', async () => {
    await saveChannel(null, validForm())
    expect(lastWrite().values).toContain('wxyz')
    for (const value of lastWrite().values) {
      expect(String(value)).not.toBe(TOKEN.slice(-8))
    }
  })

  it('บันทึกรุ่นของกุญแจไว้ด้วย จะได้หมุนกุญแจทีหลังได้', async () => {
    await saveChannel(null, validForm())
    expect(lastWrite().text).toContain('key_version')
    expect(lastWrite().values).toContain(1)
  })

  it('โทเคนเดียวกันผูกสองบัญชี ได้ค่าที่เก็บคนละค่า', async () => {
    await saveChannel(null, validForm())
    const first = lastWrite().values.map(String)
    state.writes = []
    await saveChannel(null, validForm())
    const second = lastWrite().values.map(String)

    expect(first.filter((v) => second.includes(v) && v.length > 40)).toEqual([])
  })

  // ช่องว่างที่ติดมากับการก๊อป คือกุญแจผิดที่ LINE ปฏิเสธโดยไม่บอกว่าเพราะอะไร
  it('ตัดช่องว่างหัวท้ายของกุญแจก่อนเข้ารหัส', async () => {
    await saveChannel(null, validForm({ access_token: `  ${TOKEN}\n`, channel_secret: ` ${SECRET} ` }))
    const decrypted = lastWrite().values.map(String)
      .map((value) => { try { return decryptSecret(value, 1) } catch { return null } })

    expect(decrypted).toContain(TOKEN)
    expect(decrypted).toContain(SECRET)
    // สี่ตัวท้ายต้องเป็นของกุญแจ ไม่ใช่ของช่องว่าง
    expect(lastWrite().values).toContain('wxyz')
  })
})

describe('saveChannel · ช่องที่บังคับ', () => {
  beforeEach(() => { signedInAs('configurator') })

  it('ไม่มีชื่อบัญชี ผูกไม่ได้', async () => {
    for (const name of ['', '   ']) {
      state.writes = []
      await expect(saveChannel(null, validForm({ name })), JSON.stringify(name))
        .rejects.toThrow('ชื่อบัญชี')
      expect(state.writes).toEqual([])
    }
  })

  // CHECK ของตารางบังคับอยู่แล้ว · ที่นี่เป็นประโยคที่คนกรอกฟอร์มเอาไปแก้ได้
  it('บัญชีใหม่ที่ไม่มีกุญแจ ผูกไม่ได้ — CHECK ของตารางบังคับไว้', async () => {
    await expect(saveChannel(null, validForm({ access_token: '', channel_secret: '' })))
      .rejects.toThrow('กุญแจ')
    expect(state.writes).toEqual([])
  })

  // ครึ่งเดียวคือคู่ที่ไม่เข้ากัน · โทเคนของ OA หนึ่ง กับซีเคร็ตของอีก OA หนึ่ง
  it('กรอกกุญแจมาแค่ช่องเดียว ผูกไม่ได้', async () => {
    const halves: Record<string, string>[] = [{ access_token: '' }, { channel_secret: '' }]
    for (const patch of halves) {
      state.writes = []
      await expect(saveChannel(null, validForm(patch)), JSON.stringify(patch))
        .rejects.toThrow('ทั้งสองช่อง')
      expect(state.writes).toEqual([])
    }
  })

  it('ชั้นของบัญชีที่ไม่มีจริง ผูกไม่ได้', async () => {
    for (const channelType of ['', 'sim', 'prod', 'PRODUCTION']) {
      state.writes = []
      await expect(saveChannel(null, validForm({ channel_type: channelType })), channelType)
        .rejects.toThrow('ชั้นของบัญชี')
      expect(state.writes).toEqual([])
    }
  })

  /**
   * ชั้น preview สร้างจากจอนี้ไม่ได้
   *
   * The table's CHECK says a preview channel holds no keys, and keys are the
   * only thing this screen writes. Offering the tier would produce a row the
   * database refuses, explained by a constraint name instead of a sentence.
   */
  it('สร้างบัญชีชั้นทดลองเล่นในระบบจากจอนี้ไม่ได้', async () => {
    await expect(saveChannel(null, validForm({ channel_type: 'preview' })))
      .rejects.toThrow('ชั้นของบัญชี')
    expect(state.writes).toEqual([])
  })

  it('บัญชีชั้นทดลองเล่นในระบบที่มีอยู่แล้ว ก็แก้จากจอนี้ไม่ได้', async () => {
    state.channel = { id: 'ch1', channel_type: 'preview', token_last4: null }
    await expect(saveChannel('ch1', validForm())).rejects.toThrow('ทดลองเล่นในระบบ')
    expect(state.writes).toEqual([])
  })

  it('แก้บัญชีที่ไม่มีอยู่จริง ไม่เขียนอะไรเลย', async () => {
    state.channel = undefined
    await expect(saveChannel('ไม่มีจริง', validForm())).rejects.toThrow('ไม่พบบัญชี')
    expect(state.writes).toEqual([])
  })
})

/**
 * แก้ของเดิมโดยไม่กรอกกุญแจใหม่ = ไม่แตะกุญแจเดิม
 *
 * The screen cannot show the key, so it cannot put it back in the field either.
 * If a blank field meant "clear it", every rename would silently unbind the OA,
 * and the campaign would stop replying with nothing on any screen to say why.
 */
describe('saveChannel · แก้ของเดิม', () => {
  beforeEach(() => { signedInAs('configurator') })

  it('เว้นช่องกุญแจไว้ ไม่แตะกุญแจเดิมเลย', async () => {
    await saveChannel('ch1', validForm({ access_token: '', channel_secret: '' }))

    expect(lastWrite().text).toContain('UPDATE channel')
    expect(lastWrite().text).not.toContain('encrypted_token')
    expect(lastWrite().text).not.toContain('token_last4')
    expect(lastWrite().text).not.toContain('key_version')
  })

  it('เว้นช่องกุญแจไว้ ยังเปลี่ยนชื่อกับชั้นได้', async () => {
    await saveChannel('ch1', validForm({
      name: 'ชื่อใหม่', channel_type: 'production', access_token: '', channel_secret: '',
    }))
    expect(lastWrite().values).toContain('ชื่อใหม่')
    expect(lastWrite().values).toContain('production')
  })

  it('กรอกกุญแจใหม่ทั้งคู่ เขียนทับทั้งชุดพร้อมสี่ตัวท้ายและรุ่น', async () => {
    await saveChannel('ch1', validForm({ access_token: 'brand-new-token-1234', channel_secret: 'brand-new-secret' }))
    expect(lastWrite().text).toContain('UPDATE channel')
    expect(lastWrite().text).toContain('encrypted_token')
    expect(lastWrite().values).toContain('1234')
  })

  it('กรอกกุญแจใหม่มาช่องเดียวตอนแก้ ก็ยังไม่ได้', async () => {
    await expect(saveChannel('ch1', validForm({ channel_secret: '' })))
      .rejects.toThrow('ทั้งสองช่อง')
    expect(state.writes).toEqual([])
  })

  it('แก้แถวที่ระบุมาเท่านั้น', async () => {
    await saveChannel('ch1', validForm({ access_token: '', channel_secret: '' }))
    expect(lastWrite().text).toContain('WHERE id')
    expect(lastWrite().values).toContain('ch1')
  })
})

/**
 * คีย์เวิร์ดเดิมของลูกค้า · SA กรอกจาก OA Manager (BR-44)
 *
 * The keyword screen reads this column to warn that a word it is about to hand
 * out is already answered by the client's own auto-reply. Whatever is stored
 * here has to survive the trip as a list, because one blob of text would produce
 * exactly one collision warning and never the right one.
 */
describe('saveChannel · คีย์เวิร์ดเดิมของลูกค้า', () => {
  beforeEach(() => { signedInAs('configurator') })

  const keywordsWritten = () =>
    lastWrite().values.find((value) => Array.isArray(value)) as string[] | undefined

  it('บรรทัดละคำ กลายเป็นรายการ', async () => {
    await saveChannel(null, validForm({ existing_keywords: 'โปรโมชั่น\nที่ตั้งสาขา\nเวลาเปิด' }))
    expect(keywordsWritten()).toEqual(['โปรโมชั่น', 'ที่ตั้งสาขา', 'เวลาเปิด'])
  })

  it('บรรทัดว่างและช่องว่างหัวท้ายหายไป', async () => {
    await saveChannel(null, validForm({ existing_keywords: '  โปรโมชั่น  \n\n\n   \nสาขา\n' }))
    expect(keywordsWritten()).toEqual(['โปรโมชั่น', 'สาขา'])
  })

  it('ไม่กรอกเลย ได้รายการว่าง ไม่ใช่รายการที่มีสตริงว่างอยู่ข้างใน', async () => {
    await saveChannel(null, validForm({ existing_keywords: '' }))
    expect(keywordsWritten()).toEqual([])
  })

  // คำซ้ำทำให้จอคีย์เวิร์ดเตือนเรื่องเดิมสองครั้ง
  it('คำซ้ำเก็บครั้งเดียว', async () => {
    await saveChannel(null, validForm({ existing_keywords: 'สาขา\nสาขา\n สาขา ' }))
    expect(keywordsWritten()).toEqual(['สาขา'])
  })

  it('รับ CRLF ที่มาจากการก๊อปจากวินโดวส์', async () => {
    await saveChannel(null, validForm({ existing_keywords: 'โปรโมชั่น\r\nสาขา' }))
    expect(keywordsWritten()).toEqual(['โปรโมชั่น', 'สาขา'])
  })
})

describe('saveChannel · หลังบันทึก', () => {
  beforeEach(() => { signedInAs('configurator') })

  it('พากลับไปหน้ารายการบัญชี', async () => {
    await saveChannel(null, validForm())
    expect(vi.mocked(redirect)).toHaveBeenCalledWith('/channels')
  })

  it('บันทึกคนที่สร้างไว้กับแถว', async () => {
    await saveChannel(null, validForm())
    expect(lastWrite().text).toContain('created_by')
    expect(lastWrite().values).toContain('u1')
  })
})
