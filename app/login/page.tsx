import { devLoginAllowed } from '@/lib/auth/devlogin'
import { devLogin } from './actions'

const wrap = {
  minHeight: '100vh', display: 'flex', alignItems: 'center',
  justifyContent: 'center', padding: 32,
} as const

const card = {
  border: '1px solid var(--rule)', background: 'var(--panel)',
  borderRadius: 'var(--r-lg)', padding: 18,
  display: 'flex', flexDirection: 'column', gap: 9,
} as const

export default function LoginPage() {
  const testEntranceOpen = devLoginAllowed({ nodeEnv: process.env.NODE_ENV })

  return (
    <main style={wrap}>
      <div style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
          <span style={{
            width: 44, height: 44, background: 'var(--ink)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ width: 15, height: 15, background: 'var(--accent)', display: 'block' }} />
          </span>
          <div>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-.02em' }}>Flex System Builder</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
              เครื่องมือภายในสำหรับสร้างแคมเปญบน LINE
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled
          style={{
            background: 'var(--panel)', color: 'var(--ink-3)', border: '1px solid var(--rule)',
            borderRadius: 'var(--r)', padding: '11px 16px', fontSize: 13, fontWeight: 600,
            cursor: 'not-allowed',
          }}
        >
          เข้าสู่ระบบด้วย Google · ยังไม่ได้ตั้งค่า
        </button>

        {testEntranceOpen && (
          <form action={devLogin} style={{ ...card, borderColor: 'var(--warn)', background: 'rgba(215,119,6,.08)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#5A3A00' }}>ทางเข้าสำหรับทดสอบ</div>
            <div style={{ fontSize: 12, color: '#5A3A00', lineHeight: 1.65 }}>
              เปิดอยู่เพราะ <span className="code">ALLOW_DEV_LOGIN=1</span> ·
              ข้ามแค่ Google <b>ไม่ข้ามรายชื่อที่อนุญาต</b> —
              อีเมลยังต้องอยู่ในทีมและยังต้องเปิดใช้งานอยู่
              <br />
              <b>ถ้าเห็นกล่องนี้บนของจริง แปลว่ามีอะไรผิด</b>
            </div>
            <input
              name="email"
              type="email"
              required
              placeholder="อีเมลที่อยู่ในรายชื่อ"
              aria-label="อีเมลสำหรับทางเข้าทดสอบ"
              style={{
                border: '1px solid var(--rule)', borderRadius: 'var(--r)',
                padding: '9px 12px', fontSize: 13, background: 'var(--panel)',
              }}
            />
            <button
              type="submit"
              style={{
                background: 'var(--ink)', color: 'var(--panel)', border: '1px solid var(--ink)',
                borderRadius: 'var(--r)', padding: '9px 16px', fontSize: 13, fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              เข้าระบบ
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
