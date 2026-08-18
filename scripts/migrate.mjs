#!/usr/bin/env node
/**
 * Applies every migration under supabase/migrations/ that this database
 * has not seen yet, tracked by filename in a table of its own.
 *
 * Wired into `build` (see package.json) so it runs on every Vercel deploy —
 * a fresh Supabase project, or a redeploy nobody remembered to migrate by
 * hand, gets its schema the moment the build runs. The alternative is a
 * blank database serving requests and failing them one query at a time,
 * each one a 500 with no message on it until someone thinks to check.
 *
 * Every file already applied is skipped, so re-running costs nothing on a
 * database that is already current — that is what makes it safe to run on
 * every build rather than only the first one.
 */
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '..', 'supabase', 'migrations')

const url = process.env.DATABASE_URL
if (!url) {
  console.log('[migrate] DATABASE_URL ยังไม่ตั้ง — ข้ามการรัน migration (ปกติตอน build ในเครื่องที่ยังไม่ได้ตั้งค่า)')
  process.exit(0)
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} })

try {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`

  const appliedRows = await sql`SELECT filename FROM _migrations`
  const applied = new Set(appliedRows.map((row) => row.filename))
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()

  let ranAny = false
  for (const file of files) {
    if (applied.has(file)) continue
    console.log(`[migrate] รัน ${file}`)
    await sql.file(join(migrationsDir, file))
    await sql`INSERT INTO _migrations (filename) VALUES (${file})`
    ranAny = true
  }

  console.log(ranAny ? '[migrate] เสร็จแล้ว' : '[migrate] ไม่มีไฟล์ใหม่ — schema ตรงอยู่แล้ว')
} finally {
  await sql.end({ timeout: 5 })
}
