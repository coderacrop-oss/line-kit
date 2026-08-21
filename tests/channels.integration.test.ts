import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import { decryptSecret, encryptSecret } from '../lib/crypto/secretbox'
import { findChannelByBotUserId, findTestSendChannel, listChannels, loadChannel } from '../lib/db/channels'
import { readChannelSecret } from '../lib/db/tokens'
import { testDb } from '../lib/db/client'
import { seed } from './helpers/seed'

/**
 * Server Action ตัวจริง ยิงใส่ตารางจริง · และ CHECK ตัวจริงเป็นคนปฏิเสธ
 *
 * actions.test.ts drives saveChannel against a fake sql that answers every
 * statement the same way, which proves the guards and proves nothing about the
 * SQL or about the constraints underneath it. The rule that a preview channel
 * carries no keys and every other tier carries both is written in the table, not
 * in the action, and only a real table can be asked whether it means it.
 *
 * Only the session and the cache are faked here.
 */
let cookie: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'fsb_email' && cookie ? { value: cookie } : undefined),
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/db/client')>()),
  db: () => sql,
}))

const { saveChannel } = await import('../app/(admin)/channels/actions')

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'

let sql: postgres.Sql

const saved = { ...process.env }

beforeAll(async () => {
  // กุญแจของเทสต์สร้างสดทุกครั้ง · ไม่อ่านจาก .env และไม่มีค่าจริงอยู่ในไฟล์นี้
  process.env.SECRET_KEY_V1 = randomBytes(32).toString('base64')
  sql = testDb(url)
  await sql`SELECT 1`
})

afterAll(async () => {
  process.env = { ...saved }
  await sql?.end({ timeout: 5 })
})

let unique = 0
const tag = () =>
  `t${Date.now().toString(36)}${(unique++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

const aUser = async () => {
  const [user] = await sql<{ id: string; email: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`ch-${tag()}@example.com`}, 'configurator')
    RETURNING id, email`
  return user
}

const TOKEN = 'aVeryLongLineChannelAccessTokenThatNobodyShouldSeeWXYZ'
const SECRET = 'aChannelSecretThatNobodyShouldSee'

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const validForm = (patch: Record<string, string> = {}) =>
  form({
    name: `OA ${tag()}`,
    channel_type: 'test',
    access_token: TOKEN,
    channel_secret: SECRET,
    existing_keywords: '',
    ...patch,
  })

const rawChannel = (id: string) => sql<{
  name: string
  channel_type: string
  encrypted_token: string | null
  encrypted_secret: string | null
  token_last4: string | null
  key_version: number | null
  existing_keywords: string[]
  created_by: string
}[]>`SELECT name, channel_type, encrypted_token, encrypted_secret, token_last4,
            key_version, existing_keywords, created_by
       FROM channel WHERE id = ${id}`

