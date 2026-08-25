// lib/db/quizNotify.test.ts
import { describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import { sendDuoMatchNotify } from './quizNotify'
import type { QuizConfig } from '../quiz/schema'

const loadCardsMock = vi.fn()
const readChannelSecretMock = vi.fn()
const pushMessageMock = vi.fn()
const renderCardMock = vi.fn()

vi.mock('./queries', () => ({ loadCards: (...args: unknown[]) => loadCardsMock(...args) }))
vi.mock('./tokens', () => ({ readChannelSecret: (...args: unknown[]) => readChannelSecretMock(...args) }))
vi.mock('../line/client', () => ({ pushMessage: (...args: unknown[]) => pushMessageMock(...args) }))
vi.mock('../render/card', () => ({ renderCard: (...args: unknown[]) => renderCardMock(...args) }))

const baseCfg: QuizConfig = {
  mode: 'duo',
  axes: [{ id: 'ei', label: 'E/I', poles: ['E', 'I'] }],
  questions: [{ id: 'q1', text: 'q1', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] }],
  results: [{ code: 'E', title: 't', body: 'b' }],
  fallbackResultCode: 'E',
}

const theme = { primary: '#000', secondary: '#fff', text: '#111' }

/**
 * ตัว sql ปลอมที่เรียกแบบ tagged template ได้จริง (postgres.Sql ใช้แบบ sql`...`) —
 * ต้อง callable ไม่ใช่แค่ object เฉยๆ เพราะเทสต์ที่สาม (pushMessage reject) เดินโค้ด
 * ไปถึงจุดที่ query หา line_uid ของ participant จริงก่อนจะเรียก pushMessage — สอง
 * เทสต์แรก (no card / card not found) ไม่มีวันไปถึงจุดนั้นเลยเพราะ return ก่อน แต่
 * ใช้ตัวเดียวกันนี้ได้ทั้งสามเทสต์เพื่อไม่ต้องแยกสองแบบ
 */
const fakeSql = (() => Promise.resolve([{ line_uid: 'U-fake' }])) as unknown as postgres.Sql

describe('sendDuoMatchNotify', () => {
  it('does nothing when no card is configured', async () => {
    await sendDuoMatchNotify(fakeSql, {
      campaignId: 'camp-1', channelId: 'chan-1', config: baseCfg, theme, inviterParticipantId: 'p-1',
    })
    expect(loadCardsMock).not.toHaveBeenCalled()
    expect(pushMessageMock).not.toHaveBeenCalled()
  })

  it('skips (does not throw) when the configured card is not found in the campaign', async () => {
    loadCardsMock.mockResolvedValueOnce({}) // empty map — card id not present
    const cfg: QuizConfig = { ...baseCfg, replies: { duoMatchNotifyCardId: 'card-missing' } }
    await expect(sendDuoMatchNotify(fakeSql, {
      campaignId: 'camp-1', channelId: 'chan-1', config: cfg, theme, inviterParticipantId: 'p-1',
    })).resolves.toBeUndefined()
    expect(pushMessageMock).not.toHaveBeenCalled()
  })

  it('swallows the error (does not throw) when pushMessage itself rejects, after actually attempting it', async () => {
    loadCardsMock.mockResolvedValueOnce({ 'card-1': { code: 'notify', renderAs: 'text', blocks: [] } })
    readChannelSecretMock.mockResolvedValueOnce('fake-token')
    renderCardMock.mockReturnValueOnce({ type: 'text', text: 'hi' })
    pushMessageMock.mockRejectedValueOnce(new Error('LINE push failed: 500'))
    const cfg: QuizConfig = { ...baseCfg, replies: { duoMatchNotifyCardId: 'card-1' } }
    await expect(sendDuoMatchNotify(fakeSql, {
      campaignId: 'camp-1', channelId: 'chan-1', config: cfg, theme, inviterParticipantId: 'p-1',
    })).resolves.toBeUndefined()
    // ยืนยันว่าจริงๆ แล้วเดินไปถึงจุด reject จริง ไม่ใช่ resolve เฉยๆ เพราะโค้ด plumbing
    // พังตั้งแต่ก่อนถึงจุดนั้นแล้ว (ถ้า mock ไม่ได้ถูกเรียกเลย เทสต์นี้ก็จะผ่านลอยๆ
    // โดยไม่ได้พิสูจน์อะไรจริง)
    expect(pushMessageMock).toHaveBeenCalledTimes(1)
    expect(pushMessageMock).toHaveBeenCalledWith('fake-token', 'U-fake', { type: 'text', text: 'hi' })
  })
})
