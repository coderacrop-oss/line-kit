// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi,
} from 'vitest'
import { ImagemapCropModal } from './ImagemapCropModal'

afterEach(cleanup)

/**
 * jsdom ไม่มี canvas backend จริง (getContext คืน null) และไม่ decode รูปจริง
 * (naturalWidth/Height เป็น 0 เสมอ ไม่ยิง onLoad เอง) — ปลอมทั้งสองอย่างในไฟล์นี้
 * เหมือน components/richmenu/CropModal.test.tsx ทุกประการ (ครอบตัวเดียวกัน — ไฟล์นี้
 * ก็อปโมเดล pan/zoom มาจากที่นั่นตรงๆ ดู header comment ของ ImagemapCropModal.tsx)
 */
const drawImage = vi.fn()
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext
let originalToBlob: typeof HTMLCanvasElement.prototype.toBlob
let originalCreateObjectURL: typeof URL.createObjectURL
let originalRevokeObjectURL: typeof URL.revokeObjectURL

beforeAll(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext
  originalToBlob = HTMLCanvasElement.prototype.toBlob
  originalCreateObjectURL = URL.createObjectURL
  originalRevokeObjectURL = URL.revokeObjectURL

  // @ts-expect-error — ปลอมแค่เท่าที่ ImagemapCropModal ใช้จริง (drawImage) ไม่ใช่ CanvasRenderingContext2D เต็มรูป
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage }))
  HTMLCanvasElement.prototype.toBlob = function toBlobStub(callback: BlobCallback) {
    callback(new Blob(['x'], { type: 'image/jpeg' }))
  }
  URL.createObjectURL = vi.fn(() => 'blob:fake')
  URL.revokeObjectURL = vi.fn()
})

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext
  HTMLCanvasElement.prototype.toBlob = originalToBlob
  URL.createObjectURL = originalCreateObjectURL
  URL.revokeObjectURL = originalRevokeObjectURL
})

beforeEach(() => { drawImage.mockClear() })

const file = new File(['abc'], 'photo.jpg', { type: 'image/jpeg' })

/** จำลองว่าภาพต้นฉบับโหลดเสร็จแล้ว ขนาดที่กำหนด */
function loadImage(container: HTMLElement, width: number, height: number) {
  const img = container.querySelector('img') as HTMLImageElement
  Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true })
  fireEvent.load(img)
}

function zoomIn(times = 1) {
  const btn = screen.getByRole('button', { name: '+ ซูมเข้า' })
  for (let i = 0; i < times; i++) fireEvent.click(btn)
}

function zoomOut(times = 1) {
  const btn = screen.getByRole('button', { name: '− ซูมออก' })
  for (let i = 0; i < times; i++) fireEvent.click(btn)
}

