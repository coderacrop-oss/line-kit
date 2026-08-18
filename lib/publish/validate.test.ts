import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { activityProblems } from '../db/activities'
import { CAMPAIGN_ROOT, checkPublish, validateForPublish, whereHref } from './validate'

/**
 * config ที่ครบทุกอย่าง · เทสต์ทุกตัวเริ่มจากตัวนี้แล้วทำให้เสียทีละอย่าง
 *
 * ถอดมาจากแผนบรรทัด 1995–2048 ตรงตัว รวมทั้งการไม่ประกาศชนิดกำกับไว้ ซึ่งเป็น
 * เหตุผลที่ `resolveMethod` ในชนิดของ config เป็น `string` ไม่ใช่ union — ค่าใน
 * ก้อนนี้ถูก TypeScript อ่านเป็น string ตั้งแต่แรก และ union จะทำให้เทสต์ที่แผน
 * เขียนไว้เองคอมไพล์ไม่ผ่าน
 */
const ok = {
  cards: [{ id: 'c1', code: 'win', hasSampleText: false, blocks: 2 }],
  activities: [{ id: 'a1', code: 'draw', resolveMethod: 'weighted', fallbackCardId: null,
                 entryRules: [], outcomes: [{ cardId: 'c1' }] }],
  keywordRules: [{ id: 'k1', targetActivityId: 'a1', targetCardId: null }],
  channelType: 'test' as const,
  confirmed: false,
}

// ────────────────────────────────────────────────────────────────────────────
// เจ็ดข้อของแผน · คัดลอกมาทั้งบล็อก ห้ามแก้ให้เข้ากับโค้ด
// ────────────────────────────────────────────────────────────────────────────