const newestChannelOf = async (userId: string) => {
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM channel WHERE created_by = ${userId} ORDER BY created_at DESC LIMIT 1`
  return row?.id
}

beforeEach(() => { cookie = undefined })

/**
 * กติกาที่ตารางบังคับเอง ไม่ใช่ที่หน้าจอบังคับ
 *
 * The action produces a readable sentence for each of these, but the sentence is
 * a courtesy. These assert the table refuses regardless of who is writing — a
 * migration, a psql session, or a screen written next year that forgets.
 */
describe('channel · CHECK ของชั้นกับกุญแจ', () => {
  const insert = async (
    channelType: string,
    keys: { token?: string | null; secret?: string | null } = {},
  ) => {
    const user = await aUser()
    return sql`
      INSERT INTO channel (name, channel_type, encrypted_token, encrypted_secret, created_by)
      VALUES (${`OA ${tag()}`}, ${channelType}, ${keys.token ?? null}, ${keys.secret ?? null},
              ${user.id})`
  }

  it('ชั้น preview ที่ไม่มีกุญแจเลย ผ่าน', async () => {
    await expect(insert('preview')).resolves.toBeDefined()
  })

  it('ชั้น preview ที่มีโทเคน ถูกปฏิเสธ', async () => {
    await expect(insert('preview', { token: 'x', secret: 'y' }))
      .rejects.toThrow(/violates check constraint/i)
  })

  it('ชั้น preview ที่มีแค่โทเคน ก็ยังถูกปฏิเสธ', async () => {
    await expect(insert('preview', { token: 'x' }))
      .rejects.toThrow(/violates check constraint/i)
  })

  it('ชั้น preview ที่มีแค่ซีเคร็ต ก็ยังถูกปฏิเสธ', async () => {
    await expect(insert('preview', { secret: 'y' }))
      .rejects.toThrow(/violates check constraint/i)
  })

  for (const tier of ['test', 'production']) {
    it(`ชั้น ${tier} ที่มีกุญแจครบทั้งคู่ ผ่าน`, async () => {
      await expect(insert(tier, { token: 'x', secret: 'y' })).resolves.toBeDefined()
    })

    it(`ชั้น ${tier} ที่ไม่มีกุญแจเลย ถูกปฏิเสธ`, async () => {
      await expect(insert(tier)).rejects.toThrow(/violates check constraint/i)
    })

    it(`ชั้น ${tier} ที่มีแค่โทเคน ถูกปฏิเสธ`, async () => {
      await expect(insert(tier, { token: 'x' })).rejects.toThrow(/violates check constraint/i)
    })

    it(`ชั้น ${tier} ที่มีแค่ซีเคร็ต ถูกปฏิเสธ`, async () => {
      await expect(insert(tier, { secret: 'y' })).rejects.toThrow(/violates check constraint/i)
    })
  }

  it('ชั้นที่ไม่มีอยู่ในสามชั้น ถูกปฏิเสธ', async () => {
    for (const tier of ['sim', 'prod', 'PRODUCTION', '']) {
      await expect(insert(tier, { token: 'x', secret: 'y' }), tier)
        .rejects.toThrow(/violates check constraint/i)
    }
  })

  // BR-68 · บัญชี LINE หนึ่งบัญชีมีได้แถวเดียวในระบบ
  it('รหัสช่องของ LINE ซ้ำกันสองแถว ถูกปฏิเสธ (UNIQUE)', async () => {
    const user = await aUser()
    const lineId = `L-${tag()}`
    const add = () => sql`
      INSERT INTO channel (name, channel_type, line_channel_id, encrypted_token, encrypted_secret, created_by)
      VALUES (${`OA ${tag()}`}, 'test', ${lineId}, 'x', 'y', ${user.id})`

    await add()
    await expect(add()).rejects.toThrow(/duplicate key value|unique constraint/i)
  })
})

/**
 * กุญแจที่ลงไปนอนในตาราง ต้องอ่านไม่ออก (DD-03)
 *
 * The one assertion that has to be made against the real column: what the
 * action believes it wrote and what postgres actually holds are two different
 * facts, and only one of them is the one that leaks.
 */
describe('saveChannel · สิ่งที่ลงไปอยู่ในคอลัมน์จริง', () => {
  it('คอลัมน์ไม่มีกุญแจตัวจริงอยู่ในนั้น แต่ถอดกลับได้', async () => {
    const user = await aUser()
    cookie = user.email
    await saveChannel(null, validForm())

    const id = await newestChannelOf(user.id)
    const [row] = await rawChannel(id as string)

    expect(row.encrypted_token).not.toBe(TOKEN)
    expect(row.encrypted_token).not.toContain(TOKEN)
    expect(row.encrypted_secret).not.toContain(SECRET)
    expect(decryptSecret(row.encrypted_token as string, row.key_version as number)).toBe(TOKEN)
    expect(decryptSecret(row.encrypted_secret as string, row.key_version as number)).toBe(SECRET)
  })

  it('เก็บสี่ตัวท้ายไว้สี่ตัว ไม่ใช่มากกว่านั้น', async () => {
    const user = await aUser()
    cookie = user.email
    await saveChannel(null, validForm())

    const [row] = await rawChannel(await newestChannelOf(user.id) as string)
    expect(row.token_last4).toBe('WXYZ')
    expect((row.token_last4 as string).length).toBe(4)
  })

  it('คีย์เวิร์ดเดิมของลูกค้าลงไปเป็นอาเรย์จริงๆ ไม่ใช่ก้อนข้อความ', async () => {
    const user = await aUser()
    cookie = user.email
    await saveChannel(null, validForm({ existing_keywords: 'โปรโมชั่น\nที่ตั้งสาขา' }))

    const [row] = await rawChannel(await newestChannelOf(user.id) as string)
    expect(row.existing_keywords).toEqual(['โปรโมชั่น', 'ที่ตั้งสาขา'])
  })

  // CHECK ของตารางเป็นคนบังคับ · action แค่ไปถึงมันได้โดยไม่พัง
  it('ผูกบัญชีชั้น production ผ่าน CHECK ได้เพราะมีกุญแจครบ', async () => {
    const user = await aUser()
    cookie = user.email
    await saveChannel(null, validForm({ channel_type: 'production' }))

    const [row] = await rawChannel(await newestChannelOf(user.id) as string)
    expect(row.channel_type).toBe('production')
    expect(row.encrypted_token).not.toBeNull()
  })

  it('บันทึกว่าใครเป็นคนผูก', async () => {
    const user = await aUser()
    cookie = user.email
    await saveChannel(null, validForm())

    const [row] = await rawChannel(await newestChannelOf(user.id) as string)
    expect(row.created_by).toBe(user.id)
  })
})

describe('saveChannel · แก้ของเดิมบนตารางจริง', () => {
  const bind = async () => {
    const user = await aUser()
    cookie = user.email
    await saveChannel(null, validForm())
    const id = await newestChannelOf(user.id) as string
    const [row] = await rawChannel(id)
    return { user, id, before: row }
  }

  it('เว้นช่องกุญแจว่างไว้ ค่าที่เก็บไม่ขยับแม้แต่ไบต์เดียว', async () => {
    const { id, before } = await bind()

    await saveChannel(id, validForm({
      name: 'ชื่อใหม่หลังแก้', access_token: '', channel_secret: '',
    }))

    const [after] = await rawChannel(id)
    expect(after.name).toBe('ชื่อใหม่หลังแก้')
    expect(after.encrypted_token).toBe(before.encrypted_token)
    expect(after.encrypted_secret).toBe(before.encrypted_secret)
    expect(after.token_last4).toBe(before.token_last4)
  })

  it('กรอกกุญแจใหม่ ค่าที่เก็บเปลี่ยนและสี่ตัวท้ายเปลี่ยนตาม', async () => {
    const { id, before } = await bind()

    await saveChannel(id, validForm({
      access_token: 'another-token-0000-5678', channel_secret: 'another-secret',
    }))

    const [after] = await rawChannel(id)
    expect(after.encrypted_token).not.toBe(before.encrypted_token)
    expect(after.token_last4).toBe('5678')
    expect(decryptSecret(after.encrypted_token as string, after.key_version as number))
      .toBe('another-token-0000-5678')
  })

  // ชั้น preview ไม่มีกุญแจตาม CHECK · action ต้องปฏิเสธก่อนถึงตาราง
  it('บัญชีชั้น preview ที่ระบบสร้างไว้ แก้จากจอนี้ไม่ได้', async () => {
    const s = await seed(sql)
    const [row] = await sql<{ email: string }[]>`
      SELECT email FROM app_user WHERE id = ${s.userId}`
    cookie = row.email

    const result = await saveChannel(s.channelId, validForm())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('ทดลองเล่นในระบบ')

    const [after] = await rawChannel(s.channelId)
    expect(after.encrypted_token).toBeNull()
    expect(after.name).toBe('Seed preview')
  })

  it('ผู้ดูรายงานที่มีอยู่จริงในรายชื่อ ก็ยังผูกบัญชีไม่ได้', async () => {
    const user = await aUser()
    await sql`UPDATE app_user SET role = 'reporter' WHERE id = ${user.id}`
    cookie = user.email

    const result = await saveChannel(null, validForm())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('ไม่มีสิทธิ์')
    expect(await newestChannelOf(user.id)).toBeUndefined()
  })

  it('ผู้ดูแลเนื้อหาก็ยังผูกบัญชีไม่ได้', async () => {
    const user = await aUser()
    await sql`UPDATE app_user SET role = 'content_editor' WHERE id = ${user.id}`
    cookie = user.email

    const result = await saveChannel(null, validForm())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('ไม่มีสิทธิ์')
    expect(await newestChannelOf(user.id)).toBeUndefined()
  })

  it('บัญชีที่ถูกถอนสิทธิ์ ผูกไม่ได้แม้ยังมีแถวอยู่', async () => {
    const user = await aUser()
    await sql`UPDATE app_user SET is_active = false WHERE id = ${user.id}`
    cookie = user.email

    const result = await saveChannel(null, validForm())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('ต้องเข้าสู่ระบบก่อน')
    expect(await newestChannelOf(user.id)).toBeUndefined()
  })
})

/**
 * ของที่ส่งไปถึงหน้าจอ ไม่เคยมีกุญแจเต็มอยู่ในนั้น (BR-16)
 *
 * Asserted on the whole object rather than on the fields anyone remembered to
 * name: the promise is that there is no path at all, so the test looks for the
 * key anywhere in what comes back instead of in the places it expects it.
 */
describe('สิ่งที่หน้าจอได้รับ', () => {
  const bound = async () => {
    const user = await aUser()
    cookie = user.email
    await saveChannel(null, validForm({ existing_keywords: 'สาขา' }))
    const id = await newestChannelOf(user.id) as string
    const [raw] = await rawChannel(id)
    return { user, id, raw }
  }

  it('loadChannel ไม่คืนกุญแจ ไม่ว่าจะรูปดิบหรือรูปที่เข้ารหัสแล้ว', async () => {
    const { id, raw } = await bound()
    const channel = await loadChannel(sql, id)
    const shown = JSON.stringify(channel)

    expect(shown).not.toContain(TOKEN)
    expect(shown).not.toContain(SECRET)
    expect(shown).not.toContain(raw.encrypted_token as string)
    expect(shown).not.toContain(raw.encrypted_secret as string)
  })

  it('loadChannel คืนแค่สี่ตัวท้าย', async () => {
    const { id } = await bound()
    const channel = await loadChannel(sql, id)
    expect(channel?.tokenLast4).toBe('WXYZ')
  })

  it('listChannels ก็ไม่คืนกุญแจของแถวไหนเลย', async () => {
    const { id, raw } = await bound()
    const all = await listChannels(sql)
    const shown = JSON.stringify(all)

    expect(all.some((channel) => channel.id === id)).toBe(true)
    expect(shown).not.toContain(TOKEN)
    expect(shown).not.toContain(raw.encrypted_token as string)
  })

  it('บัญชีที่ไม่มีอยู่ คืน null ไม่ใช่โยน', async () => {
    expect(await loadChannel(sql, '00000000-0000-0000-0000-000000000000')).toBeNull()
  })

  // แคมเปญที่เปิดอยู่บนบัญชี · BR-68 บอกว่ามีได้ตัวเดียว
  it('บัญชีที่มีแคมเปญเปิดอยู่ บอกชื่อแคมเปญนั้นกลับมา', async () => {
    const s = await seed(sql)
    const channel = await loadChannel(sql, s.channelId)
    expect(channel?.liveCampaignName).toBe('Seed')
    expect(channel?.publishedVersion).toBe(1)
    // ใช้ join/เงื่อนไขเดียวกับ liveCampaignName — ต้องตอบตรงกับแคมเปญเดียวกันเสมอ
    expect(channel?.liveCampaignId).toBe(s.campaignId)
  })

  it('บัญชีที่ยังไม่มีแคมเปญไหนเปิดอยู่ คืน null', async () => {
    const { id } = await bound()
    const channel = await loadChannel(sql, id)
    expect(channel?.liveCampaignName).toBeNull()
    expect(channel?.liveCampaignId).toBeNull()
  })
})

/**
 * ทุกครั้งที่ถอดกุญแจ มีแถวใน token_access_log
 *
 * That table cannot be backfilled. A read that left no row is a read nobody can
 * ever find out about, which is the only kind worth worrying about.
 */
describe('readChannelSecret · ร่องรอยในตารางจริง', () => {
  const bound = async () => {
    const user = await aUser()
    cookie = user.email
    await saveChannel(null, validForm())
    return { user, id: await newestChannelOf(user.id) as string }
  }

  const logsOf = (channelId: string) => sql<{
    actor_type: string; app_user_id: string | null; purpose: string
  }[]>`SELECT actor_type, app_user_id, purpose FROM token_access_log
         WHERE channel_id = ${channelId} ORDER BY created_at`

  it('อ่านกุญแจได้ของเดิม และทิ้งแถวไว้หนึ่งแถว', async () => {
    const { user, id } = await bound()

    const got = await readChannelSecret(sql, {
      channelId: id, field: 'token', purpose: 'publish', appUserId: user.id,
    })

    expect(got).toBe(TOKEN)
    expect(await logsOf(id)).toEqual([
      { actor_type: 'user', app_user_id: user.id, purpose: 'publish' },
    ])
  })

  it('ระบบอ่านเอง ลงเป็น system ได้โดยไม่ต้องมีผู้ใช้ (CHECK ยอมรับ)', async () => {
    const { id } = await bound()

    await readChannelSecret(sql, {
      channelId: id, field: 'secret', purpose: 'verify_signature', appUserId: null,
    })

    expect(await logsOf(id)).toEqual([
      { actor_type: 'system', app_user_id: null, purpose: 'verify_signature' },
    ])
  })

  it('อ่านสองครั้ง ได้สองแถว ไม่ใช่แถวเดียวที่ถูกทับ', async () => {
    const { user, id } = await bound()
    await readChannelSecret(sql, { channelId: id, field: 'token', purpose: 'publish', appUserId: user.id })
    await readChannelSecret(sql, { channelId: id, field: 'token', purpose: 'send_reply', appUserId: user.id })

    expect((await logsOf(id)).map((row) => row.purpose)).toEqual(['publish', 'send_reply'])
  })

  it('ค่าที่ถูกแก้ในตาราง ถอดไม่ผ่าน แต่ยังทิ้งร่องรอยไว้', async () => {
    const { user, id } = await bound()
    const tampered = encryptSecret('ของคนอื่น').cipher
    // เปลี่ยนเนื้อในโดยไม่แตะรุ่นของกุญแจ · เหมือนคนที่เขียนตารางได้แต่ไม่มีกุญแจ
    await sql`UPDATE channel SET encrypted_token = ${`${tampered.slice(0, -4)}AAAA`} WHERE id = ${id}`

    await expect(readChannelSecret(sql, {
      channelId: id, field: 'token', purpose: 'publish', appUserId: user.id,
    })).rejects.toThrow()

    expect(await logsOf(id)).toHaveLength(1)
  })

  it('บัญชีที่ไม่มีอยู่ ไม่มีแถวไหนถูกเขียน', async () => {
    const before = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM token_access_log`

    await expect(readChannelSecret(sql, {
      channelId: '00000000-0000-0000-0000-000000000000',
      field: 'token', purpose: 'publish', appUserId: null,
    })).rejects.toThrow('ไม่พบบัญชี')

    const after = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM token_access_log`
    expect(after[0].n).toBe(before[0].n)
  })

  it('บัญชีชั้น preview ไม่มีกุญแจให้อ่าน และไม่ทิ้งร่องรอยของการอ่านที่ไม่ได้เกิดขึ้น', async () => {
    const s = await seed(sql)

    await expect(readChannelSecret(sql, {
      channelId: s.channelId, field: 'token', purpose: 'publish', appUserId: s.userId,
    })).rejects.toThrow('ยังไม่ได้ผูกกุญแจ')

    expect(await logsOf(s.channelId)).toEqual([])
  })
})

/**
 * BR-62 · ปุ่มส่งการ์ดทดสอบของ M3-S02 (Task 14) "ส่งได้เฉพาะผ่านบัญชีประเภททดลองเล่น
 * หรือทดสอบ ห้ามส่งผ่านบัญชีจริงของลูกค้า" — ฐานข้อมูลใช้ร่วมกันทุก worktree จึงยืนยัน
 * แค่พฤติกรรมสัมพัทธ์ (แถวของตัวเองต้องไม่/ต้องถูกเลือก) ไม่นับจำนวนทั้งตาราง
 */
describe('findTestSendChannel · BR-62', () => {
  const insert = async (opts: {
    type: 'preview' | 'test' | 'production'
    hasKey: boolean
    lastUsedAt: string
  }) => {
    const user = await aUser()
    const t = tag()
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO channel (name, channel_type, encrypted_token, encrypted_secret,
                           token_last4, key_version, last_used_at, created_by)
      VALUES (${`fts-${t}`}, ${opts.type},
              ${opts.hasKey ? 'cipher' : null}, ${opts.hasKey ? 'cipher' : null},
              ${opts.hasKey ? '1a2b' : null}, ${opts.hasKey ? 1 : null},
              ${opts.lastUsedAt}, ${user.id})
      RETURNING id`
    return row.id as string
  }

  it('บัญชี production ที่มีกุญแจ ไม่มีวันถูกเลือก ไม่ว่าจะใหม่แค่ไหน', async () => {
    const productionId = await insert({ type: 'production', hasKey: true, lastUsedAt: '9999-01-01' })

    const found = await findTestSendChannel(sql)

    expect(found?.id).not.toBe(productionId)
  })

  it('บัญชีทดสอบที่ใช้ล่าสุด (ในกลุ่มที่สร้างเอง) ถูกเลือกก่อนบัญชีทดสอบที่เก่ากว่า', async () => {
    // เวลาต้องอิงนาฬิกาจริง ไม่ใช่ค่าคงที่ — ตารางไม่ถูกล้างระหว่างรอบทดสอบ
    // แถวจากรอบก่อนที่ last_used_at เท่ากันเป๊ะจะ tie แล้ว ORDER BY ...,name
    // เลือกผิดแถวแบบไม่แน่นอน ค่าที่อิงเวลาปัจจุบันของนาฬิกาจริงเดินหน้าเสมอ
    // จึงชนะแถวเก่าได้ทุกรอบโดยไม่ต้องล้างตาราง
    const now = Date.now()
    await insert({ type: 'test', hasKey: true, lastUsedAt: new Date(now - 1000).toISOString() })
    const newestId = await insert({ type: 'test', hasKey: true, lastUsedAt: new Date(now).toISOString() })

    const found = await findTestSendChannel(sql)

    expect(found?.id).toBe(newestId)
  })

  it('บัญชีชั้น preview ไม่มีกุญแจให้ใช้ ไม่มีวันถูกเลือกแม้จะใหม่ที่สุด', async () => {
    const previewId = await insert({ type: 'preview', hasKey: false, lastUsedAt: '9999-01-03' })

    const found = await findTestSendChannel(sql)

    expect(found?.id).not.toBe(previewId)
  })
})

