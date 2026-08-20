// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionResult } from '@/lib/actions/result'
import { ChannelForm } from './ChannelForm'

afterEach(cleanup)

const push = vi.fn()
beforeEach(() => { push.mockClear() })
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

/** ฟอร์มตัวอย่างที่พอส่งได้จริง — ปุ่มบันทึกเป็นลูกของ ChannelForm เหมือนหน้าจอจริง */
function Sample({ channelId, action }: {
  channelId: string | null
  action: (channelId: string | null, formData: FormData) => Promise<ActionResult>
}) {
  return (
    <ChannelForm channelId={channelId} action={action}>
      <input name="name" defaultValue="OA ทดสอบ" />
      <button type="submit">บันทึกบัญชี</button>
    </ChannelForm>
  )
}

/**
 * นี่คือเทสต์ของแก่นการแก้บั๊ก — คนกรอกกุญแจมาแค่ช่องเดียวเจอบันทึกล้มเหลวแบบเงียบๆ
 * ในโปรดักชันจริง เพราะจอเดิมพึ่ง Next.js เซ็นเซอร์ข้อความ error ของ Server Action
 * ทิ้งเสมอ ทางแก้คือให้ `saveChannel()` คืนค่าธรรมดา แล้วให้ฟอร์มนี้อ่านผลลัพธ์เอง
 * และทำ navigation เองด้วย router.push() — เทสต์กลุ่มนี้จึงต้องพิสูจน์ตรงๆ ว่า
 * router.push ถูกเรียกด้วย URL ที่ถูกต้องจริง ไม่ใช่แค่ว่า action ถูกเรียก
 */
describe('ChannelForm · บันทึกสำเร็จ', () => {
  it('เรียก action ด้วย channelId และ FormData ของฟอร์ม แล้ว router.push ไปหน้ารายการบัญชี', async () => {
    const action = vi.fn(async (_channelId: string | null, _formData: FormData): Promise<ActionResult> => (
      { ok: true }
    ))
    render(<Sample channelId="ch1" action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกบัญชี' }))

    await waitFor(() => expect(action).toHaveBeenCalledOnce())
    expect(action.mock.calls[0][0]).toBe('ch1')
    const formData = action.mock.calls[0][1] as FormData
    expect(formData.get('name')).toBe('OA ทดสอบ')

    await waitFor(() => expect(push).toHaveBeenCalledWith('/channels'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('บัญชีใหม่ (channelId เป็น null) ถูกส่งเข้า action ตรงๆ', async () => {
    const action = vi.fn(async (_channelId: string | null, _formData: FormData): Promise<ActionResult> => (
      { ok: true }
    ))
    render(<Sample channelId={null} action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกบัญชี' }))

    await waitFor(() => expect(action).toHaveBeenCalledOnce())
    expect(action.mock.calls[0][0]).toBeNull()
  })

  it('ปุ่มยังล็อกค้างอยู่หลังสำเร็จ — ไม่กะพริบกลับมากดซ้ำได้ก่อนจอจะเปลี่ยนจริง', async () => {
    const action = vi.fn(async (): Promise<ActionResult> => ({ ok: true }))
    const { container } = render(<Sample channelId="ch1" action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกบัญชี' }))

    await waitFor(() => expect(push).toHaveBeenCalledOnce())
    // jsdom ไม่ implement การไล่ปิด fieldset ตามสเปกเหมือน PublishForm.test.tsx
    // จึงเช็คที่ fieldset โดยตรง
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
  })
})

/**
 * action คืนค่า {ok:false} (ปฏิเสธแบบตั้งใจ เช่น กรอกกุญแจมาแค่ช่องเดียว หรือ Channel
 * ID ซ้ำกับบัญชีอื่น) — ต้องเห็นข้อความจริง ไม่ใช่ "Application error" ของ Next.js
 */
describe('ChannelForm · action คืนค่า {ok:false}', () => {
  it('แสดงข้อความเป๊ะๆ ใน ErrorModal และไม่ navigate', async () => {
    const action = vi.fn(async (): Promise<ActionResult> => (
      { ok: false, message: 'กุญแจต้องเปลี่ยนพร้อมกันทั้งสองช่อง — โทเคนของ OA หนึ่งกับซีเคร็ตของอีก OA หนึ่งใช้ด้วยกันไม่ได้' }
    ))
    render(<Sample channelId="ch1" action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกบัญชี' }))

    await waitFor(() => {
      expect(screen.getByText('กุญแจต้องเปลี่ยนพร้อมกันทั้งสองช่อง — โทเคนของ OA หนึ่งกับซีเคร็ตของอีก OA หนึ่งใช้ด้วยกันไม่ได้')).toBeDefined()
    })
    expect(push).not.toHaveBeenCalled()
  })

  it('ปุ่มถูกปลดล็อกกลับมาให้กดใหม่ได้', async () => {
    const action = vi.fn(async (): Promise<ActionResult> => ({ ok: false, message: 'พัง' }))
    const { container } = render(<Sample channelId="ch1" action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกบัญชี' }))
    await waitFor(() => expect(screen.getByText('พัง')).toBeDefined())

    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(false)
  })

  it('ปิด ErrorModal แล้วข้อความหายไป', async () => {
    const action = vi.fn(async (): Promise<ActionResult> => ({ ok: false, message: 'พัง' }))
    render(<Sample channelId="ch1" action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกบัญชี' }))
    await waitFor(() => expect(screen.getByText('พัง')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'ปิด' }))
    expect(screen.queryByText('พัง')).toBeNull()
  })
})

describe('ChannelForm · action พังแบบไม่คาดคิดจริงๆ (throw หลุดออกมาแทนที่จะ return)', () => {
  it('ยังจับไว้ได้ — เป็น safety net ไม่ปล่อยเป็น unhandled rejection', async () => {
    const action = vi.fn(async () => { throw new Error('บั๊กที่ไม่คาดคิด') })
    render(<Sample channelId="ch1" action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกบัญชี' }))
    await waitFor(() => expect(screen.getByText('บั๊กที่ไม่คาดคิด')).toBeDefined())
    expect(push).not.toHaveBeenCalled()
  })
})

describe('ChannelForm · สถานะกำลังบันทึก', () => {
  it('ระหว่างบันทึก — ข้อความ "กำลังบันทึก…" ปรากฏ และ fieldset ถูกปิดใช้งานทั้งฟอร์ม', async () => {
    let resolveAction: (result: ActionResult) => void = () => {}
    const pending = new Promise<ActionResult>((resolve) => { resolveAction = resolve })
    const action = vi.fn(async () => pending)
    const { container } = render(<Sample channelId="ch1" action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกบัญชี' }))

    await waitFor(() => expect(screen.getByText('กำลังบันทึก…')).toBeDefined())
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true)

    resolveAction({ ok: false, message: 'พัง' })
    await waitFor(() => expect(screen.queryByText('กำลังบันทึก…')).toBeNull())
  })
})
