// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PublishForm } from './PublishForm'
import type { PublishResult } from './actions'

afterEach(cleanup)

const push = vi.fn()
beforeEach(() => { push.mockClear() })
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

/**
 * นี่คือเทสต์ของแก่นการแก้บั๊ก — ปุ่มค้างหมุนตลอดไปที่เจอในโปรดักชันสามครั้ง
 * (v6 · v7 · v9) เพราะจอเดิมพึ่ง Next.js ตาม redirect ที่ throw ออกจาก Server
 * Action ให้เอง ซึ่งพังจริง ทางแก้คือให้ `publish()` คืนค่าธรรมดา แล้วให้ฟอร์มนี้
 * ทำ navigation เองด้วย router.push() — เทสต์กลุ่มนี้จึงต้องพิสูจน์ตรงๆ ว่า
 * router.push ถูกเรียกด้วย URL ที่ถูกต้องจริง ไม่ใช่แค่ว่า action ถูกเรียก
 */
describe('PublishForm · ส่งสำเร็จ', () => {
  it('เรียก action ด้วยรหัสแคมเปญและ FormData ของฟอร์ม แล้ว router.push ไปหน้า ?done=N', async () => {
    const action = vi.fn(async (_campaignId: string, _formData: FormData): Promise<PublishResult> => (
      { ok: true, versionNo: 9 }
    ))
    render(
      <PublishForm campaignId="camp-1" channelId="ch-test" canPublish isProduction={false} action={action}>
        <div>เนื้อหาลูก</div>
      </PublishForm>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'ส่งขึ้น LINE' }))

    await waitFor(() => expect(action).toHaveBeenCalledOnce())
    expect(action.mock.calls[0][0]).toBe('camp-1')
    const formData = action.mock.calls[0][1] as FormData
    expect(formData.get('channel_id')).toBe('ch-test')

    await waitFor(() => expect(push).toHaveBeenCalledWith('/campaigns/camp-1/publish?done=9'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('ปุ่มยังล็อกค้างอยู่หลังสำเร็จ — ไม่กะพริบกลับมากดซ้ำได้ก่อนจอจะเปลี่ยนจริง', async () => {
    const action = vi.fn(async (): Promise<PublishResult> => ({ ok: true, versionNo: 9 }))
    const { container } = render(
      <PublishForm campaignId="camp-1" channelId="ch-test" canPublish isProduction={false} action={action}>
        <div />
      </PublishForm>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'ส่งขึ้น LINE' }))

    await waitFor(() => expect(push).toHaveBeenCalledOnce())
    // จงใจตรวจว่า busy ไม่ถูกรีเซ็ตหลังสำเร็จ — ปุ่มต้องค้าง disabled ต่อไปจนกว่า
    // router.push จะพาไปหน้าใหม่จริง (jsdom ไม่ implement การไล่ปิด fieldset ตามสเปก
    // เหมือน ActionForm.test.tsx จึงเช็คที่ fieldset โดยตรง)
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
  })
})

/**
 * action คืนค่า {ok:false} (ปฏิเสธแบบตั้งใจ เช่น ด่านตรวจไม่ผ่านหรือ BR-68 ชนกัน)
 */
