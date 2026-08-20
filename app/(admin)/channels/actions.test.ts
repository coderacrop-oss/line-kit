import { randomBytes } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionResult } from '@/lib/actions/result'
import { decryptSecret } from '@/lib/crypto/secretbox'

type UserRow = { id: string; email: string; role: string; is_active: boolean }
type ChannelRow = { id: string; channel_type: string; token_last4: string | null }

const state: {
  cookie: string | undefined
  user: UserRow | undefined
  channel: ChannelRow | undefined
  writes: Array<{ text: string; values: unknown[] }>
  writeError: { code: string } | undefined
} = { cookie: undefined, user: undefined, channel: undefined, writes: [], writeError: undefined }

const sql = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ? ').replace(/\s+/g, ' ').trim()

    if (/^SELECT/.test(text)) {
      if (/FROM app_user/.test(text)) return Promise.resolve(state.user ? [state.user] : [])
      if (/FROM channel/.test(text)) return Promise.resolve(state.channel ? [state.channel] : [])
      return Promise.resolve([])
    }

    state.writes.push({ text, values })
    if (state.writeError) return Promise.reject(state.writeError)
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
vi.mock('@/lib/db/client', () => ({ db: () => sql }))

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

/**
 * ต้อง return {ok:false,message} เสมอ ไม่ใช่ throw — Server Action ที่ throw
 * โดนเซ็นเซอร์ข้อความทิ้งในโปรดักชัน (ดู comment ของ saveChannel ใน ./actions.ts
 * และของ ChannelForm.tsx) ตัวช่วยนี้ยืนยันทั้งว่า ok เป็น false จริง และข้อความ
 * ตรงกับที่คาดไว้จริง ไม่ใช่แค่ไม่ throw เฉยๆ
 */
async function expectFailure(promise: Promise<ActionResult>, match: string): Promise<void> {
  const result = await promise
  expect(result.ok, 'คาดว่าปฏิเสธ (ok:false) แต่กลับสำเร็จ').toBe(false)
  if (!result.ok) expect(result.message).toContain(match)
}

async function expectSuccess(promise: Promise<ActionResult>): Promise<void> {
  const result = await promise
  expect(result.ok, `คาดว่าสำเร็จ (ok:true) แต่ได้ ${JSON.stringify(result)}`).toBe(true)
}

