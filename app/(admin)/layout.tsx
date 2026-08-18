import { redirect } from 'next/navigation'
import { TopBar } from '@/components/layout/TopBar'
import { getSession } from '@/lib/auth/session'

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
      {/* 56px คือความสูงของแถบนี้ในต้นแบบ · โครงของแคมเปญลบค่านี้ออกจาก 100vh
          เพื่อให้แถบซ้ายสูงเต็มที่เหลือพอดี ไม่ใช่ล้นออกไปหนึ่งแถบ */}
      <TopBar
        email={session.email}
        roleLabel={ROLE_LABEL[session.role] ?? session.role}
        isAdmin={session.role === 'configurator'}
      />
      {children}
    </div>
  )
}