describe('PublishForm · action คืนค่า {ok:false}', () => {
  it('แสดงข้อความเป๊ะๆ ใน ErrorModal และไม่ navigate', async () => {
    const action = vi.fn(async (): Promise<PublishResult> => (
      { ok: false, message: 'บัญชี LINE นี้มีแคมเปญ ปีใหม่ 2569 เปิดอยู่ (BR-68 · ERR-032)' }
    ))
    render(
      <PublishForm campaignId="camp-1" channelId="ch-test" canPublish isProduction={false} action={action}>
        <div />
      </PublishForm>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'ส่งขึ้น LINE' }))

    await waitFor(() => {
      expect(screen.getByText('บัญชี LINE นี้มีแคมเปญ ปีใหม่ 2569 เปิดอยู่ (BR-68 · ERR-032)')).toBeDefined()
    })
    expect(push).not.toHaveBeenCalled()
  })

  it('ปุ่มถูกปลดล็อกกลับมาให้กดใหม่ได้', async () => {
    const action = vi.fn(async (): Promise<PublishResult> => ({ ok: false, message: 'พัง' }))
    const { container } = render(
      <PublishForm campaignId="camp-1" channelId="ch-test" canPublish isProduction={false} action={action}>
        <div />
      </PublishForm>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'ส่งขึ้น LINE' }))
    await waitFor(() => expect(screen.getByText('พัง')).toBeDefined())

    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(false)
  })

  it('ปิด ErrorModal แล้วข้อความหายไป', async () => {
    const action = vi.fn(async (): Promise<PublishResult> => ({ ok: false, message: 'พัง' }))
    render(
      <PublishForm campaignId="camp-1" channelId="ch-test" canPublish isProduction={false} action={action}>
        <div />
      </PublishForm>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'ส่งขึ้น LINE' }))
    await waitFor(() => expect(screen.getByText('พัง')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'ปิด' }))
    expect(screen.queryByText('พัง')).toBeNull()
  })
})

describe('PublishForm · action พังแบบไม่คาดคิดจริงๆ (throw หลุดออกมาแทนที่จะ return)', () => {
  it('ยังจับไว้ได้ — เป็น safety net ไม่ปล่อยเป็น unhandled rejection', async () => {
    const action = vi.fn(async () => { throw new Error('บั๊กที่ไม่คาดคิด') })
    render(
      <PublishForm campaignId="camp-1" channelId="ch-test" canPublish isProduction={false} action={action}>
        <div />
      </PublishForm>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'ส่งขึ้น LINE' }))
    await waitFor(() => expect(screen.getByText('บั๊กที่ไม่คาดคิด')).toBeDefined())
    expect(push).not.toHaveBeenCalled()
  })
})

describe('PublishForm · สถานะกำลังส่ง', () => {
  it('ระหว่างส่ง — ปุ่มเปลี่ยนข้อความและ fieldset ถูกปิดใช้งานทั้งฟอร์ม', async () => {
    let resolveAction: (result: PublishResult) => void = () => {}
    const pending = new Promise<PublishResult>((resolve) => { resolveAction = resolve })
    const action = vi.fn(async () => pending)
    const { container } = render(
      <PublishForm campaignId="camp-1" channelId="ch-test" canPublish isProduction={false} action={action}>
        <div />
      </PublishForm>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'ส่งขึ้น LINE' }))

    await waitFor(() => expect(screen.getByText('กำลังส่งขึ้น LINE…')).toBeDefined())
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true)

    resolveAction({ ok: false, message: 'พัง' })
    await waitFor(() => expect(screen.queryByText('กำลังส่งขึ้น LINE…')).toBeNull())
  })
})

describe('PublishForm · ปุ่มตามชั้นบัญชี', () => {
  it('บัญชีจริง — ข้อความปุ่มเตือนว่าเป็นบัญชีจริงของลูกค้า', async () => {
    const action = vi.fn(async (): Promise<PublishResult> => ({ ok: true, versionNo: 1 }))
    render(
      <PublishForm campaignId="camp-1" channelId="ch-prod" canPublish isProduction action={action}>
        <div />
      </PublishForm>,
    )
    expect(screen.getByRole('button', { name: 'ส่งขึ้น LINE — บัญชีจริงของลูกค้า' })).toBeDefined()
  })

  it('canPublish=false — ปุ่มถูกปิดไว้ตั้งแต่แรก', () => {
    const action = vi.fn(async (): Promise<PublishResult> => ({ ok: true, versionNo: 1 }))
    render(
      <PublishForm campaignId="camp-1" channelId="ch-test" canPublish={false} isProduction={false} action={action}>
        <div />
      </PublishForm>,
    )
    expect((screen.getByRole('button', { name: 'ส่งขึ้น LINE' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
