'use client'

import { useState, type CSSProperties, type ReactNode } from 'react'
import { Note } from '@/components/ui'
import type { ChatBubble, ChatCard, ChatPart, PreviewReply } from '@/lib/preview/chat'
import {
  STOCK_MODES, dayLabel,
  type PreviewInput, type PreviewSnapshot, type PreviewStock,
} from '@/lib/preview/sim'

/**
 * จอแชทจำลอง · ตัวที่กดแล้วเรียกกติกาจริง
 *
 * Everything the player does here goes out as one call to a Server Action and
 * comes back as whatever LINE would have received. This file draws that answer
 * and nothing else — it does not decide what a card says, what a button means
 * or whether a play was allowed, because a second opinion about any of those
 * would make the rehearsal disagree with the performance.
 *
 * The transcript lives here rather than in a table. What has to survive a
 * reload is the player's state — counters, entitlements, which days they have
 * played — and all of that is in the database already. The list of bubbles is
 * the record of one sitting, and a new sitting starting with a clean chat over
 * a player who is still on day six is the right pair.
 */

export type ChatSimProps = {
  /** ชื่อช่องที่กำลังทำงานด้วย · BR-19 บังคับให้จอบอกออกมาว่าเป็นช่องไหน */
  channelName: string
  /** ปุ่มเมนูจำลอง ถอดจากคีย์เวิร์ดของแคมเปญ */
  menu: Array<{ label: string; text: string }>
  canPlay: boolean
  snapshot: PreviewSnapshot
  play: (
    input: PreviewInput,
    sim: { dayOffset: number; stock: PreviewStock },
  ) => Promise<PreviewReply>
  reset: () => Promise<PreviewReply>
}

type Mode = 'test' | 'demo'

type Item =
  | { id: number; kind: 'said'; text: string }
  | { id: number; kind: 'system'; text: string }
  | { id: number; kind: 'silent' }
  | { id: number; kind: 'error'; text: string }
  | { id: number; kind: 'reply'; bubble: ChatBubble }

const label: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.06em',
  textTransform: 'uppercase', color: 'var(--ink-3)',
}

const subLabel: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.07em',
  textTransform: 'uppercase', color: 'var(--rule-2)',
}

const box: CSSProperties = {
  border: '1px solid var(--rule)', borderRadius: 'var(--r-lg)', background: 'var(--panel)',
  padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
}

const dashedBox: CSSProperties = {
  border: '1px dashed var(--rule)', borderRadius: 'var(--r-lg)', background: 'var(--panel)',
  padding: '14px 16px', fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.7,
}

const segment = (on: boolean): CSSProperties => ({
  flex: 1, border: 0, padding: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  fontFamily: 'inherit',
  background: on ? 'var(--ink)' : 'var(--panel)',
  color: on ? 'var(--panel)' : 'var(--ink-2)',
})

const toolButton: CSSProperties = {
  background: 'var(--ink)', color: 'var(--panel)', border: '1px solid var(--ink)',
  borderRadius: 'var(--r)', padding: 10, fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
}

const quietButton: CSSProperties = {
  background: 'var(--panel)', color: 'var(--ink)', border: '1px solid var(--rule)',
  borderRadius: 'var(--r)', padding: 9, fontSize: 12, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
}

const bubbleBase: CSSProperties = {
  background: 'var(--panel)', padding: '9px 14px', fontSize: 13, maxWidth: '78%',
  borderRadius: '16px 16px 16px 4px', lineHeight: 1.55,
}

const stateRow: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12,
}

function Section({ head, children }: { head: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={subLabel}>{head}</span>
      {children}
    </div>
  )
}

function CardPart({ part }: { part: ChatPart }) {
  if (part.kind === 'title') {
    return <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35 }}>{part.text}</div>
  }
  if (part.kind === 'text') {
    return <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.55 }}>{part.text}</div>
  }
  if (part.kind === 'image') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={part.url}
        alt="ภาพบนการ์ด"
        style={{ width: '100%', borderRadius: 'var(--r-sm)', display: 'block' }}
      />
    )
  }
  if (part.kind === 'progress') {
    return (
      <div
        role="progressbar"
        aria-valuenow={part.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ height: 6, background: 'var(--panel-2)', borderRadius: 'var(--r-pill)' }}
      >
        <div style={{
          height: 6, width: `${part.percent}%`,
          background: 'var(--ink)', borderRadius: 'var(--r-pill)',
        }} />
      </div>
    )
  }
  if (part.kind === 'divider') {
    return <div style={{ height: 1, background: 'var(--panel-2)' }} />
  }
  if (part.kind === 'space') return <div style={{ height: 12 }} />
  if (part.kind === 'empty') {
    return (
      <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
        (ไม่มีบล็อกไหนแสดงกับสถานะนี้)
      </div>
    )
  }
  return (
    <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
      (จอจำลองยังวาดบล็อกชนิด {part.name} ไม่ได้ — ของจริงบน LINE ยังส่งไปตามปกติ)
    </div>
  )
}

