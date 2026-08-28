import fs from 'node:fs'
import path from 'node:path'
import { QuizConfig } from '@/lib/quiz/schema'

export interface AssembledFile {
  path: string
  content: Buffer
}

// โฟลเดอร์ที่ไม่ควรพาไปด้วยตอน export — node_modules/.next เป็นไฟล์ build artifact/dependency
// ของเครื่องที่ dev เทมเพลตนี้เอง ไม่ใช่ source, .data คือ data dir ของ fileStore (Task 9)
// ที่มีข้อมูลรันไทม์ของเครื่อง dev เอง ไม่ใช่ของแคมเปญที่กำลัง export
const SKIP_DIRS = new Set(['node_modules', '.next', '.data'])

const TEMPLATE_ROOT = path.resolve(process.cwd(), 'liff-template')

const SAMPLE_CONFIG_PATH = 'config/quiz.config.sample.json'
const REAL_CONFIG_PATH = 'config/quiz.config.json'

/**
 * เดินไฟล์ทุกไฟล์ใต้ dir แบบ recursive คืน path สัมพัทธ์จาก root (ใช้ '/' เสมอแม้รันบน
 * Windows เพื่อให้ path ที่ยัด zip entry ตรงกับโครงสร้างโปรเจกต์จริงเสมอ)
 */
function walk(dir: string, root: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const paths: string[] = []

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      paths.push(...walk(path.join(dir, entry.name), root))
      continue
    }
    if (entry.isFile()) {
      const relative = path.relative(root, path.join(dir, entry.name)).split(path.sep).join('/')
      paths.push(relative)
    }
  }

  return paths
}

/**
 * ตรวจว่า config พร้อม export หรือไม่ — เช็คเฉพาะส่วน templateCopy (ฟิลด์อื่นของ QuizConfig
 * ควรผ่าน validation มาแล้วตอนบันทึกกิจกรรม ผ่าน saveQuizConfigAction) คืนรายการ path ของ
 * ฟิลด์ที่ขาด/ผิด (dot-joined, เช่น "templateCopy.messages.soloShare") ว่างแปลว่าผ่าน
 */
function findMissingTemplateCopyFields(config: QuizConfig): string[] {
  if (!config.templateCopy) {
    return ['templateCopy']
  }

  const result = QuizConfig.safeParse(config)
  if (result.success) return []

  return result.error.issues
    .filter((issue) => issue.path[0] === 'templateCopy')
    .map((issue) => issue.path.join('.'))
}

/**
 * ประกอบไฟล์ทั้งหมดของ liff-template/ (อ่านจากดิสก์ตรงๆ) พร้อมสวมค่า config ของแคมเปญที่
 * กำลัง export เข้าไปแทนที่ config/quiz.config.sample.json — ผลลัพธ์คือรายการไฟล์ในหน่วยความจำ
 * พร้อมส่งให้ zipFiles() (Task 13, lib/liffExport/zip.ts) ประกอบเป็น zip stream ต่อ
 *
 * หมายเหตุ: ไม่ได้ตั้งชื่อ package.json's "name" ตาม slug ของแคมเปญ (ปล่อยเป็น
 * "liff-quiz-template" เดิมจาก liff-template/package.json) — เป็น nice-to-have เชิงкосметик
 * ตามที่ระบุใน plan (design doc §9 ข้อ 5) ไม่ใช่สาระสำคัญของสไลซ์นี้ และ signature ของฟังก์ชัน
 * นี้ตั้งใจรับแค่ config ตาม plan เท่านั้น ไม่รับชื่อแคมเปญเพิ่ม
 */
export function assembleTemplateFiles(config: QuizConfig): AssembledFile[] {
  const missingFields = findMissingTemplateCopyFields(config)
  if (missingFields.length > 0) {
    throw new Error(`Cannot export: templateCopy is missing required fields: ${missingFields.join(', ')}`)
  }

  const relativePaths = walk(TEMPLATE_ROOT, TEMPLATE_ROOT)

  const files: AssembledFile[] = []
  for (const relativePath of relativePaths) {
    if (relativePath === SAMPLE_CONFIG_PATH) {
      // แทนที่ sample config ด้วย config จริงของแคมเปญ ที่ path ใหม่ (ไม่ใช่ .sample.json) —
      // โปรเจกต์ที่ export ออกไปจะเห็นแค่ config จริง ไม่มี sample หลงเหลืออยู่
      continue
    }
    const content = fs.readFileSync(path.join(TEMPLATE_ROOT, relativePath))
    files.push({ path: relativePath, content })
  }

  const stampedConfig = { schemaVersion: 1, quiz: config }
  files.push({
    path: REAL_CONFIG_PATH,
    content: Buffer.from(JSON.stringify(stampedConfig, null, 2), 'utf8'),
  })

  return files
}
