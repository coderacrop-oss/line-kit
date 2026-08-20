import { describe, expect, it } from 'vitest'
import {
  asAreaKind, buildAreas, countEmpty, lineAliasIdFor, type RichMenuArea, setAreaTarget, toLineArea,
} from './areas'
import { layoutRects } from './layouts'

describe('buildAreas · สลับผังแล้วคงปลายทางเดิมไว้ตามตำแหน่ง', () => {
  it('ผังใหม่ไม่มีของเดิมเลย ทุกช่องเริ่มที่ none', () => {
    const areas = buildAreas('large_2h')
    expect(areas).toHaveLength(2)
    expect(areas.every((a) => a.kind === 'none' && a.target === null)).toBe(true)
  })

  it('พิกัดตรงกับ layoutRects เป๊ะ', () => {
    const areas = buildAreas('large_6')
    expect(areas.map(({ x, y, width, height }) => ({ x, y, width, height })))
      .toEqual(layoutRects('large_6'))
  })

  it('สลับจากผังเล็กไปใหญ่ — ตำแหน่งเดิมยังอยู่ ตำแหน่งใหม่เป็น none', () => {
    const two = setAreaTarget(buildAreas('large_2h'), 0, 'url', 'https://a.example')
    const six = buildAreas('large_6', two)
    expect(six[0]).toMatchObject({ kind: 'url', target: 'https://a.example' })
    expect(six[1].kind).toBe('none')
    expect(six[5].kind).toBe('none')
  })

  it('สลับจากผังใหญ่ไปเล็ก — ตำแหน่งที่หายไปถูกตัดทิ้งไปเงียบๆ ไม่มีข้อมูลตกค้าง', () => {
    let six = buildAreas('large_6')
    six = setAreaTarget(six, 5, 'url', 'https://last.example')
    const one = buildAreas('large_1', six)
    expect(one).toHaveLength(1)
    expect(one[0].kind).toBe('none')
  })
})

describe('countEmpty · BR-01 · ป้าย "N ช่องไม่ชี้ไปไหน"', () => {
  it('ทุกช่องว่างตอนสร้างใหม่', () => {
    expect(countEmpty(buildAreas('large_3top1'))).toBe(3)
  })

  it('นับเฉพาะ none ไม่นับชนิดอื่น', () => {
    let areas = buildAreas('large_3top1')
    areas = setAreaTarget(areas, 0, 'url', 'https://x.example')
    expect(countEmpty(areas)).toBe(2)
  })

  it('ครบทุกช่องแล้วนับเป็นศูนย์', () => {
    let areas = buildAreas('large_2h')
    areas = setAreaTarget(areas, 0, 'url', 'https://a.example')
    areas = setAreaTarget(areas, 1, 'url', 'https://b.example')
    expect(countEmpty(areas)).toBe(0)
  })
})

describe('setAreaTarget', () => {
  it('เปลี่ยนชนิดแล้วเก็บ target ใหม่', () => {
    const areas = setAreaTarget(buildAreas('large_1'), 0, 'menu', 'menu-id-1')
    expect(areas[0]).toMatchObject({ kind: 'menu', target: 'menu-id-1' })
  })

  it('เปลี่ยนกลับเป็น none แล้ว target ต้องถูกล้างเป็น null เสมอ — กันปลายทางเก่าตกค้าง', () => {
    let areas = setAreaTarget(buildAreas('large_1'), 0, 'url', 'https://x.example')
    areas = setAreaTarget(areas, 0, 'none', 'https://x.example')
    expect(areas[0]).toMatchObject({ kind: 'none', target: null })
  })

  it('ไม่แก้ช่องอื่น', () => {
    const before = buildAreas('large_2h')
    const after = setAreaTarget(before, 0, 'url', 'https://x.example')
    expect(after[1]).toEqual(before[1])
  })
})

describe('asAreaKind', () => {
  it('รับเฉพาะห้าค่าที่รู้จัก อย่างอื่นกลับเป็น none', () => {
    expect(asAreaKind('activity')).toBe('activity')
    expect(asAreaKind('card')).toBe('card')
    expect(asAreaKind('menu')).toBe('menu')
    expect(asAreaKind('url')).toBe('url')
    expect(asAreaKind('none')).toBe('none')
    expect(asAreaKind('datetimepicker')).toBe('none')
    expect(asAreaKind(undefined)).toBe('none')
  })
})

