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

/** Tables that exist to run this project, not to hold what it means (scripts/migrate.mjs). */
const TOOLING_TABLES = new Set(['_migrations'])

/**
 * Tables that hold real feature data but were added after L2 stopped moving —
 * unlike TOOLING_TABLES these describe something, they just don't have a §5.2
 * entry yet. Each one names the feature it belongs to so a later doc update
 * knows what to transcribe, and this set is where drift becomes visible again
 * the moment §5.2 catches up (delete the line here, the check starts covering it).
 */
const LOCAL_TABLES = {
  // M4-S02 · ตัวจัดวางภาพหลายชั้นของ Rich Menu — เร็วกว่ารอบอัปเดตเอกสารรอบถัดไป
  rich_menu_composition: 'M4-S02 Rich Menu Compositor',
  // Rich Message/Rich Video (imagemap · imagemap_video) · บัญชีภาพต้นฉบับ + ภาพ 5
  // ขนาดที่ปั้นไว้ล่วงหน้าของการ์ดหนึ่งใบ บวกภาพตัวอย่างก่อนเล่น + พื้นที่เล่นวิดีโอ
  // ของริชวิดีโอ — พื้นที่กด (tap_areas) กับไฟล์วิดีโอ/ลิงก์หลังเล่นจบ (video_asset_id
  // · video_end_uri · video_end_label) เองอยู่ที่ `card` ซึ่งเอกสารมีอยู่แล้ว (L2 §5.2
  // v0.18/BR-47) ตารางนี้เก็บแค่ส่วนที่เอกสารยังไม่มีคอลัมน์ให้ (ดูหมายเหตุเต็มที่หัว
  // ไฟล์ supabase/migrations/0009_card_imagemap.sql และ 0011_card_imagemap_video.sql)
  card_imagemap: 'Rich Message/Rich Video (imagemap/imagemap_video) base image variants + video preview/area',
  // LIFF Platform · ลงทะเบียนแอป LIFF (liff_id, api key ที่เข้ารหัสแล้ว, LINE Login channel)
  // schema จริงอยู่ที่ docs/superpowers/specs/2026-08-21-liff-platform-design.md §4 (เอกสารรูปแบบ
  // ร้อยแก้ว ไม่ใช่ตารางแบบ §5.2 ที่ checker นี้ parse ได้)
  liff_app: 'LIFF Platform — app registration (liff_id, encrypted api key, LINE Login channel)',
  // LIFF Platform · เก็บ session/state ต่อ participant (+ external_key ที่ query ข้าม participant ได้)
  // schema จริงอยู่ที่ docs/superpowers/specs/2026-08-21-liff-platform-design.md §4
  liff_session: 'LIFF Platform — per-participant session/state storage, keyed by external_key',
  // Native Quiz Engine · คำตอบถาวรของผู้เล่นต่อคำถามหนึ่งข้อ (upsert ตอบซ้ำได้) — คนละ
  // แนวคิดกับ activity.input_config (นั่นคือ config ของแอดมิน นี่คือคำตอบของผู้เล่น)
  // schema จริงอยู่ที่ docs/superpowers/specs/2026-08-24-native-quiz-engine-design.md §3.2
  quiz_answer: 'Native Quiz Engine — per-participant per-question answers (upsert, no versioning)',
  // Native Quiz Engine · คู่ duo ที่จับคู่สำเร็จแล้ว พร้อมคะแนน/ผลลัพธ์ที่แช่แข็งไว้ตอน
  // จับคู่ (scores เก็บ {a, b, combined}) — schema จริงอยู่ที่เอกสารเดียวกับ quiz_answer §3.2
  quiz_pair: 'Native Quiz Engine — matched duo pairs with frozen scores/result_code',
  // Native Quiz Engine — Group Mode · กลุ่มที่สร้างขึ้น (ใครสร้าง) และสมาชิกแต่ละคนพร้อม
  // top_axis/axis_scores ที่แช่แข็งไว้ตอนเข้ากลุ่ม — schema จริงอยู่ที่
  // docs/superpowers/specs/2026-08-25-quiz-group-mode-design.md §3
  quiz_group: 'Native Quiz Engine Group Mode — groups players form on top of a quiz activity',
  quiz_group_member: 'Native Quiz Engine Group Mode — frozen per-member axis scores, snapshotted at join time',
}

async function readLiveSchema(sql) {
  const rows = await sql`
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'`

  const tables = new Map()
  for (const { table_name, column_name } of rows) {
    if (TOOLING_TABLES.has(table_name) || table_name in LOCAL_TABLES) continue
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
  participant: ['rich_menu_linked_at'], // BR-78 ฝั่งผู้เล่น · เคยผูกเมนูตัวเข้าให้คนนี้แล้วหรือยัง
  // destination ที่ LINE ส่งมาในทุก webhook — ใช้หาว่า event เป็นของบัญชีไหน ก่อนรู้ว่า
  // จะตรวจลายเซ็นด้วยกุญแจของใคร (multi-channel webhook)
  channel: ['line_bot_user_id'],
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
  const localNames = Object.keys(LOCAL_TABLES)
  if (localNames.length > 0) {
    console.log(`ข้ามการตรวจ ${localNames.length} ตารางที่ยังไม่มีในเอกสาร: ${localNames.map((t) => `${t} (${LOCAL_TABLES[t]})`).join(', ')}`)
  }
  console.log(problems === 0 ? '✅ ตรงกันทั้งหมด' : `❌ ไม่ตรง ${problems} จุด`)
} finally {
  await sql.end({ timeout: 5 })
}

process.exit(problems === 0 ? 0 : 1)
