import type { CSSProperties, ReactNode } from 'react'
import { STATUS_TONES, type StatusTone } from './tokens'

type NoteProps = { tone: StatusTone; children: ReactNode; style?: CSSProperties }

/**
 * กล่องที่เขียนผลของสิ่งที่ตั้งไว้ออกมาเป็นประโยค ก่อนคนกดบันทึก
 *
 * Colours come from STATUS_TONES rather than from each screen, so severity means
 * the same thing everywhere: two boxes carrying the same warning in two shades
 * teach the reader that the shade is decoration.
 */
export function Note({ tone, children, style }: NoteProps) {
  return (
    <div style={{
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: STATUS_TONES[tone].border,
      background: STATUS_TONES[tone].bg,
      color: STATUS_TONES[tone].fg,
      borderRadius: 'var(--r)',
      padding: '11px 13px',
      fontSize: 12,
      lineHeight: 1.6,
      ...style,
    }}>
      {children}
    </div>
  )
}
