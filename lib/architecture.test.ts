import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// liff-template/lib/engine · liff-template/lib/render เพิ่มเข้ามาสำหรับ LIFF template
// export (docs/superpowers/specs/2026-08-28-liff-template-export-design.md §3) — โค้ดใน
// สองโฟลเดอร์นี้ถูกก็อปเข้า zip ไปรันในโปรเจกต์อื่นที่ไม่มี LineKit อยู่เลย จะพึ่ง I/O
// ของ LineKit ไม่ได้ตั้งแต่ต้น เหมือน lib/engine/lib/render/lib/match เดิมทุกประการ
const PURE_DIRS = ['lib/engine', 'lib/render', 'lib/match', 'liff-template/lib/engine', 'liff-template/lib/render']

/** Anything on this list can reach the network, the database, or the framework. */
const FORBIDDEN: Array<[string, RegExp]> = [
  ['database', /from ['"].*\/db\//],
  ['LINE client', /from ['"].*line\/client/],
  ['next', /from ['"]next\//],
  ['supabase', /from ['"]@supabase\//],
  ['postgres', /from ['"]postgres['"]/],
  ['fetch', /\bfetch\s*\(/],
  ['env', /process\.env/],
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) return []
    return [path]
  })
}

describe('the engine, the renderer and the matchers stay pure', () => {
  const files = PURE_DIRS.flatMap(sourceFiles)

  it('มีไฟล์ให้ตรวจจริง — กันเคสที่ผ่านเพราะไม่มีไฟล์เลย', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  for (const file of files) {
    it(`${file} ไม่แตะอะไรนอกตัวเอง`, () => {
      const source = readFileSync(file, 'utf8')
      const hits = FORBIDDEN.filter(([, pattern]) => pattern.test(source)).map(([name]) => name)
      expect(hits, `${file} reaches for I/O`).toEqual([])
    })
  }
})
