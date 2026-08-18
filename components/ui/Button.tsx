import type { ButtonHTMLAttributes, CSSProperties } from 'react'
import { STATUS_TONES } from './tokens'

export type ButtonVariant = 'primary' | 'ghost' | 'danger'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }

const base: CSSProperties = {
  borderRadius: 'var(--r)',
  padding: '10px 18px',
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const VARIANTS: Record<ButtonVariant, CSSProperties> = {
  primary: { background: 'var(--ink)', color: 'var(--panel)', border: '1px solid var(--ink)' },
  ghost: { background: 'var(--panel)', color: 'var(--ink)', border: '1px solid var(--rule)' },
  // ตัวอักษรใช้ fg ของ danger ไม่ใช่ --danger เพราะ --danger เป็นสีเดียวกับ --accent
  // และอ่านบนพื้นขาวได้ไม่ดีพอสำหรับข้อความ · เส้นขอบยังใช้สีเต็มเพื่อให้สะดุดตา
  danger: { background: 'var(--panel)', color: STATUS_TONES.danger.fg, border: `1px solid ${STATUS_TONES.danger.border}` },
}

/**
 * ปุ่มเดียวของทั้งระบบ · สามแบบ ไม่มีแบบที่สี่
 *
 * type defaults to "button" rather than the browser's "submit". Every write on
 * these screens goes through a Server Action inside a form, so a stray button
 * that defaults to submitting is a silent write nobody asked for; a button that
 * means to submit says so.
 */
export function Button({ variant = 'primary', disabled, style, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      style={{
        ...base,
        ...VARIANTS[variant],
        ...(disabled ? { opacity: 0.5, cursor: 'not-allowed' } : null),
        ...style,
      }}
    />
  )
}
