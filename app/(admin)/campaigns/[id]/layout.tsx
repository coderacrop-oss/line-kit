import { CampaignNav } from './CampaignNav'

/**
 * โครงของทุกจอที่อยู่ในแคมเปญ · แถบซ้ายกับเนื้อหาอยู่ข้างกัน
 *
 * ต้นแบบวางแถบนี้ไว้ทุกจอที่ `inCamp` และมันคือทางเดินเดียวที่จอเหล่านั้นมี —
 * จอที่เปิดจากรายการแคมเปญแล้วไม่มีแถบนี้ ออกไปไหนไม่ได้นอกจากกดปุ่ม back ของ
 * เบราว์เซอร์ · 56px ที่ลบออกคือความสูงของแถบบนใน app/(admin)/layout.tsx
 */
export default async function CampaignLayout({ children, params }: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', minHeight: 'calc(100vh - 56px)' }}>
      <CampaignNav campaignId={id} />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}
