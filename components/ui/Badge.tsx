import type { CSSProperties, ReactNode } from 'react'
import { STATUS_TONES, type StatusTone } from './tokens'

export type BadgeTone = StatusTone | 'mute'

type BadgeProps = { tone?: BadgeTone; children: ReactNode; title?: string }

const base: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: 'var(--mono)',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  borderRadius: 'var(--r-pill)',
  padding: '3px 9px',
  whiteSpace: 'nowrap',
}

// เส้นประบอกว่า "นี่ไม่ใช่สถานะของข้อมูล" — ใช้กับป้ายอย่าง "ดูอย่างเดียว"
// ที่พูดถึงสิทธิ์ของคนดู ไม่ใช่สภาพของสิ่งที่ดูอยู่ · แยกออกได้แม้พิมพ์ขาวดำ
const MUTE: CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  borderWidth: 1,
  borderStyle: 'dashed',
  borderColor: 'var(--rule)',
}

/**
 * ป้ายสถานะกลม · สีมาจาก STATUS_TONES เสมอ ไม่มีจอไหนคิดสีของตัวเอง
 */
export function Badge({ tone = 'mute', children, title }: BadgeProps) {
  const skin = tone === 'mute'
    ? MUTE
    : {
        background: STATUS_TONES[tone].bg,
        color: STATUS_TONES[tone].fg,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: STATUS_TONES[tone].border,
      }

  return <span title={title} style={{ ...base, ...skin }}>{children}</span>
}
