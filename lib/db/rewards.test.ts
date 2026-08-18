import { describe, expect, it } from 'vitest'
import {
  asRewardType, parseCodeBatch, REWARD_TYPES, REWARD_TYPE_NAME, summarizeReward,
  type RewardRow,
} from './rewards'

const row = (patch: Partial<RewardRow> = {}): RewardRow => ({
  id: 'r1',
  code: 'discount_100',
  reward_type: 'link',
  value: 'https://example.com/c',
  quota: 500,
  issued_count: 120,
  valid_days: 30,
  use_limit: 1,
  has_coupon: false,
  code_total: 0,
  code_issued: 0,
  used_by: [],
  ...patch,
})

describe('ชนิดของรางวัล', () => {
  it('มีครบสี่แบบตามที่ CHECK ของตารางรับ', () => {
    expect([...REWARD_TYPES]).toEqual(['link', 'image', 'code', 'text'])
  })

  it('ทุกแบบมีชื่อภาษาไทยของตัวเอง ไม่ซ้ำกัน', () => {
    const names = REWARD_TYPES.map((type) => REWARD_TYPE_NAME[type])
    expect(new Set(names).size).toBe(4)
    for (const name of names) expect(name.length).toBeGreaterThan(0)
  })

  it('ค่าที่ฟอร์มส่งมาต้องเป็นหนึ่งในสี่แบบ', () => {
    expect(asRewardType('code')).toBe('code')
    for (const junk of ['', 'CODE', 'coupon', 'sticker', undefined]) {
      expect(asRewardType(junk), String(junk)).toBeNull()
    }
  })
})

/**
 * โควตาที่เหลือ · ตัวเลขที่คนเปิดจอนี้มาดู
 */
describe('summarizeReward · โควตาและของที่เหลือ', () => {
  it('บอกทั้งจำนวนที่เหลือและโควตาเต็ม ไม่ใช่บอกแค่ที่แจกไปแล้ว', () => {
    const view = summarizeReward(row())
    expect(view.remaining).toBe(380)
    expect(view.quotaText).toContain('380')
    expect(view.quotaText).toContain('500')
  })

  it('ไม่มีโควตา = ไม่จำกัด ไม่ใช่ศูนย์', () => {
    const view = summarizeReward(row({ quota: null }))
    expect(view.remaining).toBeNull()
    expect(view.quotaText).toBe('ไม่จำกัด')
    expect(view.stockPercent).toBe(100)
  })

  it('แจกครบโควตาแล้ว เหลือศูนย์และเปอร์เซ็นต์เป็นศูนย์', () => {
    const view = summarizeReward(row({ quota: 100, issued_count: 100 }))
    expect(view.remaining).toBe(0)
    expect(view.stockPercent).toBe(0)
  })

  it('โควตาเป็นศูนย์ ไม่ทำให้ได้เปอร์เซ็นต์ที่คำนวณไม่ได้', () => {
    const view = summarizeReward(row({ quota: 0, issued_count: 0 }))
    expect(view.stockPercent).toBe(0)
    expect(view.quotaText).toContain('0')
  })

  it('เหลือน้อยกว่าหนึ่งในสิบ ขึ้นคำเตือนพร้อมเปอร์เซ็นต์', () => {
    const view = summarizeReward(row({ quota: 100, issued_count: 95 }))
    expect(view.isLowStock).toBe(true)
    expect(view.lowStockText).toContain('5%')
  })

  it('เหลือพอดีหนึ่งในสิบ ยังไม่นับว่าใกล้หมด', () => {
    const view = summarizeReward(row({ quota: 100, issued_count: 90 }))
    expect(view.isLowStock).toBe(false)
    expect(view.lowStockText).toBeNull()
  })

  it('รางวัลไม่จำกัด ไม่มีวันขึ้นคำเตือนว่าใกล้หมด', () => {
    expect(summarizeReward(row({ quota: null, issued_count: 99_999 })).isLowStock).toBe(false)
  })
})

