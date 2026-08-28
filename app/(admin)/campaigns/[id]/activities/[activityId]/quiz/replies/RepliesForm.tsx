'use client'

import { useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, Button, ErrorModal, Field, Note, Panel } from '@/components/ui'
import type { BadgeTone } from '@/components/ui'
import { QuizConfig } from '@/lib/quiz/schema'
import { saveQuizConfigAction } from '../actions'

/**
 * Reply Designer ของควิซบุคลิกภาพ — accordion ของ "flow" (จุดที่ระบบส่งข้อความออกไปเอง)
 * ตาม pattern ของ `~/Desktop/Codera/KimLIFF` (อ่านเป็น reference เท่านั้น ไม่แก้โค้ดที่นั่น)
 * ดู docs/superpowers/specs/2026-08-28-quiz-config-ux-redesign-design.md §4.4
 *
 * ระบบนี้มี flow จริงอยู่จุดเดียวตอนนี้ — `replies.duoMatchNotifyCardId` (เฉพาะโหมด duo)
 * ตามที่ docs/superpowers/specs/2026-08-25-quiz-duo-reply-notify-design.md §2 เขียนไว้ตรงๆ
 * ว่า "ทำแค่จุดเดียวก่อน ไม่ใช่ console เต็มรูปแบบแบบ 6 จุดของ KimLIFF" — FlowCard จึงสร้างเป็น
 * component กลางไว้ให้ขยายได้ในอนาคต แต่ instance ตอนนี้มีแค่ตัวเดียว
 *
 * ฟิลด์เดียวที่แก้ได้จริงในจอนี้คือ "เลือกการ์ดที่จะส่ง" (ไม่มีข้อความให้พิมพ์ตรงนี้ — เนื้อหา
 * การ์ดแก้ที่จอการ์ดของมันเอง) พรีวิวด้านขวาจึงเป็นพรีวิวของการ์ดที่เลือกอยู่ (ดึงจาก CardView
 * ที่ summarizeCard()/listCardsForActivity() คำนวณไว้แล้ว — ไม่ query ใหม่ ไม่เพิ่ม field ใน
 * schema) ไม่ใช่ live-typed text เหมือนที่สเปกอ้างอิงอธิบายไว้สำหรับจอที่มีฟิลด์ข้อความจริง
 */

export type RepliesCard = {
  id: string
  code: string
  renderName?: string
  hasImage?: boolean
  previewText?: string | null
}

export type RepliesFormProps = {
  campaignId: string
  activityId: string
  initial: QuizConfig
  cards: RepliesCard[]
  canEdit: boolean
}

const noteStyle: CSSProperties = { fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }

const summaryBarStyle: CSSProperties = {
  display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12, color: 'var(--ink-2)',
  padding: '10px 16px', border: '1px solid var(--rule)', borderRadius: 'var(--r)', background: 'var(--panel)',
}

const flowHeadStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '13px 18px',
  borderBottom: '1px solid var(--rule)', flexWrap: 'wrap',
}

const numberBadgeStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22, borderRadius: '50%', background: 'var(--ink)', color: 'var(--panel)',
  fontSize: 11, fontWeight: 700, flexShrink: 0,
}

const triggerBoxStyle: CSSProperties = {
  border: '1px solid var(--rule)', borderRadius: 'var(--r)', padding: 13,
  background: 'var(--ground)', fontSize: 12, lineHeight: 1.7, color: 'var(--ink-2)',
}

/** กล่องอธิบาย trigger — ภาษาที่คนอ่านเข้าใจได้ทันทีว่าอะไรทำให้ flow นี้ยิงออกไป */
function TriggerBox({ children }: { children: ReactNode }) {
  return (
    <div style={triggerBoxStyle}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>
        Trigger
      </div>
      {children}
    </div>
  )
}

/** พรีวิวมกจำลอง — ไม่ใช่ตัว render Flex จริง (พอสำหรับดูคร่าวๆ ว่าจะส่งอะไรออกไป) */
function CardPreview({ campaignId, card }: { campaignId: string; card: RepliesCard | null }) {
  if (!card) {
    return (
      <div style={{
        border: '1px dashed var(--rule)', borderRadius: 'var(--r-lg)', padding: 20,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center',
      }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>ยังไม่ได้เลือกการ์ด</span>
        <span style={noteStyle}>ไม่ตั้งไว้ = ไม่ส่งอะไรเลยตอน trigger ทำงาน</span>
      </div>
    )
  }
  return (
    <div style={{
      border: '1px solid var(--rule)', borderRadius: 'var(--r-lg)', overflow: 'hidden', background: 'var(--panel)',
    }}>
      {card.hasImage && (
        <div style={{
          height: 84, background: 'var(--panel-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--ink-3)',
        }}>
          ภาพหัวการ์ด
        </div>
      )}
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="code" style={{ width: 'fit-content' }}>{card.code}</span>
        <span style={{ fontSize: 12, fontWeight: 600 }}>
          {card.previewText ?? '(การ์ดนี้ไม่มีข้อความคงที่ — อาจดึงจากชุดเนื้อหา)'}
        </span>
        {card.renderName && <span style={noteStyle}>{card.renderName}</span>}
        <a
          href={`/campaigns/${campaignId}/cards/${card.id}`}
          style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}
        >
          แก้ไขการ์ดนี้ →
        </a>
      </div>
    </div>
  )
}