describe('lineAliasIdFor · richMenuAliasId ที่ปลอดภัยเสมอ ไม่ว่าคนจะตั้งชื่อเรียกเมนูเป็นอะไร', () => {
  const UUID = 'a1b2c3d4-e5f6-4789-a012-3456789abcde'

  it('ตัดขีดกลางของ UUID ออก เหลือตัวอักษร/ตัวเลขล้วน', () => {
    expect(lineAliasIdFor(UUID)).toBe('a1b2c3d4e5f64789a0123456789abcde')
  })

  it('ผลลัพธ์ไม่เกิน 32 ตัวอักษร และมีแต่ a-z 0-9 (ตรงข้อจำกัดจริงของ LINE)', () => {
    const result = lineAliasIdFor(UUID)
    expect(result.length).toBeLessThanOrEqual(32)
    expect(result).toMatch(/^[a-z0-9]+$/)
  })

  it('เมนู id เดิม ได้ผลลัพธ์เดิมเสมอ (คงที่ข้ามการ publish ซ้ำ — BR-77)', () => {
    expect(lineAliasIdFor(UUID)).toBe(lineAliasIdFor(UUID))
  })

  it('เมนูคนละใบ (id ต่างกัน) ได้ผลลัพธ์ต่างกัน — ไม่ชนกัน', () => {
    expect(lineAliasIdFor('11111111-1111-1111-1111-111111111111'))
      .not.toBe(lineAliasIdFor('22222222-2222-2222-2222-222222222222'))
  })
})

describe('toLineArea · แปลงช่องเป็น action ที่ส่งให้ LINE จริง', () => {
  const ctx = {
    aliasByMenuId: { 'menu-2': 'tab-two' },
    activityCodeById: { 'act-1': 'draw' },
    campaignCode: 'summer',
  }

  it('kind none โยน error เสมอ — ต้องผ่าน validateForPublish ก่อนเรียกฟังก์ชันนี้', () => {
    const area: RichMenuArea = { x: 0, y: 0, width: 10, height: 10, kind: 'none', target: null }
    expect(() => toLineArea(area, ctx)).toThrow()
  })

  it('kind activity สร้าง postback แบบเมนู (rm=1) พร้อมรหัสแคมเปญและกิจกรรม — คนละรูปแบบกับปุ่มบนการ์ด', () => {
    const area: RichMenuArea = { x: 0, y: 0, width: 10, height: 10, kind: 'activity', target: 'act-1' }
    const line = toLineArea(area, ctx)
    expect(line.action).toEqual({ type: 'postback', data: 'rm=1&c=summer&a=draw' })
    expect(line.bounds).toEqual({ x: 0, y: 0, width: 10, height: 10 })
  })

  it('kind card สร้าง postback แบบเมนู (rm=1) พร้อมรหัสแคมเปญและ id การ์ด', () => {
    const area: RichMenuArea = { x: 0, y: 0, width: 10, height: 10, kind: 'card', target: 'card-1' }
    const line = toLineArea(area, ctx)
    expect(line.action).toEqual({ type: 'postback', data: 'rm=1&c=summer&card=card-1' })
    expect(line.bounds).toEqual({ x: 0, y: 0, width: 10, height: 10 })
  })

  it('kind menu ใช้ alias ของเมนูปลายทาง ไม่ใช่ id ดิบ', () => {
    const area: RichMenuArea = { x: 0, y: 0, width: 10, height: 10, kind: 'menu', target: 'menu-2' }
    const line = toLineArea(area, ctx)
    expect(line.action).toMatchObject({ type: 'richmenuswitch', richMenuAliasId: 'tab-two' })
  })

  it('kind menu ที่หา alias ไม่เจอ โยน error ชัดเจน ไม่ส่งของเพี้ยนขึ้น LINE', () => {
    const area: RichMenuArea = { x: 0, y: 0, width: 10, height: 10, kind: 'menu', target: 'missing' }
    expect(() => toLineArea(area, ctx)).toThrow(/missing/)
  })

  it('kind url ส่ง uri ตรงๆ', () => {
    const area: RichMenuArea = { x: 0, y: 0, width: 10, height: 10, kind: 'url', target: 'https://x.example' }
    expect(toLineArea(area, ctx).action).toEqual({ type: 'uri', uri: 'https://x.example' })
  })
})
