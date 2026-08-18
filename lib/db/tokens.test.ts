import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type postgres from 'postgres'
import { encryptSecret } from '../crypto/secretbox'
import { readChannelSecret } from './tokens'

type ChannelRow = {
  encrypted_token: string | null
  encrypted_secret: string | null
  key_version: number | null
}

const state: {
  channel: ChannelRow | undefined
  statements: Array<{ text: string; values: unknown[] }>
} = { channel: undefined, statements: [] }

/**
 * sql ปลอมที่จำทุกคำสั่งไว้ตามลำดับ
 *
 * The order matters more than the content here: the audit row has to be written
 * before the plaintext exists, so a decrypt that throws still leaves the trace.
 * A fake that only recorded the last statement could not tell the difference.
 */
const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join(' ? ').replace(/\s+/g, ' ').trim()
  state.statements.push({ text, values })

  if (/^SELECT/.test(text)) return Promise.resolve(state.channel ? [state.channel] : [])
  return Promise.resolve([])
}) as unknown as postgres.Sql

const saved = { ...process.env }

beforeEach(() => {
  process.env.SECRET_KEY_V1 = randomBytes(32).toString('base64')
  state.channel = undefined
  state.statements = []
})

afterEach(() => { process.env = { ...saved } })

const withToken = (plain: string) => {
  const token = encryptSecret(plain)
  const secret = encryptSecret(`${plain}-secret`)
  state.channel = {
    encrypted_token: token.cipher,
    encrypted_secret: secret.cipher,
    key_version: token.keyVersion,
  }
}

const logs = () => state.statements.filter((s) => /INSERT INTO token_access_log/.test(s.text))

describe('readChannelSecret', () => {
  it('คืนกุญแจตัวจริงที่ถอดแล้ว', async () => {
    withToken('line-token-abcd')
    const got = await readChannelSecret(sql, {
      channelId: 'ch1', field: 'token', purpose: 'send_reply', appUserId: null,
    })
    expect(got).toBe('line-token-abcd')
  })

  it('อ่าน channel secret ได้จากช่องของมันเอง ไม่ใช่ช่องของโทเคน', async () => {
    withToken('line-token-abcd')
    const got = await readChannelSecret(sql, {
      channelId: 'ch1', field: 'secret', purpose: 'verify_signature', appUserId: null,
    })
    expect(got).toBe('line-token-abcd-secret')
  })
})

/**
 * ทุกครั้งที่ถอด ต้องมีแถวใน token_access_log
 *
 * The table cannot be backfilled: a read that happened without a row is a read
 * nobody can ever find out about. That is why the row is written before the
 * plaintext exists rather than after it is handed over.
 */
describe('ร่องรอยของการอ่านกุญแจ', () => {
  it('เขียนแถวลง token_access_log หนึ่งแถวต่อการอ่านหนึ่งครั้ง', async () => {
    withToken('t')
    await readChannelSecret(sql, {
      channelId: 'ch1', field: 'token', purpose: 'publish', appUserId: 'u1',
    })
    expect(logs()).toHaveLength(1)
  })

  it('แถวที่เขียนบอกบัญชี ผู้อ่าน และเหตุผล', async () => {
    withToken('t')
    await readChannelSecret(sql, {
      channelId: 'ch1', field: 'token', purpose: 'publish', appUserId: 'u1',
    })
    expect(logs()[0].values).toEqual(['ch1', 'user', 'u1', 'publish'])
  })

  it('ระบบอ่านเอง บันทึกเป็น system และไม่มีผู้ใช้', async () => {
    withToken('t')
    await readChannelSecret(sql, {
      channelId: 'ch1', field: 'token', purpose: 'send_reply', appUserId: null,
    })
    expect(logs()[0].values).toEqual(['ch1', 'system', null, 'send_reply'])
  })

  // แถวต้องอยู่ก่อนที่ของจริงจะโผล่ ไม่ใช่หลัง · ไม่งั้นทางที่ล้มจะไม่ทิ้งร่องรอย
  it('บันทึกก่อนถอด ไม่ใช่หลังถอด', async () => {
    withToken('t')
    await readChannelSecret(sql, {
      channelId: 'ch1', field: 'token', purpose: 'publish', appUserId: 'u1',
    })
    const order = state.statements.map((s) => (/INSERT/.test(s.text) ? 'log' : 'read'))
    expect(order).toEqual(['read', 'log'])
  })

  it('ถอดไม่สำเร็จก็ยังมีร่องรอยว่ามีคนพยายามอ่าน', async () => {
    withToken('t')
    state.channel = { ...(state.channel as ChannelRow), encrypted_token: 'bm90LWEtY2lwaGVy' }

    await expect(readChannelSecret(sql, {
      channelId: 'ch1', field: 'token', purpose: 'publish', appUserId: 'u1',
    })).rejects.toThrow()

    expect(logs()).toHaveLength(1)
  })
})

describe('บัญชีที่อ่านกุญแจไม่ได้', () => {
  it('ไม่มีบัญชีนี้ โยนโดยไม่เขียน log — foreign key ไม่มีอะไรให้ชี้', async () => {
    state.channel = undefined
    await expect(readChannelSecret(sql, {
      channelId: 'ไม่มีจริง', field: 'token', purpose: 'publish', appUserId: 'u1',
    })).rejects.toThrow('ไม่พบบัญชี')
    expect(logs()).toEqual([])
  })

  // ชั้น preview ไม่มีกุญแจตาม CHECK ของตาราง · ขอมาก็ต้องได้คำตอบที่อ่านออก
  it('บัญชีที่ไม่มีกุญแจเก็บไว้ บอกว่ายังไม่ได้ผูก ไม่ใช่โยน error ของ base64', async () => {
    state.channel = { encrypted_token: null, encrypted_secret: null, key_version: null }
    await expect(readChannelSecret(sql, {
      channelId: 'ch1', field: 'token', purpose: 'publish', appUserId: 'u1',
    })).rejects.toThrow('ยังไม่ได้ผูกกุญแจ')
  })

  it('มีค่าเข้ารหัสแต่ไม่รู้ว่ารุ่นไหน ถือว่าอ่านไม่ได้', async () => {
    withToken('t')
    state.channel = { ...(state.channel as ChannelRow), key_version: null }
    await expect(readChannelSecret(sql, {
      channelId: 'ch1', field: 'token', purpose: 'publish', appUserId: 'u1',
    })).rejects.toThrow('ยังไม่ได้ผูกกุญแจ')
  })
})
