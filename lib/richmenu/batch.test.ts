import { describe, expect, it } from 'vitest'
import { buildLinkOperations, chunkOperations, MAX_BATCH_OPERATIONS } from './batch'

describe('buildLinkOperations · §4.4 ขั้น 5c (BR-97)', () => {
  it('การส่งขึ้นครั้งแรก — ทุกเมนูไม่มี line_rich_menu_id เดิม → ไม่มี operation เลย (ข้ามขั้นนี้)', () => {
    const ops = buildLinkOperations([
      { previousLineRichMenuId: null, newLineRichMenuId: 'new-1' },
      { previousLineRichMenuId: null, newLineRichMenuId: 'new-2' },
    ])
    expect(ops).toEqual([])
  })

  it('ไม่มีเมนูเลย → ไม่มี operation', () => {
    expect(buildLinkOperations([])).toEqual([])
  })

  it('ส่งขึ้นซ้ำ — เมนูที่เคยอัปโหลดมาก่อนได้ operation ย้ายจากรุ่นเก่าไปรุ่นใหม่', () => {
    const ops = buildLinkOperations([
      { previousLineRichMenuId: 'old-1', newLineRichMenuId: 'new-1' },
    ])
    expect(ops).toEqual([{ type: 'link', from: 'old-1', to: 'new-1' }])
  })

  it('ส่งขึ้นซ้ำแบบผสม — เมนูใหม่ที่เพิ่งเพิ่มในรอบนี้ไม่มี operation แต่เมนูเดิมมี', () => {
    const ops = buildLinkOperations([
      { previousLineRichMenuId: 'old-1', newLineRichMenuId: 'new-1' },
      { previousLineRichMenuId: null, newLineRichMenuId: 'new-2' },
    ])
    expect(ops).toEqual([{ type: 'link', from: 'old-1', to: 'new-1' }])
  })

  it('เมนูหลายตัวที่เคยอัปโหลดมาก่อนทั้งหมด ได้ operation ครบทุกตัว', () => {
    const ops = buildLinkOperations([
      { previousLineRichMenuId: 'old-1', newLineRichMenuId: 'new-1' },
      { previousLineRichMenuId: 'old-2', newLineRichMenuId: 'new-2' },
      { previousLineRichMenuId: 'old-3', newLineRichMenuId: 'new-3' },
    ])
    expect(ops).toHaveLength(3)
    expect(ops).toContainEqual({ type: 'link', from: 'old-2', to: 'new-2' })
  })
})

describe('chunkOperations · LINE รับได้ 1000 operation ต่อครั้ง', () => {
  it('น้อยกว่าเพดาน — chunk เดียว', () => {
    const ops = buildLinkOperations([{ previousLineRichMenuId: 'a', newLineRichMenuId: 'b' }])
    expect(chunkOperations(ops)).toEqual([ops])
  })

  it('อาเรย์ว่าง — ไม่มี chunk เลย ไม่ใช่ chunk ว่างหนึ่งอัน', () => {
    expect(chunkOperations([])).toEqual([])
  })

  it('เกินเพดาน — แบ่งเป็นหลาย chunk ตามขนาดที่กำหนด', () => {
    const ops = Array.from({ length: 5 }, (_, i) => ({
      type: 'link' as const, from: `old-${i}`, to: `new-${i}`,
    }))
    const chunks = chunkOperations(ops, 2)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toHaveLength(2)
    expect(chunks[2]).toHaveLength(1)
    expect(chunks.flat()).toEqual(ops)
  })

  it('ค่าเริ่มต้นคือ MAX_BATCH_OPERATIONS (1000)', () => {
    expect(MAX_BATCH_OPERATIONS).toBe(1000)
  })

  it('ขนาด chunk เป็นศูนย์หรือติดลบ ต้องโยน error ไม่ใช่วนไม่รู้จบ', () => {
    expect(() => chunkOperations([{ type: 'link', from: 'a', to: 'b' }], 0)).toThrow()
    expect(() => chunkOperations([{ type: 'link', from: 'a', to: 'b' }], -1)).toThrow()
  })
})
