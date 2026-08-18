import { CampaignContextBar } from '@/components/layout/CampaignContextBar'
import { loadCampaignHeader } from '@/lib/db/campaigns'
import { db } from '@/lib/db/client'
import { CampaignNav } from './CampaignNav'

/**
 * โครงของทุกจอที่อยู่ในแคมเปญ · แถบชื่อแคมเปญ แถบซ้าย แล้วเนื้อหา
 *
 * ต้นแบบวางแถบซ้ายไว้ทุกจอที่ `inCamp` และมันคือทางเดินเดียวที่จอเหล่านั้นมี —
 * จอที่เปิดจากรายการแคมเปญแล้วไม่มีแถบนี้ ออกไปไหนไม่ได้นอกจากกดปุ่ม back ของ
 * เบราว์เซอร์ · ต้นแบบยังต่อชื่อแคมเปญกับป้ายบัญชีที่ส่งขึ้นแล้วไว้ในแถบเดียวกัน
 * เพื่อไม่ให้หลงว่ากำลังตั้งค่าแคมเปญไหนอยู่ตอนสลับไปมาหลายจอ
 *
 * campaign ที่ไม่มีอยู่จริงปล่อยให้จอลูกแต่ละจอเป็นคนเรียก notFound() เอง — ที่นี่
 * แค่ไม่วาดแถบชื่อถ้าหาไม่เจอ ไม่ใช่ที่ตัดสินว่าจอไหนควร 404
 *
 * 56px + 32px ที่ลบออกคือความสูงของแถบบนใน app/(admin)/layout.tsx บวกแถบนี้
 */
export default async function CampaignLayout({ children, params }: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const header = await loadCampaignHeader(db(), id)

  return (
    <div>
      {header && <CampaignContextBar name={header.name} channels={header.channels} />}
      <div style={{
        display: 'flex', alignItems: 'stretch',
        minHeight: `calc(100vh - ${header ? 88 : 56}px)`,
      }}>
        <CampaignNav campaignId={id} />
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
    </div>
  )
}