/**
 * คลังรหัส · ชนิด code จ่ายรหัสจากคลัง ไม่ใช่จากช่องค่าของรางวัล
 */
describe('summarizeReward · คลังรหัส', () => {
  it('รางวัลที่ไม่ใช่ชนิดรหัส ไม่มีคลังรหัส', () => {
    const view = summarizeReward(row({ reward_type: 'link' }))
    expect(view.codeStock).toBeNull()
    expect(view.codesText).toBeNull()
  })

  it('รางวัลชนิดรหัส บอกทั้งหมด จ่ายแล้ว และเหลือ', () => {
    const view = summarizeReward(row({ reward_type: 'code', code_total: 520, code_issued: 120 }))
    expect(view.codeStock).toEqual({ total: 520, issued: 120, left: 400 })
    expect(view.codesText).toContain('520')
    expect(view.codesText).toContain('400')
  })

  /**
   * รหัสหมดก่อนโควตา · play_and_apply ยังออกสิทธิ์ให้ แต่ในสิทธิ์นั้นไม่มีรหัส
   *
   * The function looks for a free reward_code, and when it finds none it
   * inserts the entitlement anyway with reward_code_id NULL and still counts a
   * unit of quota. Nothing reports that, and the person holding the entitlement
   * has nothing to redeem.
   */
  it('รหัสในคลังเหลือน้อยกว่าโควตาที่ยังแจกได้ ขึ้นคำเตือนว่าสิทธิ์จะออกโดยไม่มีรหัส', () => {
    const view = summarizeReward(row({
      reward_type: 'code', quota: 500, issued_count: 120, code_total: 130, code_issued: 120,
    }))
    expect(view.codeShortfall).toBe(370)
    expect(view.codeShortfallText).toContain('370')
    expect(view.codeShortfallText).toContain('ไม่มีรหัส')
  })

  it('รหัสในคลังพอกับโควตาที่เหลือ ไม่มีคำเตือน', () => {
    const view = summarizeReward(row({
      reward_type: 'code', quota: 500, issued_count: 120, code_total: 500, code_issued: 120,
    }))
    expect(view.codeShortfall).toBe(0)
    expect(view.codeShortfallText).toBeNull()
  })

  it('รางวัลรหัสที่ไม่จำกัดโควตา ยังเตือนได้ว่าคลังรหัสหมดแล้ว', () => {
    const view = summarizeReward(row({
      reward_type: 'code', quota: null, code_total: 5, code_issued: 5,
    }))
    expect(view.codeShortfallText).toContain('ไม่มีรหัส')
  })

  it('รางวัลรหัสที่ยังไม่จำกัดโควตาและยังมีรหัสเหลือ ไม่เตือน', () => {
    const view = summarizeReward(row({
      reward_type: 'code', quota: null, code_total: 5, code_issued: 1,
    }))
    expect(view.codeShortfallText).toBeNull()
  })
})

describe('summarizeReward · ใครแจกรางวัลนี้', () => {
  it('ไม่มีใครชี้มา คือรางวัลที่ไม่มีทางถูกแจก', () => {
    const view = summarizeReward(row({ used_by: [] }))
    expect(view.isOrphan).toBe(true)
  })

  it('มีคนชี้มา ติดมาเป็นรายการของแถวนั้น', () => {
    const view = summarizeReward(row({ used_by: ['สุ่มรางวัล · ผลลัพธ์ "รางวัลใหญ่"'] }))
    expect(view.isOrphan).toBe(false)
    expect(view.usedBy).toEqual(['สุ่มรางวัล · ผลลัพธ์ "รางวัลใหญ่"'])
  })
})

