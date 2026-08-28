import { ZipArchive } from 'archiver'
import type { Readable } from 'node:stream'

export interface AssembledFile {
  path: string
  content: Buffer
}

/**
 * ประกอบรายการไฟล์ในหน่วยความจำ (ผลจาก assembleTemplateFiles) ให้เป็น zip stream เดียว —
 * ไม่เขียนลงดิสก์ระหว่างทาง เพราะ route ที่เรียกใช้ (export/route.ts, Task 14) จะ pipe stream
 * นี้ตรงเข้า response body เลย
 *
 * หมายเหตุ: `archiver` v8 เลิก export ฟังก์ชัน `archiver('zip')` แบบเดิม (v5-v7) แล้ว เปลี่ยนมา
 * export คลาส `ZipArchive`/`TarArchive`/`JsonArchive` ตรงๆ แทน — @types/archiver ที่ติดตั้งมา
 * (v8) ตรงกับ API นี้ จึง `new ZipArchive()` ให้ผลเทียบเท่า `archiver('zip')` เดิมทุกประการ
 */
export function zipFiles(files: AssembledFile[]): Readable {
  const archive = new ZipArchive()

  for (const file of files) {
    archive.append(file.content, { name: file.path })
  }

  // finalize() ปิดสัญญาณว่าไม่มีไฟล์เพิ่มแล้ว — archiver ต้องมีสัญญาณนี้ก่อนจะ flush
  // ไฟล์สุดท้าย/central directory ออกมาให้ครบ ไม่งั้น stream จะค้างไม่จบ
  //
  // ต้อง .catch() promise ที่คืนมาเสมอ — archiver reject มันเมื่อเกิด error ภายใน
  // (zlib/module error) ถ้าไม่มีใคร catch เลยจะเป็น unhandled promise rejection ที่ทำให้
  // process ทั้งตัวล่มได้ (Finding 1 ของรีวิว) error เดียวกันนี้ archiver เองก็ re-emit เป็น
  // 'error' event บน `archive` (Readable ที่ฟังก์ชันนี้คืนกลับไป) อยู่แล้วผ่าน
  // _onModuleError — นั่นคือช่องทางที่ผู้เรียกใช้จริง (zipToBuffer ด้านล่าง) ฟังแทน จึง
  // แค่กัน unhandled rejection เงียบๆ ตรงนี้พอ ไม่ต้อง handle ซ้ำอีกที
  archive.finalize().catch(() => {})

  return archive
}

/**
 * ประกอบไฟล์เป็น zip buffer เดียวเต็มก้อน (รอจนกว่า archive จะ finalize เสร็จจริง) แทนที่จะ
 * คืน stream ให้ผู้เรียกไปจัดการเอง — export/route.ts (Task 14) ใช้ตัวนี้แทน zipFiles() ตรงๆ
 * เพื่อให้ await/catch ความล้มเหลวระหว่างสร้าง zip ได้จริงก่อนตัดสินใจ status code ของ
 * response (กัน response 200 ที่ตัดจบเป็น zip เสียครึ่งๆ กลางๆ เงียบๆ เมื่อ finalize()
 * ล้มเหลวกลางทาง — Finding 1) ไฟล์ export ของเทมเพลตนี้ไม่ได้ใหญ่พอที่การ buffer เต็มก้อน
 * ก่อนตอบกลับจะเป็นปัญหาจริง (ยังไม่มีการเขียนลงดิสก์ระหว่างทางเหมือนเดิม)
 */
export function zipToBuffer(files: AssembledFile[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = zipFiles(files)
    const chunks: Buffer[] = []
    let settled = false

    archive.on('data', (chunk: Buffer) => chunks.push(chunk))
    archive.on('error', (err: Error) => {
      if (settled) return
      settled = true
      reject(err)
    })
    archive.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks))
    })
  })
}
