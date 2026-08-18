import type { CSSProperties, HTMLAttributes } from 'react'

type PanelProps = HTMLAttributes<HTMLDivElement>

const panelStyle: CSSProperties = {
  border: '1px solid var(--rule)',
  borderRadius: 'var(--r-lg)',
  background: 'var(--panel)',
  // แถวแรกและแถวสุดท้ายมีพื้นของตัวเอง ถ้าไม่ตัดจะทับมุมโค้งของแผง
  overflow: 'hidden',
}

const rowStyle: CSSProperties = { padding: '18px 20px' }

/**
 * กล่องขาวขอบเดียวที่ของทุกอย่างอยู่ข้างใน
 *
 * The divider between rows lives in globals.css as `.panel-row`, not inline,
 * because the last row must not draw one — an inline border cannot ask whether
 * it is last, and a doubled line against the panel's own edge is the tell.
 */
export function Panel({ children, style, ...rest }: PanelProps) {
  return <div {...rest} style={{ ...panelStyle, ...style }}>{children}</div>
}

function PanelRow({ children, style, className, ...rest }: PanelProps) {
  return (
    <div {...rest} className={className ? `panel-row ${className}` : 'panel-row'} style={{ ...rowStyle, ...style }}>
      {children}
    </div>
  )
}

Panel.Row = PanelRow
