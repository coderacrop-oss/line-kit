import { describe, expect, it } from 'vitest'
import {
  ASSET_FILTERS, type AssetRow, asAssetFilter, describeMeta, filterAssets, summarizeAsset,
} from './assets'

const row: AssetRow = {
  id: 'a1',
  storage_path: 'uploads/c1/u1/promo-day1.png',
  public_url: '/uploads/c1/u1/promo-day1.png',
  media_type: 'image',
  mime_type: 'image/png',
  bytes: 188 * 1024,
  width: 1024,
  height: 678,
  duration_sec: null,
  replaces_asset_id: null,
  created_at: new Date('2026-08-14T03:00:00Z'),
  uploaded_by_email: 'meena@example.com',
  replaces_path: null,
  replaced_by_path: null,
  used_by: [],
}

const view = (patch: Partial<AssetRow> = {}) => summarizeAsset({ ...row, ...patch })

describe('describeMeta', () => {
  it('ขนาดไฟล์แล้วขนาดภาพ ตามต้นแบบ', () => {
    expect(describeMeta(188 * 1024, 1024, 678)).toBe('188 KB · 1024×678')
  })

  it('กว้างมาก่อนสูง', () => {
    expect(describeMeta(1024, 2500, 1686)).toContain('2500×1686')
  })
})

describe('summarizeAsset · ชื่อไฟล์และตัวเลข', () => {
  it('ชื่อไฟล์มาจากท่อนสุดท้ายของที่อยู่ ไม่ใช่ทั้งเส้น', () => {
    expect(view().fileName).toBe('promo-day1.png')
  })

  it('URL ที่จอเอาไปแสดง เป็นค่าที่เก็บไว้ ไม่ได้ประกอบขึ้นใหม่', () => {
    expect(view().publicUrl).toBe('/uploads/c1/u1/promo-day1.png')
  })

  it('ขนาดไฟล์และขนาดภาพผ่านมาครบ', () => {
    expect(view()).toMatchObject({ bytes: 188 * 1024, width: 1024, height: 678 })
    expect(view().meta).toBe('188 KB · 1024×678')
  })

  it('วิดีโอพาความยาวมาด้วย', () => {
    expect(view({ media_type: 'video', mime_type: 'video/mp4', duration_sec: 45 }))
      .toMatchObject({ mediaType: 'video', durationSec: 45 })
  })
})

describe('summarizeAsset · ใครใช้อยู่บ้าง', () => {
  it('ไม่มีใครชี้มา = ไม่มีใครใช้', () => {
    expect(view().isOrphan).toBe(true)
    expect(view().usedBy).toEqual([])
  })

  it('มีคนชี้มาแม้รายเดียว ก็ไม่ใช่ภาพที่ไม่มีใครใช้', () => {
    expect(view({ used_by: ['การ์ด: win_a'] }).isOrphan).toBe(false)
  })

  it('used_by ที่เป็น null (แถวเก่าก่อนมีคอลัมน์) ไม่ทำให้พัง', () => {
    expect(view({ used_by: null as unknown as string[] }).usedBy).toEqual([])
  })
})

describe('summarizeAsset · BR-25 อัปโหลดทับ', () => {
  it('ภาพใหม่บอกว่ามาแทนใคร และบอกว่าไฟล์เดิมยังอยู่', () => {
    const text = view({ replaces_path: 'uploads/c1/u0/promo-old.png' }).replacesText
    expect(text).toContain('promo-old.png')
    expect(text).toContain('ไฟล์เดิมยังอยู่ ไม่ถูกลบ (BR-25)')
  })

  it('ภาพที่ไม่ได้มาแทนใคร ไม่มีประโยคนั้น', () => {
    expect(view().replacesText).toBeNull()
  })

  it('ภาพเก่าบอกว่ามีใครมาแทนแล้ว · คนอ่านต้องรู้ว่าทำไมมันยังอยู่', () => {
    const text = view({ replaced_by_path: 'uploads/c1/u2/promo-new.png' }).replacedByText
    expect(text).toContain('promo-new.png')
  })

  it('ภาพเก่าที่ถูกแทนแล้ว ลบไม่ได้ แม้จะไม่มีการ์ดใบไหนชี้มา', () => {
    // นี่คือกับดักของต้นแบบ · ภาพที่ถูกแทนแล้วดู "ไม่มีใครใช้" ทุกประการ
    // แต่การ์ดที่ส่งเข้าแชทไปแล้วยังชี้มาที่ไฟล์นี้ และแก้ข้อความนั้นไม่ได้อีกแล้ว
    const asset = view({ replaced_by_path: 'uploads/c1/u2/promo-new.png' })
    expect(asset.isOrphan).toBe(true)
    expect(asset.canDelete).toBe(false)
    expect(asset.deleteBlockedWhy).toContain('BR-25')
    expect(asset.deleteBlockedWhy).toContain('promo-new.png')
  })

  it('ภาพที่ไม่มีใครใช้และไม่มีใครมาแทน ลบได้', () => {
    expect(view().canDelete).toBe(true)
    expect(view().deleteBlockedWhy).toBeNull()
  })

  it('ภาพที่มีคนใช้อยู่ ลบไม่ได้ และบอกว่าใครใช้', () => {
    const asset = view({ used_by: ['การ์ด: win_a', 'Rich Menu: main'] })
    expect(asset.canDelete).toBe(false)
    expect(asset.deleteBlockedWhy).toContain('การ์ด: win_a')
    expect(asset.deleteBlockedWhy).toContain('Rich Menu: main')
  })

  it('ทั้งมีคนใช้และถูกแทนแล้ว บอกเหตุผลที่คนแก้ได้ก่อน', () => {
    const asset = view({ used_by: ['การ์ด: win_a'], replaced_by_path: 'uploads/c1/u2/x.png' })
    expect(asset.deleteBlockedWhy).toContain('การ์ด: win_a')
  })
})

