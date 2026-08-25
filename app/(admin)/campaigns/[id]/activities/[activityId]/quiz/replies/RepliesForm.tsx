'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button, ErrorModal, Field, Note, Panel } from '@/components/ui'
import { QuizConfig } from '@/lib/quiz/schema'
import { saveQuizConfigAction } from '../actions'

export type RepliesFormProps = {
  campaignId: string
  activityId: string
  initial: QuizConfig
  cards: { id: string; code: string }[]
  canEdit: boolean
}

/**
 * แก้ replies.duoMatchNotifyCardId ของควิซ — จอแยกจาก QuizConfigForm (Task 11)
 *
 * ยิง saveQuizConfigAction() ตัวเดียวกับจอตั้งควิซหลัก ด้วย QuizConfig ทั้งก้อน (แค่
 * เปลี่ยน field เดียว) ไม่ใช่ action ใหม่เฉพาะ replies — schema/validation/การเขียน
 * DB เป็นเรื่องเดียวกันกับควิซทั้งชุดอยู่แล้ว แยก action จะเป็นการสร้างทางเขียน
 * input_config สองทางที่ต้องคอยให้ตรงกันโดยไม่มีเหตุผล
 */
export function RepliesForm({ campaignId, activityId, initial, cards, canEdit }: RepliesFormProps) {
  const router = useRouter()
  const [draft, setDraft] = useState<QuizConfig>(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [savedTick, setSavedTick] = useState(0)

  const validation = QuizConfig.safeParse(draft)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    setBusy(true)
    const formData = new FormData()
    formData.set('config', JSON.stringify(draft))
    try {
      const result = await saveQuizConfigAction(campaignId, activityId, formData)
      if (result.ok) {
        setSavedTick((n) => n + 1)
        router.refresh()
        setBusy(false)
      } else {
        setError(result.message)
        setBusy(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ — ลองใหม่')
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <form onSubmit={(event) => void handleSubmit(event)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <fieldset disabled={!canEdit || busy} style={{ border: 0, margin: 0, padding: 0, display: 'contents' }}>
          <Panel style={{ padding: 18 }}>
            {draft.mode !== 'duo' ? (
              <Note tone="info">ควิซนี้ยังไม่ใช่โหมด duo — ยังไม่มีจุดแจ้งเตือนให้ตั้งค่า</Note>
            ) : (
              <Field
                id="duo-match-notify-card"
                label="การ์ดแจ้งเตือนตอนจับคู่สำเร็จ"
                hint="ส่งให้ผู้ชวน (A) ทันทีที่อีกฝ่าย (B) ตอบครบ — เว้นว่างไว้ = ไม่ส่งอะไร"
              >
                <select
                  value={draft.replies?.duoMatchNotifyCardId ?? ''}
                  disabled={!canEdit}
                  onChange={(e) => setDraft((d) => ({
                    ...d,
                    replies: { ...d.replies, duoMatchNotifyCardId: e.target.value || undefined },
                  }))}
                >
                  <option value="">— ไม่ใช้การ์ด (ไม่ส่งอะไร) —</option>
                  {cards.map((card) => (
                    <option key={card.id} value={card.id}>{card.code}</option>
                  ))}
                </select>
              </Field>
            )}
          </Panel>

          {validation.success ? (
            <Note tone="ok">กรอกครบและถูกต้องตาม schema แล้ว — บันทึกได้</Note>
          ) : (
            <Note tone="warn">
              <div style={{ fontWeight: 600, marginBottom: 6 }}>ยังบันทึกไม่ได้ — มีข้อผิดพลาดดังนี้</div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {validation.error.issues.map((issue, i) => (
                  <li key={i}>{issue.path.join('.') || '(ทั้งก้อน)'}: {issue.message}</li>
                ))}
              </ul>
            </Note>
          )}

          {canEdit && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
              {savedTick > 0 && !busy && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>บันทึกล่าสุดแล้ว</span>}
              <Button type="submit" disabled={!validation.success}>บันทึก Replies</Button>
            </div>
          )}
          {busy && <p aria-live="polite">กำลังบันทึก…</p>}
        </fieldset>
      </form>

      <ErrorModal message={error} onClose={() => setError(null)} />
    </div>
  )
}
