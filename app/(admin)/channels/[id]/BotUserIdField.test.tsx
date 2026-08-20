// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FetchBotInfoResult } from '../actions'
import { BotUserIdField } from './BotUserIdField'

afterEach(cleanup)

/**
 * ฟอร์มตัวอย่างที่มีช่อง access_token อยู่นอก BotUserIdField เหมือนหน้าจอจริง —
 * BotUserIdField ต้องอ่านค่าที่พิมพ์ไว้ในนั้นสดๆ ตอนกดปุ่ม ไม่ใช่รับผ่าน props
 */
function Sample({ channelId, action, defaultValue = '', disabled = false, onFormSubmit }: {
  channelId: string | null
  action: (channelId: string | null, formData: FormData) => Promise<FetchBotInfoResult>
  defaultValue?: string
  disabled?: boolean
  onFormSubmit?: () => void
}) {
  return (
    <form onSubmit={(event) => { event.preventDefault(); onFormSubmit?.() }}>
      <input name="access_token" type="password" defaultValue="" />
      <BotUserIdField channelId={channelId} defaultValue={defaultValue} disabled={disabled} action={action} />
    </form>
  )
}

const botUserIdInput = () => document.querySelector('input[name="line_bot_user_id"]') as HTMLInputElement
const accessTokenInput = () => document.querySelector('input[name="access_token"]') as HTMLInputElement
const fetchButton = () => screen.getByRole('button', { name: /ดึง Bot User ID อัตโนมัติ/ })

describe('BotUserIdField · กดปุ่มดึงอัตโนมัติ', () => {
  it('ส่ง channelId และค่าที่พิมพ์อยู่ในช่อง access_token ตอนนี้ให้ action', async () => {
    const action = vi.fn(async (_channelId: string | null, _formData: FormData): Promise<FetchBotInfoResult> => (
      { ok: true, userId: 'Ubot1' }
    ))
    render(<Sample channelId="ch1" action={action} />)

    fireEvent.change(accessTokenInput(), { target: { value: 'freshly-typed-token' } })
    fireEvent.click(fetchButton())

    await waitFor(() => expect(action).toHaveBeenCalledOnce())
    expect(action.mock.calls[0][0]).toBe('ch1')
    const formData = action.mock.calls[0][1]
    expect(formData.get('access_token')).toBe('freshly-typed-token')
  })

  it('บัญชีใหม่ (channelId เป็น null) ถูกส่งเข้า action ตรงๆ', async () => {
    const action = vi.fn(async (_channelId: string | null, _formData: FormData): Promise<FetchBotInfoResult> => (
      { ok: true, userId: 'Ubot1' }
    ))
    render(<Sample channelId={null} action={action} />)

    fireEvent.click(fetchButton())

    await waitFor(() => expect(action).toHaveBeenCalledOnce())
    expect(action.mock.calls[0][0]).toBeNull()
  })

  it('ไม่ submit ฟอร์มที่ครอบอยู่ — ปุ่มดึงเป็นคนละเรื่องกับปุ่มบันทึก', async () => {
    const action = vi.fn(async (): Promise<FetchBotInfoResult> => ({ ok: true, userId: 'Ubot1' }))
    const onFormSubmit = vi.fn()
    render(<Sample channelId="ch1" action={action} onFormSubmit={onFormSubmit} />)

    fireEvent.click(fetchButton())
    await waitFor(() => expect(action).toHaveBeenCalledOnce())

    expect(onFormSubmit).not.toHaveBeenCalled()
  })
})

