import fs from 'node:fs/promises'
import path from 'node:path'
import { QuizConfig } from '@/lib/quiz/schema'
import { TEMPLATE_SCHEMA_VERSION } from '@/liff-template/lib/schema'

export interface AssembledFile {
  path: string
  content: Buffer
}

// โฟลเดอร์ที่ไม่ควรพาไปด้วยตอน export — node_modules/.next เป็นไฟล์ build artifact/dependency
// ของเครื่องที่ dev เทมเพลตนี้เอง ไม่ใช่ source, .data คือ data dir ของ fileStore (Task 9)
// ที่มีข้อมูลรันไทม์ของเครื่อง dev เอง ไม่ใช่ของแคมเปญที่กำลัง export (.next/.data ก็ถูกกันซ้ำ
// โดยกฎ dotfile ด้านล่างอยู่แล้วเพราะขึ้นต้นด้วย '.' แต่ยังคง set นี้ไว้เพื่อความชัดเจน/กัน
// node_modules ซึ่งไม่ใช่ dotfile)
const SKIP_DIRS = new Set(['node_modules', '.next', '.data'])

const TEMPLATE_ROOT = path.resolve(process.cwd(), 'liff-template')

const SAMPLE_CONFIG_PATH = 'config/quiz.config.sample.json'
const REAL_CONFIG_PATH = 'config/quiz.config.json'

/**
 * เดินไฟล์ทุกไฟล์ใต้ dir แบบ recursive คืน path สัมพัทธ์จาก root (ใช้ '/' เสมอแม้รันบน
 * Windows เพื่อให้ path ที่ยัด zip entry ตรงกับโครงสร้างโปรเจกต์จริงเสมอ)
 *
 * ข้ามทุก entry (ไฟล์และโฟลเดอร์) ที่ชื่อขึ้นต้นด้วย '.' เสมอ — dotfile เช่น .env.local
 * (ตาม liff-template/.gitignore เก็บ LINE_CHANNEL_SECRET/ACCESS_TOKEN จริงของเครื่องที่ dev
 * เทมเพลตนี้เอง) ต้องไม่หลุดติด zip export ไปแม้จะมีอยู่จริงบนเครื่องที่รัน export ก็ตาม
 * (Finding 2 ของรีวิว) ใช้ fs.promises แทน sync API เพื่อไม่บล็อก event loop ระหว่าง
 * export request หนึ่งๆ (Finding 10)
 */
async function walk(dir: string, root: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const paths: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      paths.push(...(await walk(path.join(dir, entry.name), root)))
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

// liff-template/ เป็นไฟล์ static ล้วนที่ไม่เปลี่ยนระหว่างที่ process นี้รันอยู่ (ไม่มีใครแก้ไฟล์
// บนดิสก์ระหว่างรับ export request) — cache ผลเดินไฟล์+อ่านเนื้อหาไว้ในหน่วยความจำหลังอ่านครั้ง
// แรก ไม่ต้องเดินดิสก์ใหม่ทุก export request (Finding 10) แคชเก็บเฉพาะไฟล์ static (ไม่รวม
// sample config ที่จะถูกดร็อปอยู่แล้ว และไม่รวม config จริงของแคมเปญที่ต่างกันทุกครั้ง)
let cachedStaticFiles: AssembledFile[] | null = null

/** ทดสอบเท่านั้น — เคลียร์แคชเพื่อบังคับให้เดินดิสก์ใหม่ในเทสต์ที่ต้องการสถานะเริ่มต้นสะอาด */
export function __resetStaticFileCacheForTests(): void {
  cachedStaticFiles = null
}

async function loadStaticFiles(): Promise<AssembledFile[]> {
  if (cachedStaticFiles) return cachedStaticFiles

  const relativePaths = await walk(TEMPLATE_ROOT, TEMPLATE_ROOT)

  const files: AssembledFile[] = []
  for (const relativePath of relativePaths) {
    if (relativePath === SAMPLE_CONFIG_PATH) {
      // แทนที่ sample config ด้วย config จริงของแคมเปญ ที่ path ใหม่ (ไม่ใช่ .sample.json) —
      // โปรเจกต์ที่ export ออกไปจะเห็นแค่ config จริง ไม่มี sample หลงเหลืออยู่
      continue
    }
    const content = await fs.readFile(path.join(TEMPLATE_ROOT, relativePath))
    files.push({ path: relativePath, content })
  }

  cachedStaticFiles = files
  return cachedStaticFiles
}

/**
 * ประกอบไฟล์ทั้งหมดของ liff-template/ (อ่านจากดิสก์ตรงๆ ครั้งแรก แล้ว cache ไว้ใช้ซ้ำ) พร้อม
 * สวมค่า config ของแคมเปญที่กำลัง export เข้าไปแทนที่ config/quiz.config.sample.json —
 * ผลลัพธ์คือรายการไฟล์ในหน่วยความจำพร้อมส่งให้ zipFiles() (Task 13, lib/liffExport/zip.ts)
 * ประกอบเป็น zip stream ต่อ
 *
 * หมายเหตุ: ไม่ได้ตั้งชื่อ package.json's "name" ตาม slug ของแคมเปญ (ปล่อยเป็น
 * "liff-quiz-template" เดิมจาก liff-template/package.json) — เป็น nice-to-have เชิงкосметик
 * ตามที่ระบุใน plan (design doc §9 ข้อ 5) ไม่ใช่สาระสำคัญของสไลซ์นี้ และ signature ของฟังก์ชัน
 * นี้ตั้งใจรับแค่ config ตาม plan เท่านั้น ไม่รับชื่อแคมเปญเพิ่ม
 */
export async function assembleTemplateFiles(config: QuizConfig): Promise<AssembledFile[]> {
  const missingFields = findMissingTemplateCopyFields(config)
  if (missingFields.length > 0) {
    throw new Error(`Cannot export: templateCopy is missing required fields: ${missingFields.join(', ')}`)
  }

  const staticFiles = await loadStaticFiles()
  const files: AssembledFile[] = [...staticFiles]

  const stampedConfig = { schemaVersion: TEMPLATE_SCHEMA_VERSION, quiz: config }
  files.push({
    path: REAL_CONFIG_PATH,
    content: Buffer.from(JSON.stringify(stampedConfig, null, 2), 'utf8'),
  })

  return files
}
