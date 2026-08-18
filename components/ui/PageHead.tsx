import type { ReactNode } from 'react'

type PageHeadProps = {
  /** รหัสจอตามเอกสาร เช่น `M1-S01 · Campaigns` */
  code: string
  title: string
  actions?: ReactNode
}

/**
 * หัวของทุกหน้า · รหัสจอ แล้วหัวข้อ แล้วปุ่มของหน้าชิดขวา
 *
 * The screen code sits in its own element rather than inside the heading. It is
 * there so a person and a document can agree on which screen they are talking
 * about, and folding it into the heading would make every screen announce
 * itself to a screen reader as "M1-S01 · Campaigns แคมเปญ".
 */
export function PageHead({ code, title, actions }: PageHeadProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
      gap: 16, flexWrap: 'wrap', marginBottom: 22,
    }}>
      <div>
        <div className="screen-code" style={{ marginBottom: 6 }}>{code}</div>
        <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-.025em', margin: 0 }}>
          {title}
        </h1>
      </div>
      {actions ? <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{actions}</div> : null}
    </div>
  )
}
