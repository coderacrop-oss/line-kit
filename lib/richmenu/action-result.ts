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
 * ใช้กับ createMenu/saveMenu ของ Rich Menu (app/(admin)/campaigns/[id]/richmenu/
 * actions.ts) ซึ่งทุก error ที่โยนได้ในนั้นเป็นข้อความที่ตั้งใจให้คนอ่านอยู่แล้ว
 * (ดู comment ในไฟล์นั้น) จึงแปลงเป็นค่าที่ return ได้ทั้งหมดอย่างปลอดภัย
 */
export type ActionResult = { ok: true } | { ok: false; message: string }