function FlowCard({ n, title, pillLabel, pillTone, trigger, preview, children }: {
  n: number
  title: string
  pillLabel: string
  pillTone: BadgeTone
  trigger: ReactNode
  preview: ReactNode
  children: ReactNode
}) {
  return (
    <Panel>
      <div style={flowHeadStyle}>
        <span style={numberBadgeStyle}>{n}</span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        <Badge tone={pillTone}>{pillLabel}</Badge>
      </div>
      <div style={{ padding: 18, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 220px', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <TriggerBox>{trigger}</TriggerBox>
          {children}
        </div>
        <div style={{ minWidth: 0 }}>{preview}</div>
      </div>
    </Panel>
  )
}

export function RepliesForm({ campaignId, activityId, initial, cards, canEdit }: RepliesFormProps) {
  const router = useRouter()
  const [draft, setDraft] = useState<QuizConfig>(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [savedTick, setSavedTick] = useState(0)

  const validation = QuizConfig.safeParse(draft)
  const isDuo = draft.mode === 'duo'
  const selectedCardId = draft.replies?.duoMatchNotifyCardId ?? null
  const selectedCard = cards.find((c) => c.id === selectedCardId) ?? null

  // flow เดียวที่มีจริงตอนนี้ (duoMatchNotify) มีผลเฉพาะโหมด duo — solo จึงมี 0 จุด (ดู §4.4
  // ของ design note) นับเป็น push เสมอ เพราะ lib/db/quizNotify.ts ยิงผ่าน pushMessage() ของ
  // LINE จริง ไม่ใช่ reply webhook ฟรี
  const flowCount = isDuo ? 1 : 0
  const freeCount = 0
  const pushCount = isDuo ? 1 : 0

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
      <div style={summaryBarStyle}>
        <span aria-label={`จุดที่ส่งข้อความทั้งหมด ${flowCount}`}>จุดที่ส่งข้อความ: <strong>{flowCount}</strong></span>
        <span aria-label={`ฟรี ${freeCount}`}>ฟรี: <strong>{freeCount}</strong></span>
        <span aria-label={`Push ${pushCount}`}>Push: <strong>{pushCount}</strong></span>
      </div>

      <form onSubmit={(event) => void handleSubmit(event)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <fieldset disabled={!canEdit || busy} style={{ border: 0, margin: 0, padding: 0, display: 'contents' }}>
          {isDuo ? (
            <FlowCard
              n={1}
              title="แจ้งผู้ชวน (A) ตอนคู่จับกันสำเร็จ"
              pillLabel="Push · นับ quota"
              pillTone="warn"
              trigger={
                <span>
                  B (ผู้ถูกชวน) ตอบคำถามครบทุกข้อและจับคู่กับ A สำเร็จ → ระบบส่งการ์ดที่เลือกไว้
                  หา A ทันทีทางข้อความ LINE (push) — ถ้า A บล็อก OA หรือ LINE API error, B ยังได้
                  ผลการจับคู่ตามปกติ ไม่มีอะไรพังตามไปด้วย
                </span>
              }
              preview={<CardPreview campaignId={campaignId} card={selectedCard} />}
            >
              <Field
                id="duo-match-notify-card"
                label="การ์ดแจ้งเตือนตอนจับคู่สำเร็จ"
                hint="เว้นว่างไว้ = ไม่ส่งอะไร — การ์ดต้องมีปุ่มเปิด LIFF อยู่ในตัวเองอยู่แล้ว (แอดมินใส่เอง) เพราะระบบนี้ส่งการ์ดไปตามที่ตั้งไว้ตรงๆ ไม่แทรกเนื้อหาผลลัพธ์ควิซให้อัตโนมัติ"
              >
                <select
                  value={selectedCardId ?? ''}
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
            </FlowCard>
          ) : (
            <Panel style={{ padding: 18 }}>
              <Note tone="info">
                ควิซนี้ยังไม่ใช่โหมด duo — ยังไม่มีจุดแจ้งเตือนให้ตั้งค่า (จุดนี้มีผลเฉพาะโหมดคู่ ตอนที่
                B ตอบครบแล้วจับคู่กับ A สำเร็จเท่านั้น)
              </Note>
            </Panel>
          )}

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
