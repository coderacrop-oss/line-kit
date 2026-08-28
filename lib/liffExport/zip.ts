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
  void archive.finalize()

  return archive
}
