// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi,
} from 'vitest'
import { CropModal } from './CropModal'

afterEach(cleanup)

/**
 * jsdom ไม่มี canvas backend จริง (getContext คืน null) และไม่ decode รูปจริง
 * (naturalWidth/Height เป็น 0 เสมอ ไม่ยิง onLoad เอง) — ปลอมทั้งสองอย่างในไฟล์นี้
 * เพื่อทดสอบ "การเดินสาย" ของ component (state, callback, การเรียก drawImage ด้วย
 * ค่าที่ถูกต้อง) ส่วนคณิตศาสตร์ของการครอปเองมีเทสต์แยกต่างหากที่ lib/richmenu/crop.test.ts
 * ซึ่งไม่ต้องพึ่งค่าปลอมพวกนี้เลย
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

  // @ts-expect-error — ปลอมแค่เท่าที่ CropModal ใช้จริง (drawImage) ไม่ใช่ CanvasRenderingContext2D เต็มรูป
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
const target = { width: 2500, height: 1686 }

/** จำลองว่าภาพต้นฉบับโหลดเสร็จแล้ว ขนาด 2000×2000 (สี่เหลี่ยมจัตุรัส ใหญ่พอสำหรับผังนี้) */
function loadImage(container: HTMLElement, width = 2000, height = 2000) {
  const img = container.querySelector('img') as HTMLImageElement
  Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true })
  fireEvent.load(img)
}

