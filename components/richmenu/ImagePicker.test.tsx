// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi,
} from 'vitest'
import { ActionForm } from './ActionForm'
import { ImagePicker } from './ImagePicker'

afterEach(cleanup)

const refresh = vi.fn()
beforeEach(() => { refresh.mockClear() })
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

// เดินสายเดียวกับ CropModal.test.tsx — ปลอม canvas/Image ที่ jsdom ไม่รองรับจริง
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext
let originalToBlob: typeof HTMLCanvasElement.prototype.toBlob
let originalCreateObjectURL: typeof URL.createObjectURL
let originalRevokeObjectURL: typeof URL.revokeObjectURL

beforeAll(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext
  originalToBlob = HTMLCanvasElement.prototype.toBlob
  originalCreateObjectURL = URL.createObjectURL
  originalRevokeObjectURL = URL.revokeObjectURL
  // @ts-expect-error — ปลอมแค่เท่าที่ CropModal ใช้จริง
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() }))
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

const file = new File(['abc'], 'photo.jpg', { type: 'image/jpeg' })

function pickFile(input: HTMLInputElement, picked: File = file) {
  fireEvent.change(input, { target: { files: [picked] } })
}

function loadImage(container: HTMLElement, width = 2000, height = 2000) {
  const img = container.querySelector('img[alt=""]') as HTMLImageElement
  Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true })
  fireEvent.load(img)
}

describe('ImagePicker · เลือกไฟล์เปิด CropModal อัตโนมัติ', () => {
  it('ยังไม่ได้เลือกไฟล์ — ไม่มี CropModal', () => {
    render(
      <ActionForm action={vi.fn(async () => ({ ok: true as const }))}>
        <ImagePicker name="image_file" canvas={{ width: 2500, height: 1686 }} />
      </ActionForm>,
    )
    expect(screen.queryByText('จัดตำแหน่งภาพ')).toBeNull()
  })

  it('เลือกไฟล์แล้ว — CropModal เปิดขึ้นทันที', () => {
    const { container } = render(
      <ActionForm action={vi.fn(async () => ({ ok: true as const }))}>
        <ImagePicker name="image_file" canvas={{ width: 2500, height: 1686 }} />
      </ActionForm>,
    )
    pickFile(container.querySelector('input[type="file"]') as HTMLInputElement)
    expect(screen.getByText('จัดตำแหน่งภาพ')).toBeDefined()
  })
})

describe('ImagePicker · ยืนยันการครอป', () => {
  it('ยืนยันตำแหน่งแล้ว — โชว์พรีวิวว่าตัดภาพไว้แล้ว และปิด CropModal', async () => {
    const { container } = render(
      <ActionForm action={vi.fn(async () => ({ ok: true as const }))}>
        <ImagePicker name="image_file" canvas={{ width: 2500, height: 1686 }} />
      </ActionForm>,
    )
    pickFile(container.querySelector('input[type="file"]') as HTMLInputElement)
    loadImage(container)
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันตำแหน่ง' }))

    await waitFor(() => expect(screen.getByText('ตัดภาพไว้แล้ว — จะใช้ภาพนี้ตอนบันทึก')).toBeDefined())
    expect(screen.queryByText('จัดตำแหน่งภาพ')).toBeNull()
  })

  it('ไฟล์ที่ตัดแล้วถูกส่งจริงตอน submit ฟอร์ม (ผ่าน override ของ ActionForm) แทนไฟล์เดิม', async () => {
    const action = vi.fn(async (_formData: FormData) => ({ ok: true as const }))
    const { container } = render(
      <ActionForm action={action}>
        <ImagePicker name="image_file" canvas={{ width: 2500, height: 1686 }} />
        <button type="submit">บันทึก</button>
      </ActionForm>,
    )
    pickFile(container.querySelector('input[type="file"]') as HTMLInputElement)
    loadImage(container)
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันตำแหน่ง' }))
    await waitFor(() => expect(screen.queryByText('จัดตำแหน่งภาพ')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    await waitFor(() => expect(action).toHaveBeenCalledOnce())
    const sent = (action.mock.calls[0][0] as FormData).get('image_file') as File
    expect(sent.name).toBe('cropped.jpg')
  })

  it('กด "ใช้ภาพนี้ทั้งภาพ" — ไฟล์เดิม (ไม่ตัด) ถูกลงทะเบียนเป็นไฟล์ที่จะส่งแทน', async () => {
    const action = vi.fn(async (_formData: FormData) => ({ ok: true as const }))
    const { container } = render(
      <ActionForm action={action}>
        <ImagePicker name="image_file" canvas={{ width: 2500, height: 1686 }} />
        <button type="submit">บันทึก</button>
      </ActionForm>,
    )
    pickFile(container.querySelector('input[type="file"]') as HTMLInputElement)
    loadImage(container)
    fireEvent.click(screen.getByRole('button', { name: 'ใช้ภาพนี้ทั้งภาพ' }))
    await waitFor(() => expect(screen.queryByText('จัดตำแหน่งภาพ')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    await waitFor(() => expect(action).toHaveBeenCalledOnce())
    const sent = (action.mock.calls[0][0] as FormData).get('image_file') as File
    expect(sent.name).toBe('photo.jpg')
  })

  it('กดยกเลิก — ล้างไฟล์ในช่อง input จริง (required จะยังไม่ผ่านจนกว่าจะเลือกใหม่)', () => {
    const { container } = render(
      <ActionForm action={vi.fn(async () => ({ ok: true as const }))}>
        <ImagePicker name="image_file" required canvas={{ width: 2500, height: 1686 }} />
      </ActionForm>,
    )
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    pickFile(input)
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }))
    expect(input.value).toBe('')
    expect(screen.queryByText('จัดตำแหน่งภาพ')).toBeNull()
  })
})

describe('ImagePicker · ขนาดผืนเป้าหมายที่ไม่รู้ล่วงหน้า (ตอนสร้างเมนูใหม่)', () => {
  it('ไม่ได้ส่ง canvas มา — อ่านผังที่เลือกไว้จาก input[name=layout]:checked ของฟอร์มเดียวกัน', () => {
    const { container } = render(
      <ActionForm action={vi.fn(async () => ({ ok: true as const }))}>
        <input type="radio" name="layout" value="small_1" defaultChecked readOnly />
        <ImagePicker name="image_file" />
      </ActionForm>,
    )
    pickFile(container.querySelector('input[type="file"]') as HTMLInputElement)
    // small_1 → ผืนเล็ก 2500×843 — ข้อความบรรทัดแรกของ CropModal ประกาศขนาดเป้าหมายไว้
    expect(screen.getByText(/2500×843/)).toBeDefined()
  })

  it('ไม่มีผังที่เลือกไว้เลย (กรณีผิดปกติ) — ใช้ผืนใหญ่เป็นค่าเริ่มต้นแทนที่จะพัง', () => {
    const { container } = render(
      <ActionForm action={vi.fn(async () => ({ ok: true as const }))}>
        <ImagePicker name="image_file" />
      </ActionForm>,
    )
    pickFile(container.querySelector('input[type="file"]') as HTMLInputElement)
    expect(screen.getByText(/2500×1686/)).toBeDefined()
  })
})
