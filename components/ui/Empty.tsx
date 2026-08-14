import type { CSSProperties, ReactNode } from 'react'

type EmptyProps = { title: ReactNode; note?: ReactNode; action?: ReactNode }

/**
 * กล่องที่บอกว่ายังไม่มีอะไร และบอกว่าจะเริ่มยังไง
 *
 * เส้นประ ไม่ใช่เส้นทึบ — a solid panel with nothing inside reads as a screen
 * that failed to load. A dashed outline reads as a space waiting to be filled,
 * which is what it is.
 */
export function Empty({ title, note, action }: EmptyProps) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 12, padding: '56px 24px', textAlign: 'center',
      borderWidth: 1, borderStyle: 'dashed', borderColor: 'var(--rule)',
      borderRadius: 'var(--r-lg)', background: 'var(--panel)',
    }}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
      {note ? (
        <div style={{ fontSize: 12, color: 'var(--ink-3)', maxWidth: 420, lineHeight: 1.7 }}>{note}</div>
      ) : null}
      {action ? <div style={{ marginTop: 4 }}>{action}</div> : null}
    </div>
  )
}
