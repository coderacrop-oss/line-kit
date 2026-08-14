#!/usr/bin/env node
/**
 * Compares the live schema against FLEX_AD_L2 §5.2.
 *
 * Transcribing 37 tables out of a 300KB HTML document by hand is the easiest
 * thing in this project to get quietly wrong, and a missing column only shows
 * up much later as a query that returns undefined. This runs in CI, not once:
 * the document keeps moving, and the day the schema and the document disagree
 * is the day the document starts lying.
 *
 *   node scripts/check-schema-vs-doc.mjs [path-to-L2.html]
 */
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

const DOC = process.argv[2] ?? `${process.env.HOME}/Downloads/FLEX_AD_L2_v0.31.html`
const URL = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'

/** Columns the document lists but describes as moved or removed. */
const strikeThrough = /<s>|<del>/

function parseDoc(html) {
  const tables = new Map()
  const blocks = html.matchAll(
    /<h4>TABLE: (\w+)<\/h4>([\s\S]*?)(?=<h4>|<h3>|<div class="page-break")/g,
  )

  for (const [, name, body] of blocks) {
    const columns = new Set()
    for (const [, row] of body.matchAll(/<tr>(<td>[\s\S]*?)<\/tr>/g)) {
      const cells = row.split(/<\/td>\s*<td[^>]*>/)
      if (cells.length < 3) continue

      const rawName = cells[0].replace(/<td>/, '')
      if (strikeThrough.test(rawName)) continue

      const type = cells[1].replace(/<[^>]+>/g, '').trim()
      // A row whose type is an em dash documents a column that moved away.
      if (type === '—' || type === '') continue

      for (const part of rawName.replace(/<[^>]+>/g, '').split('·')) {
        const column = part.trim()
        if (/^[a-z][a-z0-9_]*$/.test(column)) columns.add(column)
      }
    }
    if (columns.size > 0) tables.set(name, columns)
  }
  return tables
}

async function readLiveSchema(sql) {
  const rows = await sql`
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'`

  const tables = new Map()
  for (const { table_name, column_name } of rows) {
    if (!tables.has(table_name)) tables.set(table_name, new Set())
    tables.get(table_name).add(column_name)
  }
  return tables
}

/** Columns the schema adds on purpose, with the reason recorded here. */
const INTENTIONAL_EXTRAS = {
  '*': ['id', 'created_at'],
  rich_menu: ['chat_bar_text'], // LINE caps this at 14 characters; enforced in SQL
  quiz_round: ['expires_at'],   // BR-85 · pending answers expire at end of day
  export_log: ['reason'],       // cannot be backfilled once files have gone out
}

const doc = parseDoc(readFileSync(DOC, 'utf8'))
const sql = postgres(URL, { prepare: false, onnotice: () => {} })
let problems = 0

try {
  const live = await readLiveSchema(sql)

  for (const [table, columns] of doc) {
    if (!live.has(table)) {
      console.error(`✗ ${table} — อยู่ในเอกสารแต่ไม่มีในฐานข้อมูล`)
      problems++
      continue
    }
    const missing = [...columns].filter((c) => !live.get(table).has(c))
    if (missing.length > 0) {
      console.error(`✗ ${table} — ขาดคอลัมน์ ${missing.join(', ')}`)
      problems++
    }
  }

  for (const [table, columns] of live) {
    if (!doc.has(table)) {
      console.error(`✗ ${table} — อยู่ในฐานข้อมูลแต่ไม่มีในเอกสาร`)
      problems++
      continue
    }
    const allowed = new Set([
      ...doc.get(table),
      ...INTENTIONAL_EXTRAS['*'],
      ...(INTENTIONAL_EXTRAS[table] ?? []),
    ])
    const extra = [...columns].filter((c) => !allowed.has(c))
    if (extra.length > 0) {
      console.error(`✗ ${table} — มีคอลัมน์เกินจากเอกสาร ${extra.join(', ')}`)
      problems++
    }
  }

  console.log(`เอกสาร ${doc.size} ตาราง · ฐานข้อมูล ${live.size} ตาราง`)
  console.log(problems === 0 ? '✅ ตรงกันทั้งหมด' : `❌ ไม่ตรง ${problems} จุด`)
} finally {
  await sql.end({ timeout: 5 })
}

process.exit(problems === 0 ? 0 : 1)
