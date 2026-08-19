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

/**
 * ค่าเริ่มต้นของ Vercel คือ iad1 (Virginia, USA) — ทุกจอและ webhook ที่ /api/line
 * เลยต้องวิ่งข้ามมหาสมุทรไปหาฐานข้อมูลทุกครั้ง ทั้งที่ Supabase ของโปรเจกต์นี้อยู่
 * ap-southeast-1 (สิงคโปร์) และผู้เล่นจริงอยู่เอเชียทั้งหมด — sin1 คือภูมิภาคของ
 * Vercel ที่ใกล้สิงคโปร์ที่สุด ตั้งไว้ที่ root layout เพื่อให้มีผลกับทุก route ในแอป
 * ไม่ใช่แค่ webhook จุดเดียว (ทุกจอแอดมินก็อ่าน/เขียน DB เดียวกันนี้เหมือนกัน)
 */
export const preferredRegion = 'sin1'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${sans.variable} ${thai.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