describe('validateForPublish', () => {
  it('config ที่ครบ ไม่มีปัญหา', () => {
    expect(validateForPublish(ok)).toEqual([])
  })
  it('การ์ดที่ยังมีข้อความตัวอย่างจากเทมเพลต บล็อกการส่งขึ้น (BR-37)', () => {
    const bad = { ...ok, cards: [{ ...ok.cards[0], hasSampleText: true }] }
    expect(validateForPublish(bad)[0].code).toBe('ERR-034')
  })
  it('resolve เป็น quota แต่ไม่มีการ์ดสำรอง บล็อก (BR-31)', () => {
    const bad = { ...ok, activities: [{ ...ok.activities[0], resolveMethod: 'quota' as const }] }
    expect(validateForPublish(bad).some((p) => p.message.includes('สำรอง'))).toBe(true)
  })
  it('ผลลัพธ์ที่ชี้ไปการ์ดที่ไม่มีอยู่ บล็อก', () => {
    const bad = { ...ok, activities: [{ ...ok.activities[0], outcomes: [{ cardId: 'ไม่มี' }] }] }
    expect(validateForPublish(bad).length).toBeGreaterThan(0)
  })
  it('คีย์เวิร์ดที่ไม่ชี้ไปไหน บล็อก', () => {
    const bad = { ...ok, keywordRules: [{ id: 'k1', targetActivityId: null, targetCardId: null }] }
    expect(validateForPublish(bad).length).toBeGreaterThan(0)
  })
  it('production ที่ยังไม่ยืนยันซ้ำ บล็อก (BR-18)', () => {
    const bad = { ...ok, channelType: 'production' as const }
    expect(validateForPublish(bad).some((p) => p.code === 'ERR-001')).toBe(true)
  })
  it('ทุกปัญหาบอกว่าอยู่ที่ไหน ไม่ใช่แค่บอกว่าผิด', () => {
    const bad = { ...ok, cards: [{ ...ok.cards[0], hasSampleText: true }] }
    expect(validateForPublish(bad)[0].where).toBeTruthy()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// ต่อจากเจ็ดข้อ · แต่ละด่านของ §4.4 ขั้น 1 มีเทสต์ของตัวเอง
// ────────────────────────────────────────────────────────────────────────────

describe('BR-18 · บัญชีจริงของลูกค้าต้องยืนยันซ้ำ', () => {
  it('ยืนยันแล้ว ผ่าน', () => {
    expect(validateForPublish({ ...ok, channelType: 'production', confirmed: true })).toEqual([])
  })

  it('บัญชีทดสอบไม่ต้องยืนยัน — ด่านนี้ถามเฉพาะบัญชีที่ผู้เล่นจริงมองเห็น', () => {
    expect(validateForPublish({ ...ok, channelType: 'test', confirmed: false })).toEqual([])
  })

  it('ยืนยันมาแล้วก็ไม่ช่วยถ้ายังมีปัญหาอื่นค้าง', () => {
    const bad = {
      ...ok, channelType: 'production' as const, confirmed: true,
      cards: [{ ...ok.cards[0], hasSampleText: true }],
    }
    expect(validateForPublish(bad).map((p) => p.code)).toContain('ERR-034')
  })

  it('ปัญหาของ BR-18 พาไปที่ช่องยืนยันบนจอนี้ ไม่ใช่บอกลอยๆ ว่าต้องยืนยัน', () => {
    const bad = { ...ok, channelType: 'production' as const }
    const problem = bad && validateForPublish(bad).find((p) => p.code === 'ERR-001')!
    expect(problem.where).toBe('publish#confirm')
    expect(problem.message).toContain('ยืนยัน')
  })
})

describe('BR-37 · ข้อความตัวอย่างจากเทมเพลต', () => {
  it('บอกเป็นรายใบ ไม่ใช่บอกรวมว่ามีการ์ดผิดอยู่บ้าง', () => {
    const bad = {
      ...ok,
      cards: [
        { id: 'c1', code: 'win', hasSampleText: true, blocks: 2 },
        { id: 'c2', code: 'lose', hasSampleText: true, blocks: 2 },
      ],
      activities: [{ ...ok.activities[0], outcomes: [{ cardId: 'c1' }, { cardId: 'c2' }] }],
    }
    const sample = validateForPublish(bad).filter((p) => p.code === 'ERR-034')
    expect(sample).toHaveLength(2)
    expect(sample.map((p) => p.message).join(' ')).toContain('win')
    expect(sample.map((p) => p.message).join(' ')).toContain('lose')
  })

  it('การ์ดที่ไม่ได้ตั้งค่านี้ไว้เลย ไม่ถือว่ามีข้อความตัวอย่าง', () => {
    const bad = { ...ok, cards: [{ id: 'c1', code: 'win', blocks: 2 }] }
    expect(validateForPublish(bad)).toEqual([])
  })
})

describe('การ์ด', () => {
  it('การ์ดที่ไม่มีบล็อกสักอัน บล็อก — ส่งออกไปเป็นข้อความเปล่า', () => {
    const bad = { ...ok, cards: [{ id: 'c1', code: 'win', hasSampleText: false, blocks: 0 }] }
    expect(validateForPublish(bad).some((p) => p.message.includes('win'))).toBe(true)
  })

  it('แคมเปญที่ยังไม่มีการ์ดสักใบ บล็อก', () => {
    const bad = { ...ok, cards: [], activities: [{ ...ok.activities[0], outcomes: [] }] }
    expect(validateForPublish(bad).length).toBeGreaterThan(0)
  })
})

describe('กิจกรรม', () => {
  it('ผลลัพธ์ที่ยังไม่ได้เลือกการ์ด บล็อก — ผู้เล่นกดแล้วเงียบ', () => {
    const bad = { ...ok, activities: [{ ...ok.activities[0], outcomes: [{ cardId: null }] }] }
    expect(validateForPublish(bad).length).toBeGreaterThan(0)
  })

  it('กิจกรรมที่ไม่มีผลลัพธ์สักอัน บล็อก', () => {
    const bad = { ...ok, activities: [{ ...ok.activities[0], outcomes: [] }] }
    expect(validateForPublish(bad).length).toBeGreaterThan(0)
  })

  it('เงื่อนไขการเข้าเล่นที่ไม่มีการ์ดตอบ บล็อก (BR-26)', () => {
    const bad = {
      ...ok,
      activities: [{ ...ok.activities[0], entryRules: [{ type: 'limit', cardId: null }] }],
    }
    expect(validateForPublish(bad).some((p) => p.message.includes('BR-26'))).toBe(true)
  })

  it('เงื่อนไขที่ชี้ไปการ์ดที่ไม่มีอยู่ บล็อก', () => {
    const bad = {
      ...ok,
      activities: [{ ...ok.activities[0], entryRules: [{ type: 'limit', cardId: 'ผี' }] }],
    }
    expect(validateForPublish(bad).some((p) => p.code === 'ERR-020')).toBe(true)
  })

  it('การ์ดสำรองที่ชี้ไปการ์ดที่ไม่มีอยู่ บล็อก', () => {
    const bad = { ...ok, activities: [{ ...ok.activities[0], fallbackCardId: 'ผี' }] }
    expect(validateForPublish(bad).some((p) => p.code === 'ERR-020')).toBe(true)
  })

  it('กิจกรรมที่ปิดอยู่ไม่ถูกตรวจ — ตอนส่งขึ้นมันไม่ถูกโหลด', () => {
    const bad = {
      ...ok,
      activities: [
        ok.activities[0],
        { id: 'a2', code: 'off', resolveMethod: 'quota', fallbackCardId: null,
          entryRules: [], outcomes: [], isEnabled: false },
      ],
    }
    expect(validateForPublish(bad)).toEqual([])
  })

  it('แคมเปญที่ไม่มีกิจกรรมที่เปิดอยู่เลย บล็อก', () => {
    const bad = {
      ...ok,
      activities: [{ ...ok.activities[0], isEnabled: false }],
      keywordRules: [{ id: 'k1', targetActivityId: null, targetCardId: 'c1' }],
    }
    expect(validateForPublish(bad).length).toBeGreaterThan(0)
  })

  it('ทุกปัญหาของกิจกรรมพาไปที่จอของกิจกรรมนั้น ไม่ใช่ที่รายการรวม', () => {
    const bad = { ...ok, activities: [{ ...ok.activities[0], resolveMethod: 'quota' }] }
    expect(validateForPublish(bad)[0].where).toBe('activities/a1')
  })
})

describe('คีย์เวิร์ด', () => {
  it('คีย์เวิร์ดที่ชี้ไปกิจกรรมที่ไม่มีอยู่ บล็อก', () => {
    const bad = {
      ...ok,
      keywordRules: [{ id: 'k1', targetActivityId: 'ผี', targetCardId: null }],
    }
    expect(validateForPublish(bad).some((p) => p.code === 'ERR-020')).toBe(true)
  })

  it('คีย์เวิร์ดที่ชี้ไปการ์ดที่ไม่มีอยู่ บล็อก', () => {
    const bad = {
      ...ok,
      keywordRules: [{ id: 'k1', targetActivityId: null, targetCardId: 'ผี' }],
    }
    expect(validateForPublish(bad).some((p) => p.code === 'ERR-020')).toBe(true)
  })

  it('ชี้ไปการ์ดที่มีจริงก็พอ ไม่ต้องชี้ไปกิจกรรม', () => {
    const fine = {
      ...ok,
      keywordRules: [{ id: 'k1', targetActivityId: null, targetCardId: 'c1' }],
    }
    expect(validateForPublish(fine)).toEqual([])
  })

  it('ไม่มีทางเข้าเลย บล็อก — แคมเปญที่ไม่มีใครเริ่มเล่นได้', () => {
    const bad = { ...ok, keywordRules: [] }
    expect(validateForPublish(bad).some((p) => p.message.includes('ทางเข้า'))).toBe(true)
  })

  it('กิจกรรมทักทายเป็นทางเข้าในตัวเอง ไม่ต้องมีคีย์เวิร์ด (BR-90)', () => {
    const fine = {
      ...ok,
      keywordRules: [],
      activities: [{ ...ok.activities[0], trigger: 'follow' as const }],
    }
    expect(validateForPublish(fine)).toEqual([])
  })
})

describe('รางวัลชนิดรหัสจากคลัง', () => {
  it('คลังรหัสหมดแล้วยังมีโควตาเหลือ บล็อก', () => {
    const bad = {
      ...ok,
      rewards: [{ id: 'r1', code: 'voucher', rewardType: 'code', codeShortfall: 20 }],
    }
    expect(validateForPublish(bad).some((p) => p.message.includes('voucher'))).toBe(true)
  })

  it('รหัสพอกับโควตา ผ่าน', () => {
    const fine = {
      ...ok,
      rewards: [{ id: 'r1', code: 'voucher', rewardType: 'code', codeShortfall: 0 }],
    }
    expect(validateForPublish(fine)).toEqual([])
  })

  it('รางวัลชนิดอื่นไม่ต้องมีคลังรหัส', () => {
    const fine = {
      ...ok,
      rewards: [{ id: 'r1', code: 'sticker', rewardType: 'link', codeShortfall: 99 }],
    }
    expect(validateForPublish(fine)).toEqual([])
  })
})

describe('BR-39 · ผู้เล่นพิมพ์อะไรลอยๆ ต้องมีการ์ดตอบ', () => {
  const withText = {
    ...ok,
    activities: [{ ...ok.activities[0], inputType: 'text' }],
  }

  it('มีกิจกรรมที่รับข้อความ แต่บัญชีไม่มีการ์ดตั้งต้น บล็อก', () => {
    expect(validateForPublish({ ...withText, defaultCardId: null })
      .some((p) => p.message.includes('BR-39'))).toBe(true)
  })

  it('ตั้งการ์ดตั้งต้นไว้แล้ว ผ่าน', () => {
    expect(validateForPublish({ ...withText, defaultCardId: 'c1' })).toEqual([])
  })

  it('ไม่มีกิจกรรมที่รับข้อความ ก็ไม่บังคับ', () => {
    expect(validateForPublish({ ...ok, defaultCardId: null })).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// คำเตือน · เห็นบนจอ แต่ไม่บล็อก
// ────────────────────────────────────────────────────────────────────────────

describe('คำเตือนที่ไม่บล็อก', () => {
  it('กิจกรรมที่ไม่มีทางเข้าถึงเป็นคำเตือน ไม่ใช่ตัวบล็อก', () => {
    const config = {
      ...ok,
      activities: [
        ok.activities[0],
        { id: 'a2', code: 'lonely', resolveMethod: 'weighted', fallbackCardId: null,
          entryRules: [], outcomes: [{ cardId: 'c1' }] },
      ],
    }
    expect(validateForPublish(config)).toEqual([])
    expect(checkPublish(config).some((c) => c.tone === 'warn' && c.label.includes('lonely')))
      .toBe(true)
  })

  it('กิจกรรมที่มีคีย์เวิร์ดชี้มาไม่ถูกเตือน', () => {
    expect(checkPublish(ok).every((c) => c.tone !== 'warn')).toBe(true)
  })

  it('ค่าสะสมที่ไม่มีกิจกรรมไหนเขียนค่าเข้ามาเป็นคำเตือน', () => {
    const config = { ...ok, counters: [{ code: 'stamp', name: 'แสตมป์' }] }
    expect(validateForPublish(config)).toEqual([])
    expect(checkPublish(config).some((c) => c.tone === 'warn' && c.label.includes('แสตมป์')))
      .toBe(true)
  })

  it('ค่าสะสมที่มีกิจกรรมเขียนค่าให้ ไม่ถูกเตือน', () => {
    const config = {
      ...ok,
      counters: [{ code: 'stamp', name: 'แสตมป์' }],
      activities: [{ ...ok.activities[0], counterCodes: ['stamp'] }],
    }
    expect(checkPublish(config).every((c) => c.tone !== 'warn')).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// รายการตรวจที่จอวาด · ผ่านก็ต้องเห็น ไม่ใช่เห็นเฉพาะตอนพัง
// ────────────────────────────────────────────────────────────────────────────

describe('checkPublish · รายการที่จอวาด', () => {
  it('ผ่านหมดก็ยังมีรายการให้เห็นว่าตรวจอะไรไปบ้าง', () => {
    const checks = checkPublish(ok)
    expect(checks.length).toBeGreaterThan(3)
    expect(checks.every((c) => c.tone === 'ok')).toBe(true)
  })

  it('ทุกปัญหาที่ validate คืน มีแถวของตัวเองในรายการที่จอวาด', () => {
    const bad = {
      ...ok,
      cards: [{ id: 'c1', code: 'win', hasSampleText: true, blocks: 0 }],
      activities: [{ ...ok.activities[0], resolveMethod: 'quota' }],
      channelType: 'production' as const,
    }
    const blocked = checkPublish(bad).filter((c) => c.tone === 'blocked')
    expect(blocked.map((c) => c.code).sort())
      .toEqual(validateForPublish(bad).map((p) => p.code).sort())
  })

  it('validateForPublish คือรายการที่บล็อก ไม่ใช่รายการทั้งหมด', () => {
    const config = {
      ...ok,
      activities: [
        ok.activities[0],
        { id: 'a2', code: 'lonely', resolveMethod: 'weighted', fallbackCardId: null,
          entryRules: [], outcomes: [{ cardId: 'c1' }] },
      ],
    }
    expect(checkPublish(config).length).toBeGreaterThan(validateForPublish(config).length)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// "ไปแก้ →" ต้องพาไปที่จอที่แก้ได้จริง ไม่ใช่พาไป 404
// ────────────────────────────────────────────────────────────────────────────

/**
 * ทุกปลายทางที่ `where` ชี้ไป ต้องมีไฟล์จออยู่จริง
 *
 * ลิสต์ที่บอกว่าผิดตรงไหนแล้วกดไปเจอ 404 แย่กว่าลิสต์ที่ไม่มีลิงก์ เพราะมันสัญญา
 * ว่ามีที่ให้ไปแก้ · เทสต์นี้เดินไฟล์จริงใต้ app/ ไม่ได้เทียบกับรายชื่อที่พิมพ์ไว้
 * ซึ่งจะกลายเป็นสำเนาที่ล้าสมัยเงียบๆ วันที่มีคนย้ายโฟลเดอร์
 */
const pageExists = (where: string): boolean => {
  const path = where.split('#')[0]
  const absolute = path.startsWith('/')
  let dir = absolute ? 'app/(admin)' : CAMPAIGN_ROOT
  for (const segment of path.replace(/^\//, '').split('/').filter(Boolean)) {
    const literal = join(dir, segment)
    if (existsSync(literal) && statSync(literal).isDirectory()) { dir = literal; continue }
    const dynamic = readdirSync(dir, { withFileTypes: true })
      .find((entry) => entry.isDirectory() && entry.name.startsWith('['))
    if (!dynamic) return false
    dir = join(dir, dynamic.name)
  }
  return existsSync(join(dir, 'page.tsx'))
}

/** config ที่ผิดทุกด่านพร้อมกัน · ใช้เก็บ `where` ให้ครบทุกแบบที่ระบบสร้างได้ */
const everythingWrong = {
  cards: [{ id: 'c1', code: 'win', hasSampleText: true, blocks: 0 }],
  activities: [
    { id: 'a1', code: 'draw', resolveMethod: 'quota', fallbackCardId: 'ผี',
      inputType: 'text',
      entryRules: [{ type: 'limit', cardId: null }], outcomes: [{ cardId: 'ผี' }] },
  ],
  keywordRules: [{ id: 'k1', targetActivityId: null, targetCardId: null }],
  counters: [{ code: 'stamp', name: 'แสตมป์' }],
  rewards: [{ id: 'r1', code: 'voucher', rewardType: 'code', codeShortfall: 5 }],
  channelType: 'production' as const,
  confirmed: false,
  defaultCardId: null,
}

describe('ทุกปัญหากดกระโดดไปแก้ได้', () => {
  it('เทสต์นี้ได้ตรวจของจริง — config ตัวอย่างทำให้เกิดปัญหาหลายแบบ', () => {
    expect(validateForPublish(everythingWrong).length).toBeGreaterThan(5)
  })

  it('ทุกปัญหามี where และไม่มีอันไหนว่าง', () => {
    for (const problem of validateForPublish(everythingWrong)) {
      expect(problem.where, problem.message).toBeTruthy()
      expect(problem.where.trim(), problem.message).not.toBe('')
    }
  })

  it('ทุก where ชี้ไปจอที่มีไฟล์อยู่จริง ไม่ใช่ 404', () => {
    const dead = validateForPublish(everythingWrong)
      .map((p) => p.where)
      .filter((where) => !pageExists(where))
    expect([...new Set(dead)]).toEqual([])
  })

  it('คำเตือนที่กดไปแก้ได้ ก็ต้องชี้ไปจอที่มีอยู่จริงเหมือนกัน', () => {
    const dead = checkPublish(everythingWrong)
      .map((c) => c.where)
      .filter((where): where is string => Boolean(where))
      .filter((where) => !pageExists(where))
    expect([...new Set(dead)]).toEqual([])
  })

  it('เทสต์เส้นทางจับของปลอมได้จริง', () => {
    expect(pageExists('ไม่มีจอนี้')).toBe(false)
    expect(pageExists('keywords')).toBe(true)
    expect(pageExists('activities/a1')).toBe(true)
    expect(pageExists('/channels')).toBe(true)
  })

  it('ทุกปัญหามี code และไม่มีอันไหนว่าง', () => {
    for (const problem of validateForPublish(everythingWrong)) {
      expect(problem.code, problem.message).toMatch(/^ERR-\d{3}$/)
    }
  })

  it('ทุกปัญหามีข้อความที่อ่านแล้วรู้ว่าต้องทำอะไร ไม่ใช่รหัสเปล่า', () => {
    for (const problem of validateForPublish(everythingWrong)) {
      expect(problem.message.length, problem.code).toBeGreaterThan(15)
    }
  })
})

describe('whereHref', () => {
  it('ทางเดินในแคมเปญถูกต่อเข้ากับรหัสแคมเปญ', () => {
    expect(whereHref('camp-1', 'keywords')).toBe('/campaigns/camp-1/keywords')
    expect(whereHref('camp-1', 'activities/a1')).toBe('/campaigns/camp-1/activities/a1')
  })

  it('จุดยึดบนจอเดิมยังอยู่ครบหลังต่อ', () => {
    expect(whereHref('camp-1', 'publish#confirm')).toBe('/campaigns/camp-1/publish#confirm')
  })

  it('ทางเดินที่ขึ้นต้นด้วย / คือจอนอกแคมเปญ ห้ามเอารหัสแคมเปญไปแปะ', () => {
    expect(whereHref('camp-1', '/channels')).toBe('/channels')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// สองที่ที่พูดกฎเดียวกัน ต้องพูดตรงกัน
// ────────────────────────────────────────────────────────────────────────────

/**
 * จอกิจกรรม (M7-S02) มีตัวตรวจของตัวเองอยู่แล้วที่ `activityProblems()`
 *
 * กฎซ้ำกันสองที่คือกฎที่จะเถียงกันเองวันหลัง · ถ้าวันไหนที่หนึ่งผ่อนกฎ อีกที่จะยัง
 * บล็อกอยู่ แล้วคนตั้งค่าจะเจอจอที่บอกว่าเรียบร้อยกับจอที่ไม่ยอมให้ส่งขึ้นพร้อมกัน
 * โดยไม่มีอะไรอธิบาย · เทสต์นี้ผูกสองฝั่งไว้ที่กฎที่ทั้งคู่พูดถึง
 */
describe('ตรงกับตัวตรวจของจอกิจกรรม', () => {
  const asRow = (patch: Record<string, unknown>) => ({
    id: 'a1', code: 'draw', name: 'สุ่ม', input_type: 'none' as const,
    resolve_method: 'weighted' as const, input_config: {},
    resolve_config: { outcomes: [{ id: 'o1', cardId: 'c1' }] },
    entry_rules: [], effects: [], fallback_card_id: null,
    trigger: 'manual' as const, is_enabled: true, sort_order: 0,
    reached_by: ['คีย์เวิร์ด'], links: [],
    ...patch,
  })

  it('quota ที่ไม่มีการ์ดสำรอง ถูกบล็อกทั้งสองที่ (BR-31)', () => {
    const row = asRow({ resolve_method: 'quota' })
    const config = { ...ok, activities: [{ ...ok.activities[0], resolveMethod: 'quota' }] }

    expect(activityProblems(row).some((p) => p.includes('BR-31'))).toBe(true)
    expect(validateForPublish(config).some((p) => p.message.includes('BR-31'))).toBe(true)
  })

  it('เงื่อนไขที่ไม่มีการ์ดตอบ ถูกบล็อกทั้งสองที่ (BR-26)', () => {
    const row = asRow({ entry_rules: [{ type: 'limit' }] })
    const config = {
      ...ok,
      activities: [{ ...ok.activities[0], entryRules: [{ type: 'limit', cardId: null }] }],
    }

    expect(activityProblems(row).some((p) => p.includes('BR-26'))).toBe(true)
    expect(validateForPublish(config).some((p) => p.message.includes('BR-26'))).toBe(true)
  })

  it('กิจกรรมที่ไม่มีผลลัพธ์ ถูกบล็อกทั้งสองที่', () => {
    const row = asRow({ resolve_config: { outcomes: [] } })
    const config = { ...ok, activities: [{ ...ok.activities[0], outcomes: [] }] }

    expect(activityProblems(row).length).toBeGreaterThan(0)
    expect(validateForPublish(config).length).toBeGreaterThan(0)
  })
})
