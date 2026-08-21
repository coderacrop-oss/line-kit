/**
 * LIFF อยู่คนละโดเมนเสมอ (เช่น dew-liff.vercel.app เรียก line-kit-bice.vercel.app)
 * เปิดกว้างไว้ก่อน — ตัวป้องกันจริงคือการตรวจตัวตนใน lib/liff/auth.ts ไม่ใช่ origin
 * (spec §8) คุมเข้มเป็นต่อ-liff_app ทีหลังได้ถ้าจำเป็นจริง
 */
export const LIFF_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  // X-Line-User-Id: เผื่อไว้ให้ทดลองเรียกจากเบราว์เซอร์ — ผู้เรียก server-to-server จริง
  // ไม่ผ่าน CORS อยู่แล้ว แต่ header นี้เป็น custom header ต้องขอ preflight เหมือนกัน
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Line-User-Id',
}

export function liffOptionsResponse(): Response {
  return new Response(null, { status: 204, headers: LIFF_CORS_HEADERS })
}
