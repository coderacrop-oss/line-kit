// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionResult } from '@/lib/actions/result'
import { LiffAppForm } from './LiffAppForm'

afterEach(cleanup)

const refresh = vi.fn()
beforeEach(() => { refresh.mockClear() })
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

/** ฟอร์มตัวอย่างที่พอส่งได้จริง — ปุ่มบันทึกเป็นลูกของ LiffAppForm เหมือนหน้าจอจริง */
function Sample({ action }: { action: (formData: FormData) => Promise<ActionResult> }) {
  return (
    <LiffAppForm action={action}>
      <input name="name" />
      <button type="submit">ลงทะเบียน</button>
    </LiffAppForm>
  )
}

describe('LiffAppForm · บันทึกสำเร็จ', () => {
  it('เรียก action ด้วย FormData ของฟอร์ม แล้ว router.refresh() ให้ลิสต์ดึงแถวใหม่มาแสดง', async () => {
    const action = vi.fn(async (_formData: FormData): Promise<ActionResult> => ({ ok: true }))
    render(<Sample action={action} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DewLIFF v2' } })
    fireEvent.click(screen.getByRole('button', { name: 'ลงทะเบียน' }))

    await waitFor(() => expect(action).toHaveBeenCalledOnce())
    const formData = action.mock.calls[0][0] as FormData
    expect(formData.get('name')).toBe('DewLIFF v2')

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('เคลียร์ฟอร์มกลับเป็นค่าว่างหลังสำเร็จ — ไม่ให้ค้างค่าที่บันทึกไปแล้ว', async () => {
    const action = vi.fn(async (): Promise<ActionResult> => ({ ok: true }))
    render(<Sample action={action} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'DewLIFF v2' } })
    fireEvent.click(screen.getByRole('button', { name: 'ลงทะเบียน' }))

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(input.value).toBe('')
  })

  it('ปุ่มถูกปลดล็อกกลับมาให้กดใหม่ได้หลังสำเร็จ — จอเดิมยังอยู่ ไม่มีหน้าอื่นให้รอ navigate ไปแบบ ChannelForm', async () => {
    const action = vi.fn(async (): Promise<ActionResult> => ({ ok: true }))
    const { container } = render(<Sample action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'ลงทะเบียน' }))

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(false)
  })
})

/**
 * action คืนค่า {ok:false} (เช่น LIFF ID ซ้ำ หรือ error อื่นจาก DB) — ต้องเห็นข้อความ
 * จริงในกล่อง error ไม่ใช่รายการที่ไม่ยอมโตขึ้นแบบเงียบๆ (นี่คือ finding ที่ task review เจอ)
 */
describe('LiffAppForm · action คืนค่า {ok:false}', () => {
  it('แสดงข้อความเป๊ะๆ ใน ErrorModal และไม่ refresh', async () => {
    const action = vi.fn(async (): Promise<ActionResult> => (
      { ok: false, message: 'LIFF ID นี้ถูกใช้ลงทะเบียนไปแล้ว' }
    ))
    render(<Sample action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'ลงทะเบียน' }))

    await waitFor(() => expect(screen.getByText('LIFF ID นี้ถูกใช้ลงทะเบียนไปแล้ว')).toBeDefined())
    expect(refresh).not.toHaveBeenCalled()
  })

  it('ปุ่มถูกปลดล็อกกลับมาให้กดใหม่ได้ และค่าที่กรอกไว้ยังอยู่ (ไม่ reset ตอนพัง)', async () => {
    const action = vi.fn(async (): Promise<ActionResult> => ({ ok: false, message: 'พัง' }))
    const { container } = render(<Sample action={action} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'DewLIFF v2' } })
    fireEvent.click(screen.getByRole('button', { name: 'ลงทะเบียน' }))
    await waitFor(() => expect(screen.getByText('พัง')).toBeDefined())

    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(false)
    expect(input.value).toBe('DewLIFF v2')
  })

  it('ปิด ErrorModal แล้วข้อความหายไป', async () => {
    const action = vi.fn(async (): Promise<ActionResult> => ({ ok: false, message: 'พัง' }))
    render(<Sample action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'ลงทะเบียน' }))
    await waitFor(() => expect(screen.getByText('พัง')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'ปิด' }))
    expect(screen.queryByText('พัง')).toBeNull()
  })
})

describe('LiffAppForm · action พังแบบไม่คาดคิดจริงๆ (throw หลุดออกมาแทนที่จะ return)', () => {
  it('ยังจับไว้ได้ — เป็น safety net ไม่ปล่อยเป็น unhandled rejection', async () => {
    const action = vi.fn(async () => { throw new Error('บั๊กที่ไม่คาดคิด') })
    render(<Sample action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'ลงทะเบียน' }))
    await waitFor(() => expect(screen.getByText('บั๊กที่ไม่คาดคิด')).toBeDefined())
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('LiffAppForm · สถานะกำลังบันทึก', () => {
  it('ระหว่างบันทึก — ข้อความ "กำลังบันทึก…" ปรากฏ และ fieldset ถูกปิดใช้งานทั้งฟอร์ม', async () => {
    let resolveAction: (result: ActionResult) => void = () => {}
    const pending = new Promise<ActionResult>((resolve) => { resolveAction = resolve })
    const action = vi.fn(async () => pending)
    const { container } = render(<Sample action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'ลงทะเบียน' }))

    await waitFor(() => expect(screen.getByText('กำลังบันทึก…')).toBeDefined())
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true)

    resolveAction({ ok: false, message: 'พัง' })
    await waitFor(() => expect(screen.queryByText('กำลังบันทึก…')).toBeNull())
  })
})
