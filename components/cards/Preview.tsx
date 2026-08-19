'use client'

import { useState, type CSSProperties } from 'react'
import { Note } from '@/components/ui'
import { renderCard, type RenderableCard } from '@/lib/render/card'
import type { CardBlock } from '@/lib/render/groups'
import type { Theme } from '@/lib/render/flex'
import { toChatBubble, type ChatCard, type ChatPart } from '@/lib/preview/chat'
import type { PlayerState } from '@/lib/state'

/**
 * ตัวอย่างการ์ดของ M3-S02 (Task 14) — จุดที่ BR-91 เป็นจริงหรือไม่
 *
 * ห้ามเขียนตรรกะการจัดกลุ่มหรือแทนค่าตัวแปรใหม่ในไฟล์นี้ (Global Constraints) —
 * ไฟล์นี้เรียก `renderCard` ตัวเดียวกับที่ `lib/webhook/handle.ts` เรียกให้ผู้เล่นจริง
 * เท่านั้น (ซึ่งข้างในเรียก `groupBlocks` → `toFlexBubble`/`toPlainText` → `substitute`
 * ต่อกันเป็นทอดๆ) แล้วส่งผลลัพธ์ต่อให้ `toChatBubble` (lib/preview/chat.ts ที่ Task 16
 * เขียนไว้ให้จอทดลองเล่น) แกะออกมาเป็นรูปที่วาดได้ — ทั้งสองฟังก์ชันอ่าน "สิ่งที่ตัว
 * renderer ส่งออกไปจริง" ไม่ใช่บล็อกดิบ จึงไม่มีทางเพี้ยนจากของจริงได้เลยตราบใดที่ยัง
 * เรียกอยู่ ถ้าวันหนึ่งไฟล์นี้ต้องคำนวณอะไรเอง แปลว่า lib/render/ ยังไม่พอ
 */

const CARD_CODE_FOR_PREVIEW = 'preview'

export type PreviewProps = {
  blocks: CardBlock[]
  state: PlayerState
  theme: Theme
  renderAs: RenderableCard['renderAs']
  /** เปิด JSON ไว้ตั้งแต่เรนเดอร์ครั้งแรก · ผู้ใช้ยังกดสวิตช์ปิด/เปิดต่อเองได้ */
  showJson?: boolean
}

const box: CSSProperties = {
  border: '1px solid var(--rule)', borderRadius: 'var(--r-lg)', background: 'var(--panel)',
  padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
}

const label: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.06em',
  textTransform: 'uppercase', color: 'var(--ink-3)',
}

const bubbleShell: CSSProperties = {
  background: 'var(--panel-2)', borderRadius: 'var(--r-lg)', padding: '18px 16px',
}

const cardShell: CSSProperties = {
  background: 'var(--panel)', borderRadius: 'var(--r-lg)', overflow: 'hidden',
  maxWidth: 280, border: '1px solid var(--rule)',
}

const textBubble: CSSProperties = {
  background: 'var(--panel)', border: '1px solid var(--rule)', borderRadius: 'var(--r)',
  padding: '9px 14px', fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap',
}

const jsonBox: CSSProperties = {
  background: 'var(--ground)', border: '1px solid var(--rule)', borderRadius: 'var(--r)',
  padding: 12, fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 1.6,
  whiteSpace: 'pre-wrap', overflowX: 'auto', margin: 0,
}

const toggleRow: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-2)',
}

function PartView({ part }: { part: ChatPart }) {
  if (part.kind === 'title') {
    return <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35 }}>{part.text}</div>
  }
  if (part.kind === 'text') {
    return <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.55 }}>{part.text}</div>
  }
  if (part.kind === 'image') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={part.url} alt="ภาพบนการ์ด" style={{ width: '100%', borderRadius: 'var(--r-sm)', display: 'block' }} />
    )
  }
  if (part.kind === 'progress') {
    return (
      <div
        role="progressbar" aria-valuenow={part.percent} aria-valuemin={0} aria-valuemax={100}
        style={{ height: 8, background: 'var(--panel-2)', borderRadius: 'var(--r-pill)' }}
      >
        <div style={{
          height: 8, width: `${part.percent}%`, background: 'var(--ink)', borderRadius: 'var(--r-pill)',
        }}
        />
      </div>
    )
  }
  if (part.kind === 'divider') return <div style={{ height: 1, background: 'var(--rule)' }} />
  if (part.kind === 'space') return <div style={{ height: 12 }} />
  if (part.kind === 'empty') {
    return <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>(ไม่มีบล็อกไหนแสดงกับสถานะนี้)</div>
  }
  return (
    <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
      (ตัวอย่างยังวาดบล็อกชนิด {part.name} ไม่ได้ — ของจริงบน LINE ยังส่งไปตามปกติ)
    </div>
  )
}

function CardView({ card }: { card: ChatCard }) {
  return (
    <div style={cardShell}>
      {card.hero ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.hero} alt="ภาพหัวการ์ด" style={{ width: '100%', display: 'block' }} />
      ) : null}
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {card.parts.map((part, at) => <PartView key={at} part={part} />)}
      </div>
      {card.buttons.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {card.buttons.map((button, at) => (
            <div
              key={at}
              style={{
                textAlign: 'center', padding: 9, fontSize: 13, fontWeight: 600,
                color: 'var(--info)', borderTop: '1px solid var(--panel-2)',
              }}
            >
              {button.label}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function Preview({ blocks, state, theme, renderAs, showJson }: PreviewProps) {
  const [jsonOpen, setJsonOpen] = useState(showJson ?? false)

  // ตัวเดียวที่ไฟล์นี้เรียกเพื่อ "รู้" ว่าการ์ดหน้าตาเป็นอย่างไร — lib/render/card.ts
  const card: RenderableCard = { code: CARD_CODE_FOR_PREVIEW, renderAs, blocks }
  const message = renderCard(card, state, theme)
  const bubble = toChatBubble(message)

  const jsonText = message.type === 'text'
    ? message.text
    : JSON.stringify(message.type === 'imagemap' ? message : message.contents, null, 2)

  return (
    <div data-preview style={box}>
      <span style={label}>ตัวอย่างที่ผู้เล่นเห็น · Live preview</span>

      <div style={bubbleShell}>
        {bubble.kind === 'text' ? (
          <div data-preview-text style={textBubble}>{bubble.text}</div>
        ) : bubble.kind === 'card' ? (
          <CardView card={bubble.card} />
        ) : (
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
            {bubble.cards.map((c, at) => <CardView key={at} card={c} />)}
          </div>
        )}
      </div>

      <Note tone="warn">
        หน้านี้เป็น CSS ที่เราเขียนเลียน LINE ไม่ใช่ LINE จริง ใช้ดูโครงกับเงื่อนไข ·
        ความจริงอยู่ที่ปุ่มส่งทดสอบ
      </Note>

      <label style={toggleRow}>
        <input
          type="checkbox"
          data-preview-json-toggle
          checked={jsonOpen}
          onChange={(event) => setJsonOpen(event.target.checked)}
        />
        ดู JSON ที่ส่งเข้า LINE จริง
      </label>

      {jsonOpen && <pre data-preview-json style={jsonBox}>{jsonText}</pre>}
    </div>
  )
}
