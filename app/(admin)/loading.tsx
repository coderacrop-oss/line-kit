/**
 * เห็นทันทีที่กดลิงก์ ก่อนที่ Server Component ปลายทางจะอ่านฐานข้อมูลเสร็จ
 *
 * Next.js วาดไฟล์นี้แทนเนื้อหาของจอ โดยที่โครงรอบนอก (แถบบน · แถบซ้าย)
 * ยังอยู่เหมือนเดิม เพราะไฟล์นี้อยู่ในขอบเขตของ layout ไม่ใช่แทนที่ layout —
 * สิ่งที่คนกดเห็นหายไปมีแค่เนื้อหาที่ยังโหลดไม่เสร็จ ไม่ใช่ทั้งจอกระพริบ
 */
export default function AdminLoading() {
  return (
    <div
      role="status"
      aria-label="กำลังโหลด"
      style={{ padding: 'var(--page-y) var(--page-x)', display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      {[220, 420, 280, 340].map((width, index) => (
        <div
          key={index}
          className="ui-skeleton"
          style={{
            width, height: index === 0 ? 28 : 16,
            borderRadius: 'var(--r)', background: 'var(--panel-2)',
          }}
        />
      ))}
    </div>
  )
}