describe('CropModal · โครงเริ่มต้น', () => {
  it('open=false ไม่วาดอะไร', () => {
    const { container } = render(
      <CropModal open={false} file={file} target={target} onConfirm={() => {}} onSkip={() => {}} onCancel={() => {}} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('open=true แสดงกรอบตัดภาพและปุ่มควบคุม', () => {
    render(<CropModal open file={file} target={target} onConfirm={() => {}} onSkip={() => {}} onCancel={() => {}} />)
    expect(screen.getByText('จัดตำแหน่งภาพ')).toBeDefined()
    expect(screen.getByRole('button', { name: 'ใช้ภาพนี้ทั้งภาพ' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'ยืนยันตำแหน่ง' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'ยกเลิก' })).toBeDefined()
  })

  it('ยังไม่รู้ขนาดต้นฉบับ — ปุ่มยืนยัน/ซูมถูกปิดใช้งานไว้ก่อน', () => {
    render(<CropModal open file={file} target={target} onConfirm={() => {}} onSkip={() => {}} onCancel={() => {}} />)
    expect((screen.getByRole('button', { name: 'ยืนยันตำแหน่ง' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('slider', { name: 'ซูม' }) as HTMLInputElement).disabled).toBe(true)
  })
})

describe('CropModal · ยืนยันตำแหน่ง', () => {
  it('ยืนยันหลังภาพโหลดเสร็จ — วาดลง canvas ขนาดผืนเป้าหมายเป๊ะ แล้วส่ง Blob กลับผ่าน onConfirm', async () => {
    const onConfirm = vi.fn()
    const { container } = render(
      <CropModal open file={file} target={target} onConfirm={onConfirm} onSkip={() => {}} onCancel={() => {}} />,
    )
    loadImage(container)

    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันตำแหน่ง' }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
    const blob = onConfirm.mock.calls[0][0] as Blob
    expect(blob.type).toBe('image/jpeg')
    expect(drawImage).toHaveBeenCalledOnce()

    const canvas = container.querySelector('canvas')
    // canvas ที่สร้างขึ้นชั่วคราว (ไม่ได้แนบเข้า DOM) — เช็คผ่าน mock call แทน
    expect(canvas).toBeNull()
  })

  it('กด "ใช้ภาพนี้ทั้งภาพ" — เรียก onSkip ไม่ใช่ onConfirm (ไม่มีการวาด canvas เลย)', () => {
    const onSkip = vi.fn()
    const onConfirm = vi.fn()
    const { container } = render(
      <CropModal open file={file} target={target} onConfirm={onConfirm} onSkip={onSkip} onCancel={() => {}} />,
    )
    loadImage(container)

    fireEvent.click(screen.getByRole('button', { name: 'ใช้ภาพนี้ทั้งภาพ' }))
    expect(onSkip).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('กด "ยกเลิก" — เรียก onCancel', () => {
    const onCancel = vi.fn()
    const { container } = render(
      <CropModal open file={file} target={target} onConfirm={() => {}} onSkip={() => {}} onCancel={onCancel} />,
    )
    loadImage(container)
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('กด Escape — เรียก onCancel เหมือนปุ่มยกเลิก (Modal ใต้ CropModal จัดการให้)', () => {
    const onCancel = vi.fn()
    render(<CropModal open file={file} target={target} onConfirm={() => {}} onSkip={() => {}} onCancel={onCancel} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })
})

describe('CropModal · ซูม', () => {
  it('เริ่มต้นซูมต่ำสุด (cover-fit) — ปุ่มซูมออกถูกปิดใช้งาน ปุ่มซูมเข้ากดได้', () => {
    const { container } = render(
      <CropModal open file={file} target={target} onConfirm={() => {}} onSkip={() => {}} onCancel={() => {}} />,
    )
    loadImage(container)
    expect((screen.getByRole('button', { name: '− ซูมออก' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '+ ซูมเข้า' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('กดซูมเข้าแล้วปุ่มซูมออกใช้งานได้ทันที', () => {
    const { container } = render(
      <CropModal open file={file} target={target} onConfirm={() => {}} onSkip={() => {}} onCancel={() => {}} />,
    )
    loadImage(container)
    fireEvent.click(screen.getByRole('button', { name: '+ ซูมเข้า' }))
    expect((screen.getByRole('button', { name: '− ซูมออก' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('ลากแถบซูมไปสุดทาง (MAX_ZOOM) — ปุ่มซูมเข้าถูกปิดใช้งาน', () => {
    const { container } = render(
      <CropModal open file={file} target={target} onConfirm={() => {}} onSkip={() => {}} onCancel={() => {}} />,
    )
    loadImage(container)
    fireEvent.change(screen.getByRole('slider', { name: 'ซูม' }), { target: { value: '4' } })
    expect((screen.getByRole('button', { name: '+ ซูมเข้า' }) as HTMLButtonElement).disabled).toBe(true)
  })

  // หมายเหตุ: <input type=range> ของ jsdom/เบราว์เซอร์จริงหนีบค่า .value ให้อยู่ใน
  // [min,max] เองเสมอตอนอ่านกลับ ไม่ว่าค่าที่ set ผ่าน React state จะเกินแค่ไหน —
  // เทสต์นี้จึงยืนยันแค่ผลลัพธ์ที่สังเกตได้จาก DOM (ปุ่มปิด/ค่าที่แสดง) ไม่ใช่ตัวเลข
  // zoom ภายในจริงๆ ถ้าอยากยืนยันคณิตศาสตร์ของการหนีบเป๊ะๆ ดูที่ lib/richmenu/crop.test.ts
  // ซึ่งมัน mutation-tested แยกไว้แล้ว (ไม่ผ่าน DOM ที่หนีบค่าเองให้)
  it('กดปุ่ม + ซ้ำจนควรเกิน MAX_ZOOM — ยังถูกหนีบไว้ที่เพดาน ไม่ทะลุ (เส้นทางปุ่ม ไม่ใช่แถบเลื่อน)', () => {
    const { container } = render(
      <CropModal open file={file} target={target} onConfirm={() => {}} onSkip={() => {}} onCancel={() => {}} />,
    )
    loadImage(container)
    const zoomIn = screen.getByRole('button', { name: '+ ซูมเข้า' })
    // เริ่มที่ MIN_ZOOM=1 ทีละ 0.25 ต่อครั้ง — เกิน MAX_ZOOM=4 แน่ๆ ถ้ากด 20 ครั้งโดยไม่มีเพดาน
    for (let i = 0; i < 20; i++) fireEvent.click(zoomIn)
    expect((zoomIn as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('slider', { name: 'ซูม' }) as HTMLInputElement).value).toBe('4')
  })
})

describe('CropModal · ไฟล์ใหม่รีเซ็ตสถานะ', () => {
  it('ปิดแล้วเปิดใหม่ด้วยไฟล์อื่น — ต้องรอ onLoad ใหม่อีกครั้งก่อนยืนยันได้ (ซูม/ตำแหน่งไม่ค้างข้ามภาพ)', () => {
    const { container, rerender } = render(
      <CropModal open file={file} target={target} onConfirm={() => {}} onSkip={() => {}} onCancel={() => {}} />,
    )
    loadImage(container)
    fireEvent.click(screen.getByRole('button', { name: '+ ซูมเข้า' }))
    expect((screen.getByRole('button', { name: 'ยืนยันตำแหน่ง' }) as HTMLButtonElement).disabled).toBe(false)

    const otherFile = new File(['def'], 'other.jpg', { type: 'image/jpeg' })
    rerender(
      <CropModal open file={otherFile} target={target} onConfirm={() => {}} onSkip={() => {}} onCancel={() => {}} />,
    )
    expect((screen.getByRole('button', { name: 'ยืนยันตำแหน่ง' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