describe('ImagemapCropModal · โครงเริ่มต้น', () => {
  it('open=false ไม่วาดอะไร', () => {
    const { container } = render(
      <ImagemapCropModal open={false} file={file} onConfirm={() => {}} onSkip={() => {}} onCancel={() => {}} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('open=true แสดงกรอบครอบและปุ่มควบคุม', () => {
    render(<ImagemapCropModal open file={file} onConfirm={() => {}} onSkip={() => {}} onCancel={() => {}} />)
    expect(screen.getByText('ครอบ/จัดกรอบภาพฐาน')).toBeDefined()
    expect(screen.getByRole('button', { name: 'ใช้ภาพนี้ทั้งภาพ' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'ยืนยันการครอบตัด' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'ยกเลิก' })).toBeDefined()
  })

  it('ยังไม่รู้ขนาดต้นฉบับ — ปุ่มยืนยัน/ซูมถูกปิดใช้งานไว้ก่อน', () => {
    render(<ImagemapCropModal open file={file} onConfirm={() => {}} onSkip={() => {}} onCancel={() => {}} />)
    expect((screen.getByRole('button', { name: 'ยืนยันการครอบตัด' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('slider', { name: 'ซูม' }) as HTMLInputElement).disabled).toBe(true)
  })

  // เคยพังจริง: object URL เก็บไว้ใน ref ไม่ใช่ state — .current ถูกตั้งค่าหลัง render
  // แรกไปแล้ว แต่แก้ ref ไม่ทำให้ React re-render จึง <img src> ไม่เคยได้ค่าจริงเลย
  // ภาพไม่โหลด ปุ่มยืนยันปิดค้างตลอด (ผู้ใช้จริงเจอกล่องเทาว่างๆ ไม่มีภาพให้ครอบเลย)
  // เทสต์อื่นในไฟล์นี้ไม่จับเคสนี้เพราะ loadImage() ยิง fireEvent.load ตรงๆ โดยไม่เช็ค
  // ว่า src ถูกตั้งค่าจริงก่อนหรือเปล่า — เทสต์นี้เช็ค src ตรงๆ แทน
  it('object URL ที่สร้างจาก URL.createObjectURL ต้องไปโผล่ที่ src ของ <img> จริง ไม่ใช่ค้างที่ undefined', () => {
    const { container } = render(
      <ImagemapCropModal open file={file} onConfirm={() => {}} onSkip={() => {}} onCancel={() => {}} />,
    )
    const img = container.querySelector('img') as HTMLImageElement
    expect(img.src).toContain('blob:fake')
  })
})

describe('ImagemapCropModal · ทางลัด/ยกเลิก', () => {
  it('กด "ใช้ภาพนี้ทั้งภาพ" — เรียก onSkip ไม่ใช่ onConfirm (ไม่มีการวาด canvas เลย)', () => {
    const onSkip = vi.fn()
    const onConfirm = vi.fn()
    const { container } = render(
      <ImagemapCropModal open file={file} onConfirm={onConfirm} onSkip={onSkip} onCancel={() => {}} />,
    )
    loadImage(container, 2000, 1000)

    fireEvent.click(screen.getByRole('button', { name: 'ใช้ภาพนี้ทั้งภาพ' }))
    expect(onSkip).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(drawImage).not.toHaveBeenCalled()
  })

  it('กด "ยกเลิก" — เรียก onCancel', () => {
    const onCancel = vi.fn()
    const { container } = render(
      <ImagemapCropModal open file={file} onConfirm={() => {}} onSkip={() => {}} onCancel={onCancel} />,
    )
    loadImage(container, 2000, 1000)
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})

describe('ImagemapCropModal · ยืนยันการครอบตัด', () => {
  it('ยืนยันหลังภาพโหลดเสร็จ — วาดลง canvas แล้วส่ง File กลับผ่าน onConfirm', async () => {
    const onConfirm = vi.fn()
    const { container } = render(
      <ImagemapCropModal open file={file} onConfirm={onConfirm} onSkip={() => {}} onCancel={() => {}} />,
    )
    loadImage(container, 2000, 1000)

    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันการครอบตัด' }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
    const result = onConfirm.mock.calls[0][0] as File
    expect(result).toBeInstanceOf(File)
    expect(result.type).toBe('image/jpeg')
    expect(drawImage).toHaveBeenCalledOnce()
  })

  it('ที่ซูมเริ่มต้น (MIN_ZOOM) ไม่ลากอะไรเลย — ผลลัพธ์คือภาพเต็มทั้งใบ ไม่มีการครอบตัด (dx/dy เป็นศูนย์ ขนาดวาดเท่าภาพต้นฉบับเป๊ะ)', async () => {
    const onConfirm = vi.fn()
    const { container } = render(
      <ImagemapCropModal open file={file} onConfirm={onConfirm} onSkip={() => {}} onCancel={() => {}} />,
    )
    loadImage(container, 2000, 1000)

    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันการครอบตัด' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())

    // ลายเซ็นของ ctx.drawImage(image, dx, dy, drawWidth, drawHeight)
    const [, dx, dy, drawWidth, drawHeight] = drawImage.mock.calls[0]
    expect(dx).toBe(0)
    expect(dy).toBe(0)
    expect(drawWidth).toBe(2000)
    expect(drawHeight).toBe(1000)
  })
})

describe('ImagemapCropModal · ซูมและคำเตือนภาพแคบ', () => {
  it('ภาพกว้าง (≥1040px) — ซูมเริ่มต้นเต็มภาพพอดี ไม่มีคำเตือน', () => {
    const { container } = render(
      <ImagemapCropModal open file={file} onConfirm={() => {}} onSkip={() => {}} onCancel={() => {}} />,
    )
    loadImage(container, 2000, 1000)
    expect(screen.queryByText(/แคบกว่า/)).toBeNull()
  })

  it('ภาพแคบกว่า 1040px ตั้งแต่ต้น — ที่ซูม 100% (MIN_ZOOM) ก็ยังโดนเตือนทันที ไม่ต้องรอซูมเข้า', () => {
    const { container } = render(
      <ImagemapCropModal open file={file} onConfirm={() => {}} onSkip={() => {}} onCancel={() => {}} />,
    )
    loadImage(container, 500, 400)
    expect(screen.getByText(/แคบกว่า/)).toBeDefined()
  })

  it('ภาพกว้างพอ แต่ซูมเข้าจนความละเอียดจริงที่จับได้ต่ำกว่า 1040px — คำเตือนโผล่ขึ้นสด แล้วซูมออกคำเตือนหายไป', () => {
    const { container } = render(
      <ImagemapCropModal open file={file} onConfirm={() => {}} onSkip={() => {}} onCancel={() => {}} />,
    )
    // ภาพกว้าง 2000px จริง — ที่ MIN_ZOOM=1 ไม่เตือน (2000 >= 1040)
    loadImage(container, 2000, 1000)
    expect(screen.queryByText(/แคบกว่า/)).toBeNull()

    // ซูมเข้าทีละ 0.25 (ปุ่ม + ซูมเข้า) จนถึง zoom=2 → ความละเอียดจริงที่จับได้ =
    // 2000/2 = 1000px < 1040 ต้องเตือน
    zoomIn(4)
    expect(screen.getByText(/แคบกว่า/)).toBeDefined()

    // ซูมออกกลับหนึ่งขั้น → zoom=1.75 → 2000/1.75 ≈ 1143px >= 1040 คำเตือนต้องหายไป
    zoomOut(1)
    expect(screen.queryByText(/แคบกว่า/)).toBeNull()
  })
})

describe('ImagemapCropModal · ลากเพื่อเลื่อน (pan)', () => {
  it('ที่ซูมเริ่มต้น (เต็มกรอบพอดี) ลากเท่าไหร่ก็ขยับไม่ได้ — ไม่มีที่ให้เลื่อน (maxPan=0)', async () => {
    const onConfirm = vi.fn()
    const { container } = render(
      <ImagemapCropModal open file={file} onConfirm={onConfirm} onSkip={() => {}} onCancel={() => {}} />,
    )
    loadImage(container, 2000, 1000)

    const frame = container.querySelector('[data-pan-frame]')!
    fireEvent.pointerDown(frame, { clientX: 0, clientY: 0 })
    fireEvent.pointerMove(frame, { clientX: 300, clientY: 200 })
    fireEvent.pointerUp(frame)

    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันการครอบตัด' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
    const [, dx, dy] = drawImage.mock.calls[0]
    expect(dx).toBe(0)
    expect(dy).toBe(0)
  })

  it('ซูมเข้าก่อนแล้วลากไกลเกินขอบมากๆ — ตำแหน่งที่บันทึกจริงถูกหนีบไว้ ไม่มีวันเห็นช่องว่างหลุดขอบภาพ', async () => {
    const onConfirm = vi.fn()
    const { container } = render(
      <ImagemapCropModal open file={file} onConfirm={onConfirm} onSkip={() => {}} onCancel={() => {}} />,
    )
    loadImage(container, 2000, 1000)
    zoomIn(4) // zoom = 2 — ตอนนี้มีพื้นที่ให้เลื่อนแล้ว

    const frame = container.querySelector('[data-pan-frame]')!
    fireEvent.pointerDown(frame, { clientX: 0, clientY: 0 })
    // ระยะไกลเกินขอบกรอบแน่นอน ไม่ว่าจะซูมเท่าไหร่ (กรอบกว้างแค่ DISPLAY_WIDTH=480)
    fireEvent.pointerMove(frame, { clientX: 9999, clientY: 9999 })
    fireEvent.pointerUp(frame)

    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันการครอบตัด' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())

    // ctx.drawImage(image, dx, dy, drawWidth, drawHeight) — ผลลัพธ์ต้องยังคลุมผืน
    // เป้าหมาย (natural: 2000×1000) เต็มเสมอ ไม่มีทางเห็นช่องว่างที่ขอบ
    const [, dx, dy, drawWidth, drawHeight] = drawImage.mock.calls[0]
    expect(dx).toBeLessThanOrEqual(0)
    expect(dx + drawWidth).toBeGreaterThanOrEqual(2000)
    expect(dy).toBeLessThanOrEqual(0)
    expect(dy + drawHeight).toBeGreaterThanOrEqual(1000)
  })
})
