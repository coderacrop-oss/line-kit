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
 * เหมือน components/richmenu/CropModal.test.tsx ทุกประการ (ครอบตัวเดียวกัน)
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

  it('ยังไม่รู้ขนาดต้นฉบับ — ปุ่มยืนยันถูกปิดใช้งานไว้ก่อน (ยังไม่มีกรอบเลือกให้ครอป)', () => {
    render(<ImagemapCropModal open file={file} onConfirm={() => {}} onSkip={() => {}} onCancel={() => {}} />)
    expect((screen.getByRole('button', { name: 'ยืนยันการครอบตัด' }) as HTMLButtonElement).disabled).toBe(true)
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
})

describe('ImagemapCropModal · คำเตือนภาพแคบ', () => {
  it('ภาพกว้าง (≥1040px) กรอบเริ่มต้นเต็มภาพ — ไม่มีคำเตือน', () => {
    const { container } = render(
      <ImagemapCropModal open file={file} onConfirm={() => {}} onSkip={() => {}} onCancel={() => {}} />,
    )
    loadImage(container, 2000, 1000)
    expect(screen.queryByText(/แคบกว่า/)).toBeNull()
  })

  it('ภาพแคบกว่า 1040px ตั้งแต่ต้น — กรอบเริ่มต้นเต็มภาพก็ยังโดนเตือนทันที', () => {
    const { container } = render(
      <ImagemapCropModal open file={file} onConfirm={() => {}} onSkip={() => {}} onCancel={() => {}} />,
    )
    loadImage(container, 500, 400)
    expect(screen.getByText(/แคบกว่า/)).toBeDefined()
  })

  it('ภาพกว้างพอ แต่ลากมุมกรอบให้แคบลงจนต่ำกว่า 1040px (สัดส่วนธรรมชาติ) — คำเตือนโผล่ขึ้นสด ไม่ต้องรอปล่อยนิ้ว', () => {
    const { container } = render(
      <ImagemapCropModal open file={file} onConfirm={() => {}} onSkip={() => {}} onCancel={() => {}} />,
    )
    // ภาพกว้าง 2000px จริง แสดงที่ DISPLAY_WIDTH=480 — สเกล 2000/480 ≈ 4.1667 ต่อพิกเซลจอ
    // กรอบเริ่มต้นเต็ม 480px จอ = 2000px จริง (ไม่เตือน) ลากมุมซ้ายบน (nw) เข้ามา 300px จอ
    // เหลือกรอบกว้าง ~180px จอ ≈ 750px จริง — ต่ำกว่า 1040 แน่นอน
    loadImage(container, 2000, 1000)
    expect(screen.queryByText(/แคบกว่า/)).toBeNull()

    const handle = container.querySelector('[data-resize-handle="nw"]')!
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0 })
    fireEvent.pointerMove(handle, { clientX: 300, clientY: 0 })

    expect(screen.getByText(/แคบกว่า/)).toBeDefined()
  })
})