beforeEach(() => {
  process.env.SECRET_KEY_V1 = randomBytes(32).toString('base64')
  state.cookie = undefined
  state.user = undefined
  state.channel = { id: 'ch1', channel_type: 'test', token_last4: 'oldk' }
  state.writes = []
  state.writeError = undefined
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
    await expectFailure(saveChannel(null, validForm()), 'ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it('มีคุกกี้แต่ไม่มีชื่อในรายชื่อที่อนุญาต ผูกไม่ได้', async () => {
    state.cookie = 'ghost@example.com'
    await expectFailure(saveChannel(null, validForm()), 'ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it('สิทธิ์ถูกถอนแล้ว role เดิมไม่ช่วย', async () => {
    signedInAs('configurator', false)
    await expectFailure(saveChannel(null, validForm()), 'ต้องเข้าสู่ระบบก่อน')
    expect(state.writes).toEqual([])
  })

  it('ผู้ดูรายงานผูกไม่ได้', async () => {
    signedInAs('reporter')
    await expectFailure(saveChannel(null, validForm()), 'ไม่มีสิทธิ์')
    expect(state.writes).toEqual([])
  })

  // คีย์เวิร์ดให้ผู้ดูแลเนื้อหาแก้ได้ · กุญแจของ OA ไม่ให้ · คนละระดับของความเสียหาย
  it('ผู้ดูแลเนื้อหาผูกไม่ได้ แม้จะแก้คีย์เวิร์ดได้', async () => {
    signedInAs('content_editor')
    await expectFailure(saveChannel(null, validForm()), 'ไม่มีสิทธิ์')
    expect(state.writes).toEqual([])
  })

  it('แก้ของเดิมก็ต้องผ่านด่านเดียวกัน', async () => {
    signedInAs('content_editor')
    await expectFailure(saveChannel('ch1', validForm()), 'ไม่มีสิทธิ์')
    expect(state.writes).toEqual([])
  })

  it('ผู้ตั้งค่าแคมเปญผูกได้', async () => {
    signedInAs('configurator')
    await expectSuccess(saveChannel(null, validForm()))
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
    await expectSuccess(saveChannel(null, validForm()))
    for (const value of lastWrite().values) {
      expect(String(value)).not.toContain(TOKEN)
      expect(String(value)).not.toContain(SECRET)
    }
  })

  it('ค่าที่เขียนถอดกลับได้เป็นกุญแจเดิมทั้งสองตัว', async () => {
    await expectSuccess(saveChannel(null, validForm()))
    const values = lastWrite().values.map(String)
    const decrypted = values
      .map((value) => { try { return decryptSecret(value, 1) } catch { return null } })
      .filter((plain): plain is string => plain !== null)

    expect(decrypted).toContain(TOKEN)
    expect(decrypted).toContain(SECRET)
  })

  it('เก็บสี่ตัวท้ายของโทเคนไว้ให้หน้าจอ และไม่เกินสี่ตัว', async () => {
    await expectSuccess(saveChannel(null, validForm()))
    expect(lastWrite().values).toContain('wxyz')
    for (const value of lastWrite().values) {
      expect(String(value)).not.toBe(TOKEN.slice(-8))
    }
  })

  it('บันทึกรุ่นของกุญแจไว้ด้วย จะได้หมุนกุญแจทีหลังได้', async () => {
    await expectSuccess(saveChannel(null, validForm()))
    expect(lastWrite().text).toContain('key_version')
    expect(lastWrite().values).toContain(1)
  })

  it('โทเคนเดียวกันผูกสองบัญชี ได้ค่าที่เก็บคนละค่า', async () => {
    await expectSuccess(saveChannel(null, validForm()))
    const first = lastWrite().values.map(String)
    state.writes = []
    await expectSuccess(saveChannel(null, validForm()))
    const second = lastWrite().values.map(String)

    expect(first.filter((v) => second.includes(v) && v.length > 40)).toEqual([])
  })

  // ช่องว่างที่ติดมากับการก๊อป คือกุญแจผิดที่ LINE ปฏิเสธโดยไม่บอกว่าเพราะอะไร
  it('ตัดช่องว่างหัวท้ายของกุญแจก่อนเข้ารหัส', async () => {
    await expectSuccess(saveChannel(null, validForm({ access_token: `  ${TOKEN}\n`, channel_secret: ` ${SECRET} ` })))
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
      await expectFailure(saveChannel(null, validForm({ name })), 'ชื่อบัญชี')
      expect(state.writes).toEqual([])
    }
  })

  // CHECK ของตารางบังคับอยู่แล้ว · ที่นี่เป็นประโยคที่คนกรอกฟอร์มเอาไปแก้ได้
  it('บัญชีใหม่ที่ไม่มีกุญแจ ผูกไม่ได้ — CHECK ของตารางบังคับไว้', async () => {
    await expectFailure(saveChannel(null, validForm({ access_token: '', channel_secret: '' })), 'กุญแจ')
    expect(state.writes).toEqual([])
  })

  // ครึ่งเดียวคือคู่ที่ไม่เข้ากัน · โทเคนของ OA หนึ่ง กับซีเคร็ตของอีก OA หนึ่ง
  it('กรอกกุญแจมาแค่ช่องเดียว ผูกไม่ได้', async () => {
    const halves: Record<string, string>[] = [{ access_token: '' }, { channel_secret: '' }]
    for (const patch of halves) {
      state.writes = []
      await expectFailure(saveChannel(null, validForm(patch)), 'ทั้งสองช่อง')
      expect(state.writes).toEqual([])
    }
  })

  it('ชั้นของบัญชีที่ไม่มีจริง ผูกไม่ได้', async () => {
    for (const channelType of ['', 'sim', 'prod', 'PRODUCTION']) {
      state.writes = []
      await expectFailure(saveChannel(null, validForm({ channel_type: channelType })), 'ชั้นของบัญชี')
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
    await expectFailure(saveChannel(null, validForm({ channel_type: 'preview' })), 'ชั้นของบัญชี')
    expect(state.writes).toEqual([])
  })

  it('บัญชีชั้นทดลองเล่นในระบบที่มีอยู่แล้ว ก็แก้จากจอนี้ไม่ได้', async () => {
    state.channel = { id: 'ch1', channel_type: 'preview', token_last4: null }
    await expectFailure(saveChannel('ch1', validForm()), 'ทดลองเล่นในระบบ')
    expect(state.writes).toEqual([])
  })

  it('แก้บัญชีที่ไม่มีอยู่จริง ไม่เขียนอะไรเลย', async () => {
    state.channel = undefined
    await expectFailure(saveChannel('ไม่มีจริง', validForm()), 'ไม่พบบัญชี')
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
    await expectSuccess(saveChannel('ch1', validForm({ access_token: '', channel_secret: '' })))

    expect(lastWrite().text).toContain('UPDATE channel')
    expect(lastWrite().text).not.toContain('encrypted_token')
    expect(lastWrite().text).not.toContain('token_last4')
    expect(lastWrite().text).not.toContain('key_version')
  })

  it('เว้นช่องกุญแจไว้ ยังเปลี่ยนชื่อกับชั้นได้', async () => {
    await expectSuccess(saveChannel('ch1', validForm({
      name: 'ชื่อใหม่', channel_type: 'production', access_token: '', channel_secret: '',
    })))
    expect(lastWrite().values).toContain('ชื่อใหม่')
    expect(lastWrite().values).toContain('production')
  })

  it('กรอกกุญแจใหม่ทั้งคู่ เขียนทับทั้งชุดพร้อมสี่ตัวท้ายและรุ่น', async () => {
    await expectSuccess(saveChannel('ch1', validForm({ access_token: 'brand-new-token-1234', channel_secret: 'brand-new-secret' })))
    expect(lastWrite().text).toContain('UPDATE channel')
    expect(lastWrite().text).toContain('encrypted_token')
    expect(lastWrite().values).toContain('1234')
  })

  it('กรอกกุญแจใหม่มาช่องเดียวตอนแก้ ก็ยังไม่ได้', async () => {
    await expectFailure(saveChannel('ch1', validForm({ channel_secret: '' })), 'ทั้งสองช่อง')
    expect(state.writes).toEqual([])
  })

  it('แก้แถวที่ระบุมาเท่านั้น', async () => {
    await expectSuccess(saveChannel('ch1', validForm({ access_token: '', channel_secret: '' })))
    expect(lastWrite().text).toContain('WHERE id')
    expect(lastWrite().values).toContain('ch1')
  })
})

