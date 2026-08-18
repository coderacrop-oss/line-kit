'use client'

import type { ButtonHTMLAttributes, CSSProperties } from 'react'
import { useFormStatus } from 'react-dom'
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
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
}

const VARIANTS: Record<ButtonVariant, CSSProperties> = {
  primary: { background: 'var(--ink)', color: 'var(--panel)', border: '1px solid var(--ink)' },
  ghost: { background: 'var(--panel)', color: 'var(--ink)', border: '1px solid var(--rule)' },
  // ตัวอักษรใช้ fg ของ danger ไม่ใช่ --danger เพราะ --danger เป็นสีเดียวกับ --accent
  // และอ่านบนพื้นขาวได้ไม่ดีพอสำหรับข้อความ · เส้นขอบยังใช้สีเต็มเพื่อให้สะดุดตา
  danger: { background: 'var(--panel)', color: STATUS_TONES.danger.fg, border: `1px solid ${STATUS_TONES.danger.border}` },
}

/** หมุนตลอดกาลด้วย CSS animation ที่ประกาศไว้ใน globals.css — ไม่ต้องมี JS ขับ */
function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="ui-spin"
      style={{
        width: 12, height: 12, borderRadius: '50%',
        border: '2px solid currentColor', borderTopColor: 'transparent',
        display: 'inline-block', flexShrink: 0,
      }}
    />
  )
}

/**
 * ปุ่มเดียวของทั้งระบบ · สามแบบ ไม่มีแบบที่สี่
 *
 * type defaults to "button" rather than the browser's "submit". Every write on
 * these screens goes through a Server Action inside a form, so a stray button
 * that defaults to submitting is a silent write nobody asked for; a button that
 * means to submit says so.
 *
 * `useFormStatus` reads the pending state of the nearest enclosing `<form>`.
 * Outside one it is always false, so this is safe on every button in the app,
 * not only the ones inside a form — a plain `disabled` render never becomes
 * `disabled: true` on its own. Only a submit button reacts, because a cancel
 * button sitting next to it did not ask the form to do anything.
 */
export function Button({ variant = 'primary', disabled, style, type = 'button', children, ...rest }: ButtonProps) {
  const { pending } = useFormStatus()
  const isPending = type === 'submit' && pending

  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || isPending}
      aria-busy={isPending || undefined}
      style={{
        ...base,
        ...VARIANTS[variant],
        ...((disabled || isPending) ? { opacity: 0.5, cursor: 'not-allowed' } : null),
        ...style,
      }}
    >
      {isPending && <Spinner />}
      {children}
    </button>
  )
}
