import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveImagemapVariantAsset = vi.fn()
const storeGet = vi.fn()

beforeEach(() => {
  resolveImagemapVariantAsset.mockReset()
  storeGet.mockReset()
})

vi.mock('@/lib/db/client', () => ({ db: () => ({}) }))
vi.mock('@/lib/db/card-imagemap', () => ({
  resolveImagemapVariantAsset: (...args: unknown[]) => resolveImagemapVariantAsset(...args),
}))
vi.mock('@/lib/assets/store', () => ({
  assetStore: () => ({ get: (...args: unknown[]) => storeGet(...args) }),
}))

const { GET } = await import('./route')

function paramsFor(cardId: string, width: string) {
  return { params: Promise.resolve({ cardId, width }) }
}

describe('GET /api/imagemap/[cardId]/[width]', () => {
  it.each(['239', '241', '0', '-1', '1041', '1.5', 'abc', '1040px', ''])(
    'ปฏิเสธความกว้างที่ไม่ใช่หนึ่งในห้าค่าที่ LINE ขอ ด้วย 404: %s',
    async (width) => {
      const res = await GET(new Request('http://x'), paramsFor('card-1', width))
      expect(res.status).toBe(404)
      expect(resolveImagemapVariantAsset).not.toHaveBeenCalled()
    },
  )

  it.each(['240', '300', '460', '700', '1040'])('รับทั้งห้าความกว้างที่ LINE ขอจริง: %s', async (width) => {
    resolveImagemapVariantAsset.mockResolvedValueOnce({ storagePath: `uploads/x/${width}.jpg`, mimeType: 'image/jpeg' })
    storeGet.mockResolvedValueOnce(new Uint8Array([1, 2, 3]))
    const res = await GET(new Request('http://x'), paramsFor('card-1', width))
    expect(res.status).toBe(200)
  })

  it('การ์ดที่ยังไม่เคยกด "ใช้" หรือไม่มีอยู่จริง — 404 ไม่ใช่ 500', async () => {
    resolveImagemapVariantAsset.mockResolvedValueOnce(null)
    const res = await GET(new Request('http://x'), paramsFor('missing-card', '1040'))
    expect(res.status).toBe(404)
    expect(storeGet).not.toHaveBeenCalled()
  })

  it('ส่งไบต์จริง พร้อม Content-Type ตาม mime ของ asset', async () => {
    resolveImagemapVariantAsset.mockResolvedValueOnce({ storagePath: 'uploads/x/1040.jpg', mimeType: 'image/jpeg' })
    const bytes = new Uint8Array([9, 9, 9, 9])
    storeGet.mockResolvedValueOnce(bytes)

    const res = await GET(new Request('http://x'), paramsFor('card-1', '1040'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')
    expect(res.headers.get('Content-Length')).toBe('4')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes)
  })

  it('ตั้ง Cache-Control แบบมีอายุ ไม่ใช่ immutable — เนื้อหาเปลี่ยนได้เมื่อกด "ใช้" ใหม่แม้ URL เดิม', async () => {
    resolveImagemapVariantAsset.mockResolvedValueOnce({ storagePath: 'uploads/x/1040.jpg', mimeType: 'image/jpeg' })
    storeGet.mockResolvedValueOnce(new Uint8Array([1]))
    const res = await GET(new Request('http://x'), paramsFor('card-1', '1040'))
    expect(res.headers.get('Cache-Control')).not.toContain('immutable')
    expect(res.headers.get('Cache-Control')).toContain('max-age')
  })

  it('ETag ต่างกันเมื่อ storage_path ต่างกัน (ไฟล์คนละเวอร์ชัน)', async () => {
    resolveImagemapVariantAsset.mockResolvedValueOnce({ storagePath: 'uploads/x/v1.jpg', mimeType: 'image/jpeg' })
    storeGet.mockResolvedValueOnce(new Uint8Array([1]))
    const res1 = await GET(new Request('http://x'), paramsFor('card-1', '1040'))

    resolveImagemapVariantAsset.mockResolvedValueOnce({ storagePath: 'uploads/x/v2.jpg', mimeType: 'image/jpeg' })
    storeGet.mockResolvedValueOnce(new Uint8Array([1]))
    const res2 = await GET(new Request('http://x'), paramsFor('card-1', '1040'))

    expect(res1.headers.get('ETag')).not.toBe(res2.headers.get('ETag'))
  })

  it('mime ที่ไม่รู้จัก ตกไปเป็น application/octet-stream แทนที่จะโกหกว่าเป็นภาพ', async () => {
    resolveImagemapVariantAsset.mockResolvedValueOnce({ storagePath: 'uploads/x/weird', mimeType: 'application/weird' })
    storeGet.mockResolvedValueOnce(new Uint8Array([1]))
    const res = await GET(new Request('http://x'), paramsFor('card-1', '1040'))
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream')
  })

  it('exports preferredRegion = sin1 — เหตุผลเดียวกับ webhook route (ใกล้ Supabase + ผู้เล่นเอเชีย)', async () => {
    const mod = await import('./route')
    expect(mod.preferredRegion).toBe('sin1')
  })
})
