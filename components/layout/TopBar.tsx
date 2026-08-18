import type { CSSProperties } from 'react'
import { signOut } from '@/app/login/actions'

type TopBarProps = { email: string; roleLabel: string; isAdmin: boolean }

const bar: CSSProperties = {
  position: 'sticky', top: 0, zIndex: 40,
  background: 'var(--panel)', borderBottom: '1px solid var(--rule)',
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '0 var(--page-x)', minHeight: 56,
}

const linkBtn: CSSProperties = {
  background: 'transparent', border: '1px solid var(--rule)', borderRadius: 'var(--r)',
  padding: '5px 12px', fontSize: 11, color: 'var(--ink-3)', cursor: 'pointer',
}

/**
 * แถบบนสุดที่ค้างทุกจอ — ตรงกับต้นแบบส่วน `{{ appVisible }}`
 *
 * ลิงก์ "ผู้ใช้ภายใน" เห็นเฉพาะ configurator เพราะ requireRole('configurator')
 * เป็นด่านเดียวที่ app/(admin)/users/actions.ts ยอมให้ผ่าน — ไม่มีปุ่มที่กดแล้วโดน
 * ปฏิเสธทุกครั้ง
 */
export function TopBar({ email, roleLabel, isAdmin }: TopBarProps) {
  return (
    <header style={bar}>
      <span style={{
        width: 22, height: 22, background: 'var(--ink)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ width: 8, height: 8, background: 'var(--accent)' }} />
      </span>
      <strong style={{ fontSize: 13 }}>Flex System Builder</strong>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)' }}>
          {email} · {roleLabel}
        </span>
        {isAdmin && <a href="/users" style={{ ...linkBtn, display: 'inline-block' }}>ผู้ใช้ภายใน</a>}
        <form action={signOut}>
          <button type="submit" style={linkBtn}>ออก</button>
        </form>
      </div>
    </header>
  )
}
