'use client'

/** สีพื้นหลังของทั้งผืนภาพ — ส่วนที่ไม่มีชั้นไหนคลุมถึงจะเห็นสีนี้ */
export type BackgroundControlProps = {
  color: string
  canEdit: boolean
  onChange: (color: string) => void
}

export function BackgroundControl({ color, canEdit, onChange }: BackgroundControlProps) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span>สีพื้นหลัง</span>
      <input
        type="color" value={color} disabled={!canEdit}
        onChange={(event) => onChange(event.target.value)}
        style={{ width: 32, height: 24, padding: 0, border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)' }}
      />
      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)' }}>{color}</span>
    </label>
  )
}
