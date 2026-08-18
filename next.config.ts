import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // @napi-rs/canvas ships a native .node binary (lib/richmenu/fit.ts ใช้ตัด/ย่อ
  // ภาพเมนู) — webpack แกะไฟล์ .node ไม่ได้ ต้อง require() ตรงตอนรันจริงแทนการ
  // bundle เข้าไปในโค้ดที่ build ไว้
  serverExternalPackages: ['@napi-rs/canvas'],
}

export default nextConfig