/**
 * destination ที่ LINE ส่งมาในทุก webhook — ต้องรู้แถวนี้ก่อนจะรู้ว่าจะตรวจลายเซ็น
 * ด้วยกุญแจของใคร (migration 0010) ตารางจริงเป็นคนบังคับ UNIQUE เต็ม ไม่ใช่แค่โค้ด
 * เชื่อว่ามันจริง
 */
describe('findChannelByBotUserId · destination → บัญชี', () => {
  const insertChannel = async (opts: { botUserId: string | null; lineChannelId?: string | null }) => {
    const user = await aUser()
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO channel (name, channel_type, line_channel_id, line_bot_user_id, created_by)
      VALUES (${`OA ${tag()}`}, 'preview', ${opts.lineChannelId ?? null}, ${opts.botUserId}, ${user.id})
      RETURNING id`
    return row.id as string
  }

  it('destination ที่ตรงกับบัญชีจริง คืนแถวนั้นพร้อม line_channel_id', async () => {
    const botUserId = `U-${tag()}`
    const id = await insertChannel({ botUserId, lineChannelId: `L-${tag()}` })

    const found = await findChannelByBotUserId(sql, botUserId)

    expect(found?.id).toBe(id)
  })

  it('destination ที่ไม่มีบัญชีไหนผูกไว้ คืน null', async () => {
    expect(await findChannelByBotUserId(sql, `U-ไม่มีอยู่จริง-${tag()}`)).toBeNull()
  })

  it('บัญชีที่ยังไม่ได้กรอก userId ของบอท (NULL) ไม่ถูกจับคู่กับอะไรเลย', async () => {
    await insertChannel({ botUserId: null })
    expect(await findChannelByBotUserId(sql, '')).toBeNull()
  })

  // Postgres ไม่นับ NULL ชนกันเองภายใต้ UNIQUE — หลายบัญชีที่ยังไม่กรอกต้องอยู่ด้วยกันได้
  it('มีหลายบัญชีที่ยังไม่กรอก userId ของบอท (NULL ซ้ำกันได้) ไม่ชนกัน', async () => {
    await expect(insertChannel({ botUserId: null })).resolves.toBeDefined()
    await expect(insertChannel({ botUserId: null })).resolves.toBeDefined()
  })

  it('userId ของบอทซ้ำกันสองแถว ถูกปฏิเสธ (UNIQUE)', async () => {
    const user = await aUser()
    const botUserId = `U-${tag()}`
    const add = () => sql`
      INSERT INTO channel (name, channel_type, line_bot_user_id, created_by)
      VALUES (${`OA ${tag()}`}, 'preview', ${botUserId}, ${user.id})`

    await add()
    await expect(add()).rejects.toThrow(/duplicate key value|unique constraint/i)
  })

  it('สองบัญชีคนละ destination กัน แต่ละแถวคืนถูกตัว ไม่ใช่แถวของอีกบัญชี', async () => {
    const botA = `U-A-${tag()}`
    const botB = `U-B-${tag()}`
    const idA = await insertChannel({ botUserId: botA, lineChannelId: `L-A-${tag()}` })
    const idB = await insertChannel({ botUserId: botB, lineChannelId: `L-B-${tag()}` })

    expect((await findChannelByBotUserId(sql, botA))?.id).toBe(idA)
    expect((await findChannelByBotUserId(sql, botB))?.id).toBe(idB)
  })
})
