import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // @napi-rs/canvas ships a native .node binary (lib/richmenu/fit.ts ใช้ตัด/ย่อ
  // ภาพเมนู) — webpack แกะไฟล์ .node ไม่ได้ ต้อง require() ตรงตอนรันจริงแทนการ
  // bundle เข้าไปในโค้ดที่ build ไว้
  serverExternalPackages: ['@napi-rs/canvas'],
  // assets/fonts/NotoSansThai-Variable.ttf (lib/richmenu/compose.ts) ถูกอ่านด้วย
  // fs.readFileSync(process.cwd() + ...) ตอนรันจริง ไม่ได้ import — ตัวติดตามไฟล์
  // ของ Vercel (@vercel/nft) เดามาจาก import/require เป็นหลัก ไฟล์ที่มาจาก
  // fs.readFileSync ล้วนๆ อาจไม่ถูกรวมเข้า serverless bundle โดยอัตโนมัติ ระบุไว้
  // ตรงๆ กันไฟล์ฟอนต์หายไปตอน deploy จริงแล้วมารู้ทีหลังว่าตัวอักษรไทยหายไปเงียบๆ
  outputFileTracingIncludes: {
    '/campaigns/[id]/richmenu/[menuId]/compose': ['./assets/fonts/**'],
  },
}

export default nextConfig
