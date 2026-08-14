import { cloneElement } from 'react'
import type { AriaAttributes, CSSProperties, ReactElement, ReactNode } from 'react'
import { STATUS_TONES } from './tokens'

/** ช่องกรอกอะไรก็ได้ที่รับ id · style · และ aria สองตัวนี้ได้ — input · select · textarea */
type ControlProps = {
  id?: string
  style?: CSSProperties
  'aria-invalid'?: AriaAttributes['aria-invalid']
  'aria-describedby'?: string
}

type FieldProps = {
  label: string
  hint?: ReactNode
  error?: ReactNode
  /** ใส่เองเมื่อมีสองช่องที่ป้ายเหมือนกันในหน้าเดียว */
  id?: string
  children: ReactElement<ControlProps>
}

const labelStyle: CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
}

const controlStyle: CSSProperties = {
  width: '100%',
  border: '1px solid var(--rule)',
  borderRadius: 'var(--r)',
  padding: '9px 12px',
  fontSize: 13,
  background: 'var(--panel)',
  color: 'var(--ink)',
  boxSizing: 'border-box',
}

const noteStyle: CSSProperties = { fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }

/**
 * id ที่คิดจากตัวป้าย ให้ <label for> กับช่องกรอกตรงกันโดยไม่ต้องใช้ useId
 *
 * useId would drag every form field across the client boundary just to obtain a
 * number. Hashing the label keeps the field a Server Component and keeps the id
 * stable between server and client render. Two fields sharing a label in one
 * page would share an id, which is what the `id` prop is for.
 */
function idFromLabel(label: string): string {
  let hash = 2166136261
  for (let i = 0; i < label.length; i += 1) {
    hash ^= label.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `f${(hash >>> 0).toString(36)}`
}

/**
 * ป้าย · ช่องกรอก · คำอธิบาย · ข้อความผิดพลาด ที่ผูกกันเรียบร้อยแล้ว
 *
 * The error is announced with aria-invalid and pointed at with
 * aria-describedby, not only painted red. Colour on its own is not a message:
 * it says nothing to a screen reader and nothing to the eight percent of men
 * who cannot separate this red from this grey.
 */
export function Field({ label, hint, error, id, children }: FieldProps) {
  const controlId = id ?? idFromLabel(label)
  const hintId = `${controlId}-hint`
  const errorId = `${controlId}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ')

  const control = cloneElement(children, {
    id: controlId,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
    style: {
      ...controlStyle,
      ...(error ? { border: '1px solid var(--danger)' } : null),
      ...children.props.style,
    },
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label htmlFor={controlId} style={labelStyle}>{label}</label>
      {control}
      {hint ? <span id={hintId} style={noteStyle}>{hint}</span> : null}
      {error ? <span id={errorId} style={{ ...noteStyle, color: STATUS_TONES.danger.fg }}>{error}</span> : null}
    </div>
  )
}
