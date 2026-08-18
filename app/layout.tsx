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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${sans.variable} ${thai.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
