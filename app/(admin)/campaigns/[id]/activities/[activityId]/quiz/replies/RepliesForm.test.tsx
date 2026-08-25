// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RepliesForm } from './RepliesForm'
import type { QuizConfig } from '@/lib/quiz/schema'

afterEach(cleanup)

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const saveQuizConfigAction = vi.fn(
  async (_campaignId: string, _activityId: string, _formData: FormData) => ({ ok: true as const }),
)
vi.mock('../actions', () => ({
  saveQuizConfigAction: (campaignId: string, activityId: string, formData: FormData) =>
    saveQuizConfigAction(campaignId, activityId, formData),
}))

const duoConfig: QuizConfig = {
  mode: 'duo',
  // QuizConfig.axes ต้องมีอย่างน้อย 2 แกน (lib/quiz/schema.ts) — แกนเดียวทำให้
  // safeParse ล้มเหลวเสมอ ปุ่มบันทึกที่ผูกกับ validation.success จะถูก disabled
  // ตลอดโดยไม่เกี่ยวกับสิ่งที่เทสต์นี้ทดสอบเลย
  axes: [{ id: 'ei', label: 'E/I', poles: ['E', 'I'] }, { id: 'sn', label: 'S/N', poles: ['S', 'N'] }],
  questions: [
    { id: 'q1', text: 'q1', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
    { id: 'q2', text: 'q2', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
    { id: 'q3', text: 'q3', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
  ],
  results: [{ code: 'E', title: 't', body: 'b' }, { code: 'I', title: 't', body: 'b' }],
  fallbackResultCode: 'E',
}

const soloConfig: QuizConfig = { ...duoConfig, mode: 'solo' }
// card.id ในของจริงเป็นคอลัมน์ UUID (supabase/migrations/0001_init.sql) และ
// QuizReplies.duoMatchNotifyCardId บังคับ z.string().uuid() — ใช้ id ที่เป็น UUID
// จริงในเทสต์นี้ ไม่ใช้ 'card-1'/'card-2' เฉยๆ เพราะจะทำให้ validation ในฟอร์ม
// (ที่ปิดปุ่มบันทึกเมื่อ schema ไม่ผ่าน) ล้มเหลวเมื่อเลือกการ์ดนั้น
const cards = [
  { id: '11111111-1111-4111-8111-111111111111', code: 'notify_card' },
  { id: '22222222-2222-4222-8222-222222222222', code: 'other_card' },
]

describe('RepliesForm', () => {
  it('shows a message instead of a card picker when mode is not duo', () => {
    render(<RepliesForm campaignId="c1" activityId="a1" initial={soloConfig} cards={cards} canEdit />)
    expect(screen.queryByLabelText(/การ์ดแจ้งเตือน/)).toBeNull()
    expect(screen.getByText(/ยังไม่ใช่โหมด duo/)).toBeDefined()
  })

  it('shows the card picker with every campaign card as an option when mode is duo', () => {
    render(<RepliesForm campaignId="c1" activityId="a1" initial={duoConfig} cards={cards} canEdit />)
    const select = screen.getByLabelText(/การ์ดแจ้งเตือน/) as HTMLSelectElement
    expect(select).toBeDefined()
    const optionLabels = Array.from(select.options).map((o) => o.textContent)
    expect(optionLabels).toContain('notify_card')
    expect(optionLabels).toContain('other_card')
  })

  it('preselects the currently configured card', () => {
    const initial: QuizConfig = { ...duoConfig, replies: { duoMatchNotifyCardId: '22222222-2222-4222-8222-222222222222' } }
    render(<RepliesForm campaignId="c1" activityId="a1" initial={initial} cards={cards} canEdit />)
    const select = screen.getByLabelText(/การ์ดแจ้งเตือน/) as HTMLSelectElement
    expect(select.value).toBe('22222222-2222-4222-8222-222222222222')
  })

  it('submitting saves the whole QuizConfig with only the replies field changed', async () => {
    render(<RepliesForm campaignId="c1" activityId="a1" initial={duoConfig} cards={cards} canEdit />)
    const select = screen.getByLabelText(/การ์ดแจ้งเตือน/) as HTMLSelectElement
    fireEvent.change(select, { target: { value: '11111111-1111-4111-8111-111111111111' } })
    fireEvent.click(screen.getByText('บันทึก Replies'))

    await waitFor(() => expect(saveQuizConfigAction).toHaveBeenCalledTimes(1))
    const [savedCampaignId, savedActivityId, formData] = saveQuizConfigAction.mock.calls[0]
    expect(savedCampaignId).toBe('c1')
    expect(savedActivityId).toBe('a1')
    const saved = JSON.parse(String(formData.get('config')))
    expect(saved.replies.duoMatchNotifyCardId).toBe('11111111-1111-4111-8111-111111111111')
    expect(saved.mode).toBe('duo') // rest of the config carried through unchanged
    expect(saved.axes).toEqual(duoConfig.axes)
  })
})