describe('summarizeReward · แก้และลบได้แค่ไหน', () => {
  it('ยังไม่มีใครได้รับและไม่มีใครชี้มา ลบได้', () => {
    const view = summarizeReward(row({ issued_count: 0 }))
    expect(view.canDelete).toBe(true)
    expect(view.deleteBlockedWhy).toBeNull()
  })

  it('มีคนได้รับไปแล้ว ลบไม่ได้ และบอกจำนวนคน', () => {
    const view = summarizeReward(row({ issued_count: 12, used_by: [] }))
    expect(view.canDelete).toBe(false)
    expect(view.deleteBlockedWhy).toContain('12')
  })

  it('มีกิจกรรมหรือจุดปลดล็อกชี้มา ลบไม่ได้ และบอกว่าใคร', () => {
    const view = summarizeReward(row({ issued_count: 0, used_by: ['สุ่มรางวัล'] }))
    expect(view.canDelete).toBe(false)
    expect(view.deleteBlockedWhy).toContain('สุ่มรางวัล')
  })

  /**
   * เปลี่ยนชนิดหลังมีคนได้รับไปแล้ว = เปลี่ยนความหมายของสิทธิ์ที่ออกไปแล้ว
   *
   * entitlement points at the reward, not at a copy of it, so a link that
   * becomes a code turns every entitlement already granted into a promise of
   * something nobody was given.
   */
  it('มีคนได้รับไปแล้ว เปลี่ยนชนิดไม่ได้ และบอกจำนวนคน', () => {
    const view = summarizeReward(row({ issued_count: 8 }))
    expect(view.canChangeType).toBe(false)
    expect(view.typeLockedWhy).toContain('8')
  })

  it('ยังไม่มีใครได้รับ เปลี่ยนชนิดได้', () => {
    const view = summarizeReward(row({ issued_count: 0 }))
    expect(view.canChangeType).toBe(true)
    expect(view.typeLockedWhy).toBeNull()
  })
})

describe('summarizeReward · คูปอง (BR-55)', () => {
  it('รางวัลธรรมดา ไม่บังคับอายุสิทธิ์และจำนวนครั้ง', () => {
    expect(summarizeReward(row({ has_coupon: false })).isCoupon).toBe(false)
  })

  it('รางวัลที่มีแถวคูปอง บังคับทั้งอายุสิทธิ์และจำนวนครั้ง', () => {
    const view = summarizeReward(row({ has_coupon: true, valid_days: 30, use_limit: 1 }))
    expect(view.isCoupon).toBe(true)
    expect(view.couponGapText).toBeNull()
  })

  it('คูปองที่ยังไม่ได้ตั้งอายุสิทธิ์ ขึ้นคำเตือนที่อ้าง BR-55', () => {
    const view = summarizeReward(row({ has_coupon: true, valid_days: null }))
    expect(view.couponGapText).toContain('BR-55')
    expect(view.couponGapText).toContain('อายุสิทธิ์')
  })

  it('คูปองที่ยังไม่ได้ตั้งจำนวนครั้ง ขึ้นคำเตือนเหมือนกัน', () => {
    const view = summarizeReward(row({ has_coupon: true, use_limit: null }))
    expect(view.couponGapText).toContain('BR-55')
  })
})

/**
 * นำเข้ารหัส · ต้นแบบเขียนไว้บนจอว่า "มีแถวผิดจะไม่นำเข้าเลยสักแถว"
 *
 * Duplicates inside one paste are refused rather than quietly deduped. A file
 * containing the same code twice is a file that was exported wrong, and
 * dropping one of them leaves somebody believing they loaded a number of codes
 * they do not own — which is the number they will quote to the client.
 */