describe('BotUserIdField · ดึงสำเร็จ', () => {
  it('เติมค่า userId ที่ได้ลงในช่อง Bot user ID ให้เห็นจริง', async () => {
    const action = vi.fn(async (): Promise<FetchBotInfoResult> => ({ ok: true, userId: 'Ubot9876543210' }))
    render(<Sample channelId="ch1" action={action} defaultValue="" />)

    expect(botUserIdInput().value).toBe('')
    fireEvent.click(fetchButton())

    await waitFor(() => expect(botUserIdInput().value).toBe('Ubot9876543210'))
  })

  it('แสดงข้อความยืนยันว่าดึงสำเร็จ ให้คนเห็นค่าที่ลงจริง ก่อนจะกดบันทึกเอง', async () => {
    const action = vi.fn(async (): Promise<FetchBotInfoResult> => ({ ok: true, userId: 'Ubot1' }))
    render(<Sample channelId="ch1" action={action} />)

    fireEvent.click(fetchButton())

    await waitFor(() => expect(screen.getByText(/ดึงสำเร็จ/)).toBeDefined())
  })

  it('ไม่มี ErrorModal ค้างอยู่หลังสำเร็จ', async () => {
    const action = vi.fn(async (): Promise<FetchBotInfoResult> => ({ ok: true, userId: 'Ubot1' }))
    render(<Sample channelId="ch1" action={action} />)

    fireEvent.click(fetchButton())
    await waitFor(() => expect(botUserIdInput().value).toBe('Ubot1'))

    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('BotUserIdField · action คืนค่า {ok:false}', () => {
  it('แสดงข้อความจริงใน ErrorModal และไม่แก้ค่าในช่อง Bot user ID', async () => {
    const action = vi.fn(async (): Promise<FetchBotInfoResult> => (
      { ok: false, message: 'ดึงข้อมูลบอทจาก LINE ไม่สำเร็จ (401) Invalid channel access token' }
    ))
    render(<Sample channelId="ch1" action={action} defaultValue="U-old-value" />)

    fireEvent.click(fetchButton())

    await waitFor(() => {
      expect(screen.getByText('ดึงข้อมูลบอทจาก LINE ไม่สำเร็จ (401) Invalid channel access token')).toBeDefined()
    })
    expect(botUserIdInput().value).toBe('U-old-value')
  })

  it('ปิด ErrorModal แล้วข้อความหายไป และกดดึงใหม่ได้อีก', async () => {
    const action = vi.fn(async (): Promise<FetchBotInfoResult> => ({ ok: false, message: 'พัง' }))
    render(<Sample channelId="ch1" action={action} />)

    fireEvent.click(fetchButton())
    await waitFor(() => expect(screen.getByText('พัง')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'ปิด' }))
    expect(screen.queryByText('พัง')).toBeNull()
    expect((fetchButton() as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('BotUserIdField · action พังแบบไม่คาดคิดจริงๆ (throw หลุดออกมาแทนที่จะ return)', () => {
  it('ยังจับไว้ได้ — เป็น safety net ไม่ปล่อยเป็น unhandled rejection', async () => {
    const action = vi.fn(async () => { throw new Error('บั๊กที่ไม่คาดคิด') })
    render(<Sample channelId="ch1" action={action} />)

    fireEvent.click(fetchButton())
    await waitFor(() => expect(screen.getByText('บั๊กที่ไม่คาดคิด')).toBeDefined())
  })
})

describe('BotUserIdField · สถานะกำลังดึง', () => {
  it('ระหว่างดึง — ปุ่มโชว์ "กำลังดึง…" และถูกปิดใช้งาน กันกดซ้ำ', async () => {
    let resolveAction: (result: FetchBotInfoResult) => void = () => {}
    const pending = new Promise<FetchBotInfoResult>((resolve) => { resolveAction = resolve })
    const action = vi.fn(async () => pending)
    render(<Sample channelId="ch1" action={action} />)

    fireEvent.click(fetchButton())

    await waitFor(() => expect(screen.getByText('กำลังดึง…')).toBeDefined())
    expect((screen.getByRole('button', { name: 'กำลังดึง…' }) as HTMLButtonElement).disabled).toBe(true)

    resolveAction({ ok: true, userId: 'Ubot1' })
    await waitFor(() => expect(screen.queryByText('กำลังดึง…')).toBeNull())
  })
})

describe('BotUserIdField · ปิดใช้งาน (locked/preview)', () => {
  it('disabled=true ปิดทั้งช่องกรอกและปุ่มดึง', () => {
    const action = vi.fn(async (): Promise<FetchBotInfoResult> => ({ ok: true, userId: 'Ubot1' }))
    render(<Sample channelId="ch1" action={action} disabled />)

    expect(botUserIdInput().disabled).toBe(true)
    expect((fetchButton() as HTMLButtonElement).disabled).toBe(true)
  })
})