function CardView({ card, onTap }: { card: ChatCard; onTap: (data: string) => void }) {
  return (
    <div style={{
      background: 'var(--panel)', borderRadius: 'var(--r-lg)', overflow: 'hidden',
      width: 250, border: '1px solid var(--rule)',
    }}>
      {card.hero ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.hero} alt="ภาพหัวการ์ด" style={{ width: '100%', display: 'block' }} />
      ) : null}
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {card.parts.map((part, at) => <CardPart key={at} part={part} />)}
      </div>
      {card.buttons.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {card.buttons.map((button, at) => (
            <button
              key={at}
              type="button"
              // ปุ่มลิงก์ของ LINE เปิดเบราว์เซอร์ ไม่ได้ส่งอะไรกลับเข้ากติกา
              // กดแล้วยิง postback ให้จะสอนคนตั้งค่าผิดว่ามันนับเป็นการเล่น
              onClick={() => { if (button.postback) onTap(button.postback) }}
              style={{
                textAlign: 'center', padding: 9, fontSize: 13, fontWeight: 600,
                color: button.postback ? 'var(--info)' : 'var(--ink-3)',
                borderWidth: '1px 0 0', borderStyle: 'solid', borderColor: 'var(--panel-2)',
                background: 'var(--panel)', cursor: button.postback ? 'pointer' : 'default',
                fontFamily: 'inherit',
              }}
            >
              {button.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function ChatSim({ channelName, menu, canPlay, snapshot, play, reset }: ChatSimProps) {
  const [mode, setMode] = useState<Mode>('test')
  const [items, setItems] = useState<Item[]>([])
  const [state, setState] = useState<PreviewSnapshot>(snapshot)
  const [dayOffset, setDayOffset] = useState(0)
  const [stock, setStock] = useState<PreviewStock>('as_configured')
  const [draft, setDraft] = useState('')
  const [askingReset, setAskingReset] = useState(false)
  const [busy, setBusy] = useState(false)

  const isTest = mode === 'test' && canPlay
  const nextId = () => Date.now() + Math.random()
  const append = (item: Item) => setItems((current) => [...current, item])

  async function run(input: PreviewInput) {
    if (!canPlay || busy) return
    setBusy(true)
    if (input.kind === 'text') append({ id: nextId(), kind: 'said', text: input.text })

    try {
      const reply = await play(input, { dayOffset, stock })
      setState(reply.snapshot)
      append(reply.bubble
        ? { id: nextId(), kind: 'reply', bubble: reply.bubble }
        : { id: nextId(), kind: 'silent' })
    } catch (error) {
      // ข้อความของ action คือสิ่งเดียวที่บอกได้ว่าทำไมถึงเล่นไม่ได้ · กลืนทิ้ง
      // แล้วจอจะเงียบเหมือนกดไม่ติด ซึ่งเป็นอาการเดียวกับกติกาที่ไม่ตอบ
      append({
        id: nextId(), kind: 'error',
        text: error instanceof Error ? error.message : 'ทดลองเล่นไม่สำเร็จ',
      })
    } finally {
      setBusy(false)
    }
  }

  function skipDay() {
    const next = dayOffset + 1
    setDayOffset(next)
    append({ id: nextId(), kind: 'system', text: `⏭ ข้ามเที่ยงคืน → ${dayLabel(next)} ของแคมเปญ` })
  }

  async function doReset() {
    setAskingReset(false)
    const reply = await reset()
    setState(reply.snapshot)
    setItems([])
    setDayOffset(0)
    setStock('as_configured')
  }

  const stockNote = STOCK_MODES.find((m) => m.value === stock)?.note ?? ''

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 24, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={box}>
          <span style={label}>โหมด · Mode</span>
          <div style={{
            display: 'flex', border: '1px solid var(--rule)',
            borderRadius: 'var(--r)', overflow: 'hidden',
          }}>
            <button
              type="button"
              onClick={() => setMode('test')}
              style={{ ...segment(mode === 'test'), borderRight: '1px solid var(--rule)' }}
            >
              ตรวจงาน
            </button>
            <button type="button" onClick={() => setMode('demo')} style={segment(mode === 'demo')}>
              สาธิตลูกค้า
            </button>
          </div>
          {mode === 'demo' ? (
            <div style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }}>
              โหมดสาธิตซ่อนปุ่มข้ามวัน / เริ่มใหม่ และคำเตือนภายใน — เหมาะเปิดให้ลูกค้าดู
            </div>
          ) : null}
        </div>

        <div style={box}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span style={label}>สถานะผู้เล่นจำลอง</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{dayLabel(dayOffset)}</span>
          </div>

          <Section head="ข้อมูลผู้ร่วมสนุก">
            {state.attributes.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>ยังไม่มีค่าประจำตัว</span>
            ) : state.attributes.map((attribute) => (
              <div key={attribute.key} data-state-row style={stateRow}>
                <span style={{ color: 'var(--ink-3)', fontFamily: 'var(--mono)', fontSize: 11 }}>
                  {attribute.key}
                </span>
                <span>{attribute.value}</span>
              </div>
            ))}
          </Section>

          <Section head="ค่าสะสม">
            {state.counters.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>แคมเปญนี้ไม่มีค่าสะสม</span>
            ) : state.counters.map((counter) => (
              <div key={counter.code} data-state-row style={stateRow}>
                <span style={{ color: 'var(--ink-3)' }}>{counter.name}</span>
                <span style={{ fontFamily: 'var(--mono)', fontWeight: 500 }}>
                  {counter.value} / {counter.target}
                </span>
              </div>
            ))}
          </Section>

          <Section head="สิทธิ์รางวัล">
            {state.entitlements.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>ยังไม่ได้รับสิทธิ์ใด</span>
            ) : state.entitlements.map((entitlement) => (
              <div key={entitlement.code} data-state-row style={stateRow}>
                <span style={{ fontFamily: 'var(--mono)' }}>{entitlement.code}</span>
                <span style={{ color: 'var(--ink-3)' }}>
                  {entitlement.status === 'redeemed' ? 'ใช้แล้ว' : 'ถืออยู่'}
                </span>
              </div>
            ))}
          </Section>
        </div>

        {isTest ? (
          <div style={box}>
            <button type="button" onClick={skipDay} style={toolButton}>
              ⏭ ข้ามวัน → {dayLabel(dayOffset + 1)}
            </button>

            <Section head="สถานะที่เกิดยาก (BR-83)">
              <div style={{
                display: 'flex', border: '1px solid var(--rule)',
                borderRadius: 'var(--r)', overflow: 'hidden',
              }}>
                {STOCK_MODES.map((option, at) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setStock(option.value)}
                    style={{
                      ...segment(stock === option.value),
                      ...(at === 0 ? { borderRight: '1px solid var(--rule)' } : null),
                      fontSize: 11,
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <span style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }}>
                {stockNote}
              </span>
            </Section>

            {askingReset ? (
              <Note tone="danger" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <span>เริ่มใหม่จะลบผู้เล่นจำลองทั้งหมด — งานทดสอบที่ทำมาในรอบนี้จะหายไป ยืนยันไหม</span>
                <span style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={doReset}
                    style={{ ...quietButton, flex: 1, color: 'inherit', borderColor: 'currentColor' }}
                  >
                    ยืนยันเริ่มใหม่
                  </button>
                  <button
                    type="button"
                    onClick={() => setAskingReset(false)}
                    style={{ ...quietButton, flex: 1 }}
                  >
                    ยกเลิก
                  </button>
                </span>
              </Note>
            ) : null}

            <button type="button" onClick={() => setAskingReset(true)} style={quietButton}>
              ↺ เริ่มใหม่ทั้งหมด
            </button>

            <span style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }}>
              ข้ามวัน = จำลองข้ามเที่ยงคืนเวลาไทย (BR-04) เพื่อทดสอบเงื่อนไข &quot;เล่นได้อีกครั้ง&quot;
              · ข้ามโดยไม่เล่นคือการจำลองวันที่ผู้เล่นขาดไป
            </span>
          </div>
        ) : null}

        {!canPlay ? (
          <div style={dashedBox}>
            สิทธิ์ผู้ดูรายงาน — ดูได้อย่างเดียว กดเล่น ข้ามวัน และเริ่มใหม่ไม่ได้
          </div>
        ) : null}

        <div style={dashedBox}>
          <b style={{ color: 'var(--ink)' }}>ข้อจำกัดของหน้าทดลองเล่น</b>
          <br />
          จำลองเมนูหลักจริงบน LINE ไม่ได้ · เปิดหน้า LIFF ไม่ได้ ·
          ความเร็วการตอบกลับจริงต่างจากนี้ — ตรวจสามอย่างนี้บนบัญชีทดสอบก่อนขึ้นจริง
        </div>
      </div>

      <div style={{
        border: '1px solid var(--rule)', borderRadius: 18, background: 'var(--panel)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column', height: 640,
      }}>
        <div style={{
          padding: '9px 16px', display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--panel-2)', borderBottom: '1px solid var(--rule)',
        }}>
          <span style={{ ...label, fontWeight: 500 }}>ทดลองเล่น · ไม่แตะข้อมูลจริง (BR-19)</span>
          <span style={{
            marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-2)',
          }}>
            {channelName}
          </span>
        </div>

        <div style={{
          flex: 1, overflowY: 'auto', background: 'var(--chat-ground)', padding: 16,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          {items.map((item) => {
            if (item.kind === 'said') {
              return (
                <div key={item.id} data-chat-item style={{
                  ...bubbleBase, alignSelf: 'flex-end', background: 'var(--chat-mine)',
                  borderRadius: '16px 16px 4px 16px', maxWidth: '70%',
                }}>
                  {item.text}
                </div>
              )
            }
            if (item.kind === 'system') {
              return (
                <div key={item.id} data-chat-item style={{
                  alignSelf: 'center', fontFamily: 'var(--mono)', fontSize: 10,
                  color: 'var(--ink-2)', background: 'var(--panel)',
                  borderRadius: 'var(--r-pill)', padding: '4px 14px',
                }}>
                  {item.text}
                </div>
              )
            }
            if (item.kind === 'silent') {
              return (
                <div key={item.id} data-chat-item style={{ alignSelf: 'center', maxWidth: 320 }}>
                  {mode === 'demo' ? (
                    <span style={{
                      fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-2)',
                      background: 'var(--panel)', borderRadius: 'var(--r-pill)', padding: '4px 14px',
                    }}>
                      (ไม่มีการตอบกลับ)
                    </span>
                  ) : (
                    <Note tone="danger">
                      (ไม่มีการตอบกลับ) — ผู้เล่นจริงจะเห็นความเงียบตรงนี้ ไปดูกิจกรรมกับคีย์เวิร์ดที่รับคำนี้
                    </Note>
                  )}
                </div>
              )
            }
            if (item.kind === 'error') {
              return (
                <div key={item.id} data-chat-item style={{ alignSelf: 'center', maxWidth: 320 }}>
                  <Note tone="warn">{item.text}</Note>
                </div>
              )
            }

            const bubble = item.bubble
            if (bubble.kind === 'text') {
              return (
                <div key={item.id} data-chat-item style={{ ...bubbleBase, alignSelf: 'flex-start' }}>
                  {bubble.text}
                </div>
              )
            }
            return (
              <div key={item.id} data-chat-item style={{
                alignSelf: 'flex-start', display: 'flex', gap: 8, maxWidth: '100%',
                overflowX: 'auto',
              }}>
                {(bubble.kind === 'carousel' ? bubble.cards : [bubble.card]).map((card, at) => (
                  <CardView
                    key={at}
                    card={card}
                    onTap={(data) => { void run({ kind: 'postback', data }) }}
                  />
                ))}
              </div>
            )
          })}
        </div>

        {canPlay ? (
          <div style={{
            borderTop: '1px solid var(--rule)', background: 'var(--panel)',
            padding: '10px 12px', display: 'flex', gap: 8,
          }}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="พิมพ์ข้อความตอบ…"
              style={{
                flex: 1, border: '1px solid var(--rule)', borderRadius: 'var(--r-pill)',
                padding: '9px 15px', fontSize: 13, background: 'var(--panel)',
                color: 'var(--ink)', outline: 'none',
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const text = draft.trim()
                if (text === '') return
                setDraft('')
                void run({ kind: 'text', text })
              }}
              style={{
                ...toolButton, borderRadius: 'var(--r-pill)', padding: '9px 18px',
                ...(busy ? { opacity: 0.5, cursor: 'not-allowed' } : null),
              }}
            >
              ส่ง
            </button>
          </div>
        ) : null}

        <div style={{
          borderTop: '1px solid var(--rule)', background: 'var(--ground)', padding: '10px 12px',
        }}>
          <div style={{ ...subLabel, color: 'var(--ink-3)', marginBottom: 7 }}>
            เมนูหลัก (จำลอง Rich Menu)
          </div>
          {menu.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }}>
              แคมเปญนี้ยังไม่มีคีย์เวิร์ด — ปุ่มในเมนูจำลองถอดมาจากคีย์เวิร์ด เพราะยังไม่มีจอตั้งค่าริชเมนู
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
              {menu.map((entry) => (
                <button
                  key={entry.label}
                  type="button"
                  disabled={!canPlay || busy}
                  onClick={() => { void run({ kind: 'text', text: entry.text }) }}
                  style={{
                    ...quietButton, padding: '10px 8px',
                    ...(!canPlay || busy ? { opacity: 0.5, cursor: 'not-allowed' } : null),
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
