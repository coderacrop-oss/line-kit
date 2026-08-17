import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  TABLES_NEVER_COPIED, TABLES_TO_COPY,
  describeCounts, rekeyStoragePath, validateDuplicate,
} from './duplicate'

describe('ก๊อปแคมเปญ', () => {
  it('ไม่ก๊อปบัญชีและกุญแจ', () => {
    for (const table of ['channel', 'campaign_channel']) {
      expect(TABLES_NEVER_COPIED).toContain(table)
      expect(TABLES_TO_COPY).not.toContain(table)
    }
  })

  it('ไม่ก๊อปข้อมูลผู้เล่นทุกชนิด', () => {
    for (const table of [
      'participant', 'participant_attribute', 'participant_activity',
      'counter_value', 'entitlement', 'play_lock', 'quiz_round', 'pending_input',
      'event_log', 'effect_log',
    ]) {
      expect(TABLES_NEVER_COPIED, `${table} ต้องห้ามก๊อป`).toContain(table)
      expect(TABLES_TO_COPY, `${table} ต้องห้ามก๊อป`).not.toContain(table)
    }
  })

  it('ก๊อป config ที่ควรก๊อป', () => {
    for (const table of ['card', 'card_block', 'activity', 'counter', 'reward', 'keyword_rule', 'asset']) {
      expect(TABLES_TO_COPY, `${table} ต้องก๊อป`).toContain(table)
    }
  })

  it('ไม่มีตารางไหนอยู่ทั้งสองรายการ', () => {
    expect(TABLES_TO_COPY.filter((t) => TABLES_NEVER_COPIED.includes(t))).toEqual([])
  })
})

/**
 * รายการที่เขียนไว้ ต้องเป็นรายการเดียวกับตารางที่มีอยู่จริงใน schema
 *
 * A list of table names is a string array: nothing about it fails when a name is
 * misspelled, and a misspelled entry in TABLES_NEVER_COPIED is a refusal that
 * refuses nothing. Reading the migration is what makes both lists answerable.
 */
describe('สองรายการนี้พูดถึงตารางที่มีอยู่จริง', () => {
  const schema = readFileSync('supabase/migrations/0001_init.sql', 'utf8')
  const declared = new Set(
    [...schema.matchAll(/CREATE TABLE (\w+)/g)].map((match) => match[1]),
  )

  it('อ่าน schema เจอตารางจริง — กันเคสที่ผ่านเพราะ regex ไม่เจออะไรเลย', () => {
    expect(declared.size).toBeGreaterThan(30)
  })

  it('ทุกชื่อใน TABLES_TO_COPY เป็นตารางที่มีอยู่', () => {
    expect(TABLES_TO_COPY.filter((table) => !declared.has(table))).toEqual([])
  })

  it('ทุกชื่อใน TABLES_NEVER_COPIED เป็นตารางที่มีอยู่', () => {
    expect(TABLES_NEVER_COPIED.filter((table) => !declared.has(table))).toEqual([])
  })

  /**
   * ตารางที่ผูกกับแคมเปญต้องถูกตัดสินไปแล้วว่าจะก๊อปหรือไม่ก๊อป
   *
   * A table nobody decided about is a table that quietly does not get copied,
   * and nobody finds out until a campaign is duplicated and something is
   * missing from it. `campaign` itself is the row being created rather than
   * copied, so it is on neither list on purpose.
   */
  it('ทุกตารางที่มีคอลัมน์ campaign_id อยู่ในรายการใดรายการหนึ่ง', () => {
    const withCampaignId = [...schema.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g)]
      .filter(([, , body]) => /^\s*campaign_id\s/m.test(body))
      .map(([, table]) => table)

    expect(withCampaignId.length).toBeGreaterThan(10)

    const decided = new Set([...TABLES_TO_COPY, ...TABLES_NEVER_COPIED, 'campaign'])
    expect(withCampaignId.filter((table) => !decided.has(table))).toEqual([])
  })
})

/**
 * ลำดับของการก๊อปต้องเป็นลำดับที่ FK ยอมรับได้
 *
 * Every one of these is a foreign key in 0001_init.sql. Copying a card_block
 * before its card is a violation the database reports by constraint name in the
 * middle of a transaction that then rolls the whole duplicate back — a failure
 * mode that only appears with data of exactly the right shape, which is to say
 * on somebody's real campaign rather than in a fixture.
 */
describe('ลำดับการก๊อป', () => {
  const before = (earlier: string, later: string) => {
    const a = TABLES_TO_COPY.indexOf(earlier)
    const b = TABLES_TO_COPY.indexOf(later)
    expect(a, `${earlier} ต้องอยู่ในรายการ`).toBeGreaterThanOrEqual(0)
    expect(b, `${later} ต้องอยู่ในรายการ`).toBeGreaterThanOrEqual(0)
    expect(a, `${earlier} ต้องถูกก๊อปก่อน ${later}`).toBeLessThan(b)
  }

  it('ของที่ถูกชี้ถึงถูกก๊อปก่อนของที่ชี้ไปหามัน', () => {
    before('asset', 'card')            // card.video_asset_id
    before('card', 'card_block')       // card_block.card_id
    before('card_selector', 'card_block') // card_block.selector_id
    before('card', 'activity')         // activity.fallback_card_id
    before('counter', 'counter_milestone')
    before('reward', 'coupon')
    before('counter', 'stamp_card')
    before('asset', 'stamp_card')
    before('card', 'stamp_card')
    before('activity', 'keyword_rule')
    before('card', 'keyword_rule')
    before('asset', 'rich_menu')
    before('card_selector', 'card_selector_option')
  })
})

