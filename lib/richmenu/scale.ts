/**
 * คณิตศาสตร์เดียวที่ทั้งฝั่งเซิร์ฟเวอร์ (fit.ts · ใช้ @napi-rs/canvas) และฝั่งเบราว์เซอร์
 * (crop.ts · ใช้ Canvas API ของเบราว์เซอร์เอง) ต้องคำนวณเหมือนกันเป๊ะ — คนละไฟล์
 * เพราะ fit.ts import แพ็กเกจ native (@napi-rs/canvas) ซึ่งมี .node binary ที่รันบน
 * เบราว์เซอร์ไม่ได้เลย ถ้า coverScale อยู่ใน fit.ts ไฟล์เดียวกัน แล้ว crop.ts (ซึ่งถูก
 * import จาก CropModal.tsx ซึ่งเป็น client component) import มันมา จะดึง native binary
 * นั้นเข้าไปในบันเดิลฝั่งเบราว์เซอร์ด้วย แล้ว `next build` จะพังทันที (เจอมาแล้วจริง) —
 * แยกฟังก์ชันบริสุทธิ์นี้ออกมาไว้ที่นี่ ไม่มี import อื่นเลย ทั้งสองฝั่งจึง import ได้
 * โดยไม่ลากอะไรที่รันไม่ได้ติดมาด้วย
 */

/** สเกลที่ต้องขยาย/ย่อภาพต้นฉบับเพื่อให้ด้านที่สั้นกว่าครอบผืนเป้าหมายพอดี (เหมือน CSS object-fit: cover) */
export function coverScale(
  source: { width: number; height: number }, target: { width: number; height: number },
): number {
  return Math.max(target.width / source.width, target.height / source.height)
}
