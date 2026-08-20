import type { Metadata } from 'next'
import { DM_Mono, DM_Sans, Noto_Sans_Thai } from 'next/font/google'
import './globals.css'

// next/font ดาวน์โหลดไฟล์มาเสิร์ฟจากโดเมนเราเอง ไม่มี request ออกไป CDN
// ตอนผู้ใช้เปิดหน้า — หน้าจอจึงยังใช้ได้ตอนเน็ตลูกค้าบล็อก Google
const sans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-dm-sans',
  display: 'swap',
})
const thai = Noto_Sans_Thai({
  subsets: ['thai'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-noto-thai',
  display: 'swap',
})
const mono = DM_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-dm-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Flex System Builder',
  description: 'เครื่องมือภายในสำหรับสร้างแคมเปญบน LINE',
}

// ภูมิภาคของ Vercel Function ตั้งไว้ที่ vercel.json ("regions": ["sin1"]) ที่ root
// ของ repo แล้ว ไม่ใช่ตรงนี้ — เดิมเคยลองตั้ง `export const preferredRegion = 'sin1'`
// ที่นี่ แต่ log จริงของ /api/line/webhook ยังขึ้น "Routed to iad1" ทุกครั้งไม่มีเว้น
// (ตรวจซ้ำหลาย deploy วันที่ 2026-08-17) ทวนกับเอกสาร Next.js แล้วพบว่า preferredRegion
// เป็น route segment config ที่ deprecated ไปแล้ว และต่อให้ยังใช้ได้ Vercel ก็รับแค่
// 'auto' | 'global' | 'home' เท่านั้นสำหรับ Node.js runtime — ค่าที่เป็น region code ตรงๆ
// อย่าง 'sin1' ถูกเมินเงียบๆ ไม่ error ไม่เตือน จึงย้ายมาตั้งที่ vercel.json ซึ่งเป็นทางที่
// Vercel เอกสารรองรับจริง (Project Settings → Functions หรือ vercel.json ก็ได้ แต่แบบหลัง
// ผูกไว้ใน repo ไม่ต้องพึ่งใครไปตั้งในแดชบอร์ดแล้วลืม) — เหตุผลเดิมยังใช้ได้ทั้งหมด:
// Supabase ของโปรเจกต์นี้อยู่ ap-southeast-1 (สิงคโปร์) และผู้เล่นจริงอยู่เอเชียทั้งหมด
// sin1 คือภูมิภาคของ Vercel ที่ใกล้ทั้งสองอย่างที่สุด ตั้งระดับ project จึงมีผลกับทุก
// route ในแอป ไม่ใช่แค่ webhook จุดเดียว (ทุกจอแอดมินก็อ่าน/เขียน DB เดียวกันนี้เหมือนกัน)

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${sans.variable} ${thai.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
