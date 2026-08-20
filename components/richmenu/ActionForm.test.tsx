// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionResult } from '@/lib/actions/result'
import { ActionForm } from './ActionForm'
import { setFormOverride } from './formOverride'

afterEach(cleanup)

const refresh = vi.fn()
beforeEach(() => { refresh.mockClear() })
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

/** ลูกตัวอย่างที่ลงทะเบียนไฟล์แทนที่ — จำลอง ImagePicker ตอนตัดภาพเสร็จ */
function OverrideRegistrar({ file }: { file: File | null }) {
  return (
    <button
      type="button"
      onClick={(event) => setFormOverride(event.currentTarget.form, file ? { field: 'image_file', file } : null)}
    >
      ลงทะเบียนไฟล์แทนที่
    </button>
  )
}

describe('ActionForm · ส่งสำเร็จ', () => {
  it('เรียก action ด้วย FormData ของฟอร์ม แล้วสั่ง router.refresh() — ไม่โชว์ ErrorModal', async () => {
    const action = vi.fn(async (_formData: FormData): Promise<ActionResult> => ({ ok: true }))
    render(
      <ActionForm action={action}>
        <input name="alias" defaultValue="main" />
        <button type="submit">บันทึก</button>
      </ActionForm>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))

    await waitFor(() => expect(action).toHaveBeenCalledOnce())
    const formData = action.mock.calls[0][0] as FormData
    expect(formData.get('alias')).toBe('main')
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

/**
 * นี่คือแก่นของการแก้บั๊ก — action ไม่ throw อีกต่อไป (Next.js เซ็นเซอร์ข้อความของ
 * error ที่ throw ทิ้งเสมอในโปรดักชัน พิสูจน์แล้วกับ next build && next start จริง
 * ไม่ว่าจะเรียกผ่าน `<form action=>` หรือเรียกตรงๆ ก็ตาม) แต่คืนค่า `{ok:false,
 * message}` แทน ซึ่งเป็นข้อมูลธรรมดา ไม่ผ่าน pipeline เซ็นเซอร์เลย — ดู doc comment
 * ของ ActionForm.tsx และ lib/actions/result.ts
 */
describe('ActionForm · action คืนค่า {ok:false} (ปฏิเสธแบบตั้งใจ เช่น ERR-037)', () => {
  it('แสดงข้อความเป๊ะๆ ใน ErrorModal — ไม่ปล่อยหลุดเป็น unhandled rejection', async () => {
    const action = vi.fn(async (_formData: FormData): Promise<ActionResult> => (
      { ok: false, message: 'ERR-037 · ภาพเล็กเกินไปสำหรับผังนี้ — ต้องขยาย 2.8 เท่า' }
    ))
    render(
      <ActionForm action={action}>
        <button type="submit">บันทึก</button>
      </ActionForm>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))

    await waitFor(() => {
      expect(screen.getByText('ERR-037 · ภาพเล็กเกินไปสำหรับผังนี้ — ต้องขยาย 2.8 เท่า')).toBeDefined()
    })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('ปิด ErrorModal แล้วข้อความหายไป', async () => {
    const action = vi.fn(async (_formData: FormData): Promise<ActionResult> => ({ ok: false, message: 'พัง' }))
    render(
      <ActionForm action={action}>
        <button type="submit">บันทึก</button>
      </ActionForm>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    await waitFor(() => expect(screen.getByText('พัง')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'ปิด' }))
    expect(screen.queryByText('พัง')).toBeNull()
  })

  it('ส่งใหม่อีกครั้งแล้วสำเร็จ — ErrorModal จากรอบก่อนหายไปเอง', async () => {
    const action = vi.fn<(formData: FormData) => Promise<ActionResult>>()
      .mockResolvedValueOnce({ ok: false, message: 'รอบแรกพัง' })
      .mockResolvedValueOnce({ ok: true })
    render(
      <ActionForm action={action}>
        <button type="submit">บันทึก</button>
      </ActionForm>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    await waitFor(() => expect(screen.getByText('รอบแรกพัง')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    await waitFor(() => expect(screen.queryByText('รอบแรกพัง')).toBeNull())
  })
})

describe('ActionForm · action พังแบบไม่คาดคิดจริงๆ (throw หลุดออกมาแทนที่จะ return)', () => {
  it('ยังจับไว้ได้ — เป็น safety net ไม่ปล่อยเป็น unhandled rejection', async () => {
    const action = vi.fn(async () => { throw new Error('บั๊กที่ไม่คาดคิด') })
    render(
      <ActionForm action={action}>
        <button type="submit">บันทึก</button>
      </ActionForm>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    await waitFor(() => expect(screen.getByText('บั๊กที่ไม่คาดคิด')).toBeDefined())
  })

  it('error ที่ไม่ใช่ Error instance ยังโชว์ข้อความสำรองที่อ่านรู้เรื่อง', async () => {
    const action = vi.fn(async () => { throw 'string เฉยๆ' })
    render(
      <ActionForm action={action}>
        <button type="submit">บันทึก</button>
      </ActionForm>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    await waitFor(() => expect(screen.getByText('บันทึกไม่สำเร็จ — ลองใหม่')).toBeDefined())
  })
})

describe('ActionForm · ไฟล์แทนที่จาก CropModal', () => {
  it('ไม่มีการลงทะเบียนไฟล์แทนที่ — ช่อง image_file ยังอยู่ในฟอร์มตามปกติ (ไม่ถูกตัดทิ้งโดย ActionForm)', async () => {
    // หมายเหตุ: jsdom ไม่คืนชื่อไฟล์จริงตอนอ่านผ่าน `new FormData(form)` หลัง
    // fireEvent.change (ข้อจำกัดของ jsdom เอง — input.files ได้ไฟล์ถูกต้อง แต่
    // FormData(form) อ่านชื่อกลับมาว่างเสมอ) เทสต์นี้จึงเช็คแค่ว่าช่องยังอยู่ ไม่เช็ค
    // ชื่อไฟล์ — เทสต์ถัดไปที่ "มีการลงทะเบียนไฟล์แทนที่" ต่างหากที่ยืนยันชื่อไฟล์จริง
    // เพราะอ่านจาก override ref ตรงๆ ไม่ผ่านข้อจำกัดนี้
    const action = vi.fn(async (_formData: FormData): Promise<ActionResult> => ({ ok: true }))
    const original = new File(['a'], 'original.jpg', { type: 'image/jpeg' })
    const { container } = render(
      <ActionForm action={action}>
        <input type="file" name="image_file" />
        <button type="submit">บันทึก</button>
      </ActionForm>,
    )
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [original] } })
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    await waitFor(() => expect(action).toHaveBeenCalledOnce())
    const formData = action.mock.calls[0][0] as FormData
    expect(formData.has('image_file')).toBe(true)
  })

  it('มีการลงทะเบียนไฟล์แทนที่ — FormData ที่ส่งจริงใช้ไฟล์ที่ตัดมาแล้ว ไม่ใช่ไฟล์เดิมในช่อง input', async () => {
    const action = vi.fn(async (_formData: FormData): Promise<ActionResult> => ({ ok: true }))
    const original = new File(['a'], 'original.jpg', { type: 'image/jpeg' })
    const cropped = new File(['b'], 'cropped.jpg', { type: 'image/jpeg' })
    const { container } = render(
      <ActionForm action={action}>
        <input type="file" name="image_file" />
        <OverrideRegistrar file={cropped} />
        <button type="submit">บันทึก</button>
      </ActionForm>,
    )
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [original] } })
    fireEvent.click(screen.getByRole('button', { name: 'ลงทะเบียนไฟล์แทนที่' }))
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))

    await waitFor(() => expect(action).toHaveBeenCalledOnce())
    const file = (action.mock.calls[0][0] as FormData).get('image_file') as File
    expect(file.name).toBe('cropped.jpg')
  })
})

describe('ActionForm · สถานะกำลังบันทึก', () => {
  // หมายเหตุ: jsdom implement แค่ property `fieldset.disabled` เอง ไม่ implement
  // การ "ไล่ปิด" ลูกหลานจริงๆ ตามสเปก (เบราว์เซอร์จริงทำ — ตรวจแล้วด้วยมือผ่าน
  // Playwright) เทสต์นี้จึงเช็คที่ fieldset โดยตรงแทนที่จะเช็ค button.disabled
  it('ระหว่างส่ง — fieldset ถูกปิดใช้งาน (ปิดทุกอย่างในฟอร์มพร้อมกัน) และมีข้อความ "กำลังบันทึก…"', async () => {
    let resolveAction: (result: ActionResult) => void = () => {}
    const pending = new Promise<ActionResult>((resolve) => { resolveAction = resolve })
    const action = vi.fn(async (_formData: FormData) => pending)
    const { container } = render(
      <ActionForm action={action}>
        <button type="submit">บันทึก</button>
      </ActionForm>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))

    await waitFor(() => expect(screen.getByText('กำลังบันทึก…')).toBeDefined())
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true)

    resolveAction({ ok: true })
    await waitFor(() => expect(screen.queryByText('กำลังบันทึก…')).toBeNull())
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(false)
  })
})