/**
 * Channel ID · ค่าเดียวที่ webhook ใช้จับคู่ข้อความที่เข้ามากับบัญชี — ไม่มีมันแล้ว
 * ทุกข้อความจากไลน์จริงหาแคมเปญไม่เจอ ไม่ว่ากุญแจจะถูกหรือผิด
 */
describe('saveChannel · Channel ID', () => {
  beforeEach(() => { signedInAs('configurator') })

  it('บัญชีใหม่ที่กรอก Channel ID เขียนค่านั้นลงไป', async () => {
    await expectSuccess(saveChannel(null, validForm({ line_channel_id: '1657123456' })))
    expect(lastWrite().values).toContain('1657123456')
  })

  it('เว้นช่อง Channel ID ไว้ เขียนเป็น NULL ไม่ใช่สตริงว่าง', async () => {
    await expectSuccess(saveChannel(null, validForm({ line_channel_id: '' })))
    expect(lastWrite().values).not.toContain('')
    expect(lastWrite().values).toContain(null)
  })

  it('ช่องว่างหัวท้ายถูกตัดก่อนเขียน', async () => {
    await expectSuccess(saveChannel(null, validForm({ line_channel_id: '  1657123456  ' })))
    expect(lastWrite().values).toContain('1657123456')
  })

  it('แก้ของเดิมโดยไม่แตะกุญแจ ยังปรับ Channel ID ได้', async () => {
    await expectSuccess(saveChannel('ch1', validForm({
      access_token: '', channel_secret: '', line_channel_id: '999',
    })))
    expect(lastWrite().text).toContain('UPDATE channel')
    expect(lastWrite().text).toContain('line_channel_id')
    expect(lastWrite().values).toContain('999')
  })

  it('Channel ID ซ้ำกับบัญชีอื่น บอกตรงๆ ว่าซ้ำ ไม่ใช่โยนรหัส constraint ดิบๆ', async () => {
    state.writeError = { code: '23505' }
    await expectFailure(saveChannel(null, validForm({ line_channel_id: '1657123456' })), 'ถูกผูกกับบัญชีอื่นอยู่แล้ว')
  })

  it('Channel ID ซ้ำตอนแก้ของเดิมโดยไม่แตะกุญแจ ก็ยังบอกตรงๆ', async () => {
    state.writeError = { code: '23505' }
    await expectFailure(saveChannel('ch1', validForm({
      access_token: '', channel_secret: '', line_channel_id: '1657123456',
    })), 'ถูกผูกกับบัญชีอื่นอยู่แล้ว')
  })

  // error อื่นที่ไม่ใช่ unique violation ต้องไม่ถูกกลืนเป็นข้อความ "ซ้ำ" ผิดๆ — ยังต้อง
  // return {ok:false} เสมอ (ห้าม throw ข้าม Server Action boundary) แต่ข้อความต้อง
  // เป็นข้อความทั่วไป ไม่ใช่ประโยคที่บอกว่า "ถูกผูกกับบัญชีอื่นอยู่แล้ว"
  it('error อื่นที่ไม่ใช่ Channel ID ซ้ำ ไม่ถูกแปลงเป็นข้อความ "ซ้ำ" ผิดๆ', async () => {
    state.writeError = { code: '23502' }
    const result = await saveChannel(null, validForm())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).not.toContain('ถูกผูกกับบัญชีอื่นอยู่แล้ว')
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
    await expectSuccess(saveChannel(null, validForm({ existing_keywords: 'โปรโมชั่น\nที่ตั้งสาขา\nเวลาเปิด' })))
    expect(keywordsWritten()).toEqual(['โปรโมชั่น', 'ที่ตั้งสาขา', 'เวลาเปิด'])
  })

  it('บรรทัดว่างและช่องว่างหัวท้ายหายไป', async () => {
    await expectSuccess(saveChannel(null, validForm({ existing_keywords: '  โปรโมชั่น  \n\n\n   \nสาขา\n' })))
    expect(keywordsWritten()).toEqual(['โปรโมชั่น', 'สาขา'])
  })

  it('ไม่กรอกเลย ได้รายการว่าง ไม่ใช่รายการที่มีสตริงว่างอยู่ข้างใน', async () => {
    await expectSuccess(saveChannel(null, validForm({ existing_keywords: '' })))
    expect(keywordsWritten()).toEqual([])
  })

  // คำซ้ำทำให้จอคีย์เวิร์ดเตือนเรื่องเดิมสองครั้ง
  it('คำซ้ำเก็บครั้งเดียว', async () => {
    await expectSuccess(saveChannel(null, validForm({ existing_keywords: 'สาขา\nสาขา\n สาขา ' })))
    expect(keywordsWritten()).toEqual(['สาขา'])
  })

  it('รับ CRLF ที่มาจากการก๊อปจากวินโดวส์', async () => {
    await expectSuccess(saveChannel(null, validForm({ existing_keywords: 'โปรโมชั่น\r\nสาขา' })))
    expect(keywordsWritten()).toEqual(['โปรโมชั่น', 'สาขา'])
  })
})

describe('saveChannel · หลังบันทึก', () => {
  beforeEach(() => { signedInAs('configurator') })

  // การพากลับไปหน้ารายการบัญชีเป็นหน้าที่ของฝั่ง client (ChannelForm.tsx เรียก
  // router.push('/channels') เมื่อเห็น ok:true) — ที่นี่ตรวจแค่ว่า action คืน
  // {ok:true} จริง ไม่ throw/redirect เอง ข้าม Server Action boundary
  it('สำเร็จแล้วคืน {ok:true} ให้ฝั่ง client พาไปหน้ารายการบัญชีเอง', async () => {
    await expectSuccess(saveChannel(null, validForm()))
  })

  it('บันทึกคนที่สร้างไว้กับแถว', async () => {
    await expectSuccess(saveChannel(null, validForm()))
    expect(lastWrite().text).toContain('created_by')
    expect(lastWrite().values).toContain('u1')
  })
})