/**
 * ที่อยู่ของไฟล์ต้องเปลี่ยน เพราะ storage_path เป็น UNIQUE ทั้งตาราง
 */
describe('rekeyStoragePath', () => {
  const SOURCE = '11111111-1111-1111-1111-111111111111'
  const TARGET = '22222222-2222-2222-2222-222222222222'

  it('เปลี่ยนเฉพาะท่อนของแคมเปญ · ชื่อไฟล์ที่คนอัปโหลดยังอยู่เหมือนเดิม', () => {
    const path = `uploads/${SOURCE}/abcd-efgh/ป้ายหน้าร้าน.png`
    expect(rekeyStoragePath(path, TARGET)).toBe(`uploads/${TARGET}/abcd-efgh/ป้ายหน้าร้าน.png`)
  })

  it('ที่อยู่ใหม่ไม่ซ้ำกับของเดิม', () => {
    const path = `uploads/${SOURCE}/abcd-efgh/a.png`
    expect(rekeyStoragePath(path, TARGET)).not.toBe(path)
  })

  it('ไฟล์คนละไฟล์ในแคมเปญเดียวกัน ยังคงได้คนละที่อยู่', () => {
    const first = rekeyStoragePath(`uploads/${SOURCE}/one/a.png`, TARGET)
    const second = rekeyStoragePath(`uploads/${SOURCE}/two/a.png`, TARGET)
    expect(first).not.toBe(second)
  })

  it('ที่อยู่รูปแบบอื่นถูกเติมหัวให้ ไม่ปล่อยผ่านไปชน UNIQUE', () => {
    expect(rekeyStoragePath('legacy/a.png', TARGET)).toBe(`uploads/${TARGET}/legacy/a.png`)
    expect(rekeyStoragePath('legacy/a.png', TARGET)).not.toBe('legacy/a.png')
  })
})

/**
 * วันเวลาไม่ถูกก๊อปมา · ตรวจก่อนแตะฐานข้อมูล
 */
describe('validateDuplicate', () => {
  const ok = {
    sourceId: 'c1', name: 'แคมเปญใหม่', code: 'melo_copy',
    startAt: '2026-09-01', endAt: '2026-09-30',
  }

  it('ครบถ้วนแล้วผ่าน', () => {
    expect(validateDuplicate(ok)).toBeNull()
  })

  it('ไม่ได้เลือกต้นทาง ไม่ผ่าน', () => {
    expect(validateDuplicate({ ...ok, sourceId: '' })).toContain('ต้นทาง')
  })

  it('ไม่มีชื่อ หรือมีแต่ช่องว่าง ไม่ผ่าน', () => {
    for (const name of ['', '   ']) {
      expect(validateDuplicate({ ...ok, name }), JSON.stringify(name)).toContain('ชื่อ')
    }
  })

  it('รหัสผิดรูปแบบไม่ผ่าน · ตรงกับ CHECK ของคอลัมน์', () => {
    for (const code of ['', 'MELO', 'melo-copy', 'เมโล', 'a'.repeat(21), 'melo copy']) {
      expect(validateDuplicate({ ...ok, code }), code).toContain('รหัส')
    }
  })

  it('รหัสที่ถูกต้องผ่าน', () => {
    for (const code of ['a', 'melo_copy', 'a1_2', 'a'.repeat(20)]) {
      expect(validateDuplicate({ ...ok, code }), code).toBeNull()
    }
  })

  // BR-29 · วันสิ้นสุดเป็นจุดเริ่มนับของสถิติและของการลบข้อมูล
  it('ขาดวันใดวันหนึ่ง ไม่ผ่าน', () => {
    expect(validateDuplicate({ ...ok, startAt: '' })).toContain('BR-29')
    expect(validateDuplicate({ ...ok, endAt: '' })).toContain('BR-29')
  })

  it('วันสิ้นสุดก่อนหรือเท่าวันเริ่ม ไม่ผ่าน · ตรงกับ CHECK (end_at > start_at)', () => {
    expect(validateDuplicate({ ...ok, endAt: '2026-08-01' })).toContain('วันสิ้นสุด')
    expect(validateDuplicate({ ...ok, endAt: ok.startAt })).toContain('วันสิ้นสุด')
  })
})

describe('describeCounts', () => {
  it('บอกทุกชนิดที่คนเปิดจอนี้มองหา', () => {
    const line = describeCounts({ activity: 3, card: 7, asset: 5, counter: 1, reward: 2, rich_menu: 1 })
    expect(line).toBe('กิจกรรม 3 · การ์ด 7 · ภาพ 5 · ค่าสะสม 1 · รางวัล 2 · Rich Menu 1')
  })

  it('ตารางที่ไม่มีอะไรเลย แสดงศูนย์ ไม่ใช่หายไปจากประโยค', () => {
    expect(describeCounts({})).toBe('กิจกรรม 0 · การ์ด 0 · ภาพ 0 · ค่าสะสม 0 · รางวัล 0 · Rich Menu 0')
  })
})
