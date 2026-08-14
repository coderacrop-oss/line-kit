import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { signOut } from '../login/actions'

const ROLE_LABEL: Record<string, string> = {
  configurator: 'ผู้ตั้งค่าแคมเปญ',
  content_editor: 'ผู้ดูแลเนื้อหา',
  reporter: 'ผู้ดูรายงาน',
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        borderBottom: '1px solid var(--rule)', background: 'var(--panel)',
        padding: '12px var(--page-x)', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <span style={{
          width: 22, height: 22, background: 'var(--ink)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ width: 8, height: 8, background: 'var(--accent)' }} />
        </span>
        <strong style={{ fontSize: 13 }}>Flex System Builder</strong>

        <span style={{
          marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)',
        }}>
          {session.email} · {ROLE_LABEL[session.role] ?? session.role}
        </span>
        <form action={signOut}>
          <button type="submit" style={{
            background: 'transparent', border: '1px solid var(--rule)', borderRadius: 'var(--r)',
            padding: '5px 12px', fontSize: 11, color: 'var(--ink-3)', cursor: 'pointer',
          }}>ออก</button>
        </form>
      </header>
      {children}
    </div>
  )
}