describe('filterAssets', () => {
  const assets = [
    view({ id: 'a1', storage_path: 'uploads/c1/u1/PROMO-day1.png' }),
    view({ id: 'a2', storage_path: 'uploads/c1/u2/reward-card.png', used_by: ['การ์ด: win_a'] }),
    view({ id: 'a3', storage_path: 'uploads/c1/u3/ภาพรางวัล.png' }),
  ]
  const ids = (list: ReturnType<typeof filterAssets>) => list.map((a) => a.id)

  it('ไม่ใส่อะไรเลย ได้ทั้งหมด', () => {
    expect(ids(filterAssets(assets))).toEqual(['a1', 'a2', 'a3'])
  })

  it('กรองเฉพาะที่ใช้อยู่', () => {
    expect(ids(filterAssets(assets, { filter: 'ที่ใช้อยู่' }))).toEqual(['a2'])
  })

  it('กรองเฉพาะที่ไม่มีใครใช้', () => {
    expect(ids(filterAssets(assets, { filter: 'ที่ไม่มีใครใช้' }))).toEqual(['a1', 'a3'])
  })

  it('ค้นจากชื่อไฟล์ โดยไม่แยกตัวพิมพ์', () => {
    expect(ids(filterAssets(assets, { query: 'promo' }))).toEqual(['a1'])
    expect(ids(filterAssets(assets, { query: 'PROMO' }))).toEqual(['a1'])
  })

  it('ค้นด้วยคำไทยได้', () => {
    expect(ids(filterAssets(assets, { query: 'รางวัล' }))).toEqual(['a3'])
  })

  it('ค้นเจอตรงกลางชื่อ ไม่ใช่แค่ตอนขึ้นต้น', () => {
    expect(ids(filterAssets(assets, { query: 'day1' }))).toEqual(['a1'])
  })

  it('ช่องว่างล้วนไม่นับเป็นคำค้น', () => {
    expect(ids(filterAssets(assets, { query: '   ' }))).toEqual(['a1', 'a2', 'a3'])
  })

  it('ค้นกับกรองทำงานพร้อมกัน ไม่ใช่อย่างใดอย่างหนึ่ง', () => {
    expect(ids(filterAssets(assets, { query: 'card', filter: 'ที่ไม่มีใครใช้' }))).toEqual([])
    expect(ids(filterAssets(assets, { query: 'card', filter: 'ที่ใช้อยู่' }))).toEqual(['a2'])
  })

  it('ไม่เจออะไรเลย คืนรายการว่าง ไม่ใช่ทั้งหมด', () => {
    expect(ids(filterAssets(assets, { query: 'ไม่มีไฟล์ชื่อนี้' }))).toEqual([])
  })

  it('ไม่แก้รายการเดิม', () => {
    filterAssets(assets, { filter: 'ที่ใช้อยู่' })
    expect(assets.length).toBe(3)
  })
})

describe('asAssetFilter', () => {
  it('สามตัวกรองตามต้นแบบ', () => {
    expect(ASSET_FILTERS).toEqual(['ทั้งหมด', 'ที่ใช้อยู่', 'ที่ไม่มีใครใช้'])
  })

  it('ค่าที่รู้จักผ่านมาเหมือนเดิม', () => {
    for (const filter of ASSET_FILTERS) expect(asAssetFilter(filter)).toBe(filter)
  })

  it('ค่าที่ไม่รู้จักหรือไม่มี กลายเป็นทั้งหมด · ค่านี้มาจาก URL ที่ใครก็พิมพ์ได้', () => {
    for (const raw of [undefined, '', 'ทั้งหมดจริงๆ', '<script>', 'ที่ใช้อยู่ ']) {
      expect(asAssetFilter(raw), String(raw)).toBe('ทั้งหมด')
    }
  })
})
