/**
 * ผลของ Server Action ที่ต้องให้ฝั่ง client อ่านข้อความ error จริงได้เสมอ แม้ใน
 * โปรดักชัน — Next.js เซ็นเซอร์ข้อความของ error ที่ throw ออกจาก Server Action ทิ้ง
 * ในโปรดักชันเสมอ (พิสูจน์จริงกับ `next build && next start` แล้ว ไม่ใช่แค่ทฤษฎี —
 * ทั้งเรียกผ่าน `<form action={fn}>` และเรียกตรงๆ แบบ `await action()` จากฝั่ง
 * client ก็ยังโดนเซ็นเซอร์เหมือนกันหมด ต่างจากที่เข้าใจกันตอนแรกว่า "แค่ให้ client
 * เป็นคน catch เอง" จะพอ) ทางเดียวที่ข้อความจริงไปถึงฝั่ง client แน่ๆ คือไม่ throw
 * แต่ return ค่านี้แทน เพราะเป็นแค่ข้อมูลธรรมดาที่ส่งกลับไปในผลลัพธ์ ไม่ใช่ exception
 * ที่ผ่าน pipeline เซ็นเซอร์ของ Next.js เลย
 *
 * ใช้ร่วมกันได้กับ Server Action ไหนก็ได้ที่ทุก error ที่โยนเป็นข้อความที่ตั้งใจให้คน
 * อ่านอยู่แล้ว (ไม่ใช่ stack trace ดิบ) — เดิมอยู่ใต้ lib/richmenu/ เพราะเป็นที่แรกที่
 * ต้องใช้ (createMenu/saveMenu ของ app/(admin)/campaigns/[id]/richmenu/actions.ts,
 * ดู comment เต็มในไฟล์นั้น) แต่ตัวมันเองไม่มีอะไรเฉพาะ Rich Menu เลย จึงย้ายมาไว้ที่
 * เป็นกลางตอนที่ตัวที่สาม (saveChannel ของ app/(admin)/channels/actions.ts) ต้องใช้
 * ด้วย — ใช้ซ้ำกับ publish() ของ app/(admin)/campaigns/[id]/publish/actions.ts ไม่ได้
 * ตรงๆ เพราะที่นั่นผลสำเร็จต้องพ่วง versionNo ไปด้วย จึงมี PublishResult ของตัวเอง
 */
export type ActionResult = { ok: true } | { ok: false; message: string }
