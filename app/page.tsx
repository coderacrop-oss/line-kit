import Link from 'next/link'

export default function Home() {
  return (
    <main style={{ padding: 'var(--page-y) var(--page-x)', maxWidth: 640, margin: '0 auto' }}>
      <div className="screen-code" style={{ marginBottom: 6 }}>Flex System Builder</div>
      <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-.025em', margin: 0 }}>
        ระบบกำลังทำงาน
      </h1>
      <p style={{ color: 'var(--ink-3)', fontSize: 13, marginTop: 8 }}>
        เครื่องมือภายในสำหรับสร้างแคมเปญบน LINE · หน้าจอหลังบ้านอยู่ระหว่างพัฒนา
      </p>
      <p style={{ marginTop: 20 }}>
        <Link
          href="/campaigns"
          style={{
            display: 'inline-block', background: 'var(--ink)', color: 'var(--panel)',
            border: '1px solid var(--ink)', borderRadius: 'var(--r)',
            padding: '10px 18px', fontSize: 13, fontWeight: 600,
          }}
        >
          เข้าหน้าหลังบ้าน
        </Link>
      </p>
    </main>
  )
}
