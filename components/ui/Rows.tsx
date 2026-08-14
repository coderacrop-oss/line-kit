import type { ReactNode } from 'react'
import { Panel } from './Panel'

type RowsProps<T> = {
  items: readonly T[]
  renderRow: (item: T, index: number) => ReactNode
  /** จำนวนแถวโครงร่างที่จะแสดงระหว่างรอข้อมูล · 0 คือไม่ได้กำลังโหลด */
  loading?: number
  /** สิ่งที่แสดงเมื่อไม่มีข้อมูล — ปกติคือ <Empty> */
  empty?: ReactNode
}

const bar = (width: string, height: number) => ({
  width, height, background: 'var(--panel-2)', borderRadius: 4,
})

/**
 * แผงที่ตัดสินใจเองว่าตอนนี้ควรเป็นโครงร่าง กล่องว่าง หรือรายการจริง
 *
 * The three states are decided in one place because they are exclusive and
 * getting that wrong is what produces the flash of "ยังไม่มีแคมเปญ" a moment
 * before the rows arrive — a screen telling the truth about the wrong instant.
 *
 * With no data and no `empty` it renders nothing at all rather than an empty
 * white panel, which looks like a screen that failed rather than one with
 * nothing to say.
 */
export function Rows<T>({ items, renderRow, loading = 0, empty }: RowsProps<T>) {
  if (loading > 0) {
    return (
      <Panel aria-busy="true">
        {Array.from({ length: loading }, (_, index) => (
          <Panel.Row key={index} data-skeleton="" aria-hidden="true">
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--panel-2)', flexShrink: 0 }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={bar('38%', 11)} />
                <div style={bar('24%', 9)} />
              </div>
              <div style={{ width: 96, height: 20, background: 'var(--panel-2)', borderRadius: 'var(--r-pill)' }} />
            </div>
          </Panel.Row>
        ))}
      </Panel>
    )
  }

  if (items.length === 0) return <>{empty}</>

  return (
    <Panel>
      {items.map((item, index) => <Panel.Row key={index}>{renderRow(item, index)}</Panel.Row>)}
    </Panel>
  )
}