describe('parseCodeBatch', () => {
  it('รหัสที่ถูกต้อง ผ่านครบทุกแถว', () => {
    const out = parseCodeBatch('MELO-A1B2\nMELO-C3D4\n', [])
    expect(out).toEqual({ ok: true, codes: ['MELO-A1B2', 'MELO-C3D4'] })
  })

  it('ตัดช่องว่างหัวท้ายและข้ามบรรทัดว่าง', () => {
    const out = parseCodeBatch('  MELO-A1B2  \n\n\nMELO-C3D4\n\n', [])
    expect(out).toEqual({ ok: true, codes: ['MELO-A1B2', 'MELO-C3D4'] })
  })

  it('ไม่มีอะไรให้นำเข้าเลย บอกตรงๆ ไม่ใช่รายงานว่านำเข้าศูนย์รหัสสำเร็จ', () => {
    const out = parseCodeBatch('   \n\n', [])
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('unreachable')
    expect(out.problems[0]).toContain('ยังไม่มีรหัส')
  })

  it('รูปแบบผิด ถูกปฏิเสธพร้อมเลขแถวและตัวที่ผิด', () => {
    const out = parseCodeBatch('MELO-A1B2\nสั้น\nMELO C3D4', [])
    if (out.ok) throw new Error('unreachable')
    expect(out.problems[0]).toContain('แถว 2')
    expect(out.problems[0]).toContain('สั้น')
    expect(out.problems[1]).toContain('แถว 3')
  })

  it('สั้นกว่าสี่ตัวหรือยาวเกินยี่สิบสี่ตัว ไม่ผ่าน', () => {
    expect(parseCodeBatch('ABC', []).ok).toBe(false)
    expect(parseCodeBatch('A'.repeat(25), []).ok).toBe(false)
    expect(parseCodeBatch('ABCD', []).ok).toBe(true)
    expect(parseCodeBatch('A'.repeat(24), []).ok).toBe(true)
  })

  it('ซ้ำกันเองในไฟล์เดียว ถูกปฏิเสธ ไม่ใช่ถูกตัดออกเงียบๆ', () => {
    const out = parseCodeBatch('MELO-A1B2\nMELO-C3D4\nMELO-A1B2', [])
    if (out.ok) throw new Error('unreachable')
    expect(out.problems[0]).toContain('แถว 3')
    expect(out.problems[0]).toContain('แถว 1')
  })

  it('ซ้ำกับรหัสที่มีอยู่แล้วในคลัง ถูกปฏิเสธพร้อมบอกว่ามีอยู่แล้ว', () => {
    const out = parseCodeBatch('MELO-A1B2', ['MELO-A1B2'])
    if (out.ok) throw new Error('unreachable')
    expect(out.problems[0]).toContain('มีอยู่ในคลังแล้ว')
  })

  it('แถวเดียวผิดในชุดที่เหลือถูกหมด ยังไม่นำเข้าเลยสักแถว', () => {
    const out = parseCodeBatch('MELO-A1B2\nx\nMELO-C3D4', [])
    expect(out.ok).toBe(false)
  })

  it('รหัสมากเกินกว่าจะเป็นการวางครั้งเดียว ถูกปฏิเสธก่อนอ่านทีละแถว', () => {
    const many = Array.from({ length: 5001 }, (_, i) => `CODE-${i.toString().padStart(6, '0')}`)
    const out = parseCodeBatch(many.join('\n'), [])
    if (out.ok) throw new Error('unreachable')
    expect(out.problems[0]).toContain('5000')
  })

  it('ห้าพันรหัสพอดี ยังผ่าน', () => {
    const many = Array.from({ length: 5000 }, (_, i) => `CODE-${i.toString().padStart(6, '0')}`)
    expect(parseCodeBatch(many.join('\n'), []).ok).toBe(true)
  })

  it('ตัวพิมพ์ใหญ่เล็กต่างกัน ถือว่าคนละรหัส เพราะ UNIQUE ของตารางก็ถือแบบนั้น', () => {
    const out = parseCodeBatch('melo-a1b2\nMELO-A1B2', [])
    expect(out.ok).toBe(true)
  })

  it('รายงานปัญหาไม่เกินสามข้อแรก แล้วบอกว่ายังมีอีกกี่แถว', () => {
    const out = parseCodeBatch(['a', 'b', 'c', 'd', 'e'].join('\n'), [])
    if (out.ok) throw new Error('unreachable')
    expect(out.problems).toHaveLength(4)
    expect(out.problems[3]).toContain('อีก 2')
  })
})
