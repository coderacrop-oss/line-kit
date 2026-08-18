import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ข้อเดียวที่พิสูจน์ด้วยการรันไม่ได้ · การล็อกแถวรางวัลไว้ทั้งธุรกรรม
 *
 * withBorrowedStock borrows the campaign's reward stock, runs the real play,
 * and puts the stock back before committing. What makes that safe rather than a
 * lost update is the FOR UPDATE on the borrow: a real play landing in the middle
 * waits for the preview to commit and then reads the count it never changed.
 *
 * Dropping the lock breaks nothing that a test can observe on its own — it
 * needs two connections racing at one exact instant, and a test that waited on
 * wall-clock timing would be flaky against a database several suites share. So
 * this reads the source, the way lib/architecture.test.ts and the hex check do.
 * It is a guard against the lock being deleted as noise, not a proof that the
 * locking is correct; mutation testing found this hole by removing FOR UPDATE
 * and watching all thirty-two integration tests stay green.
 */
describe('ธุรกรรมที่ยืมคลังรางวัล', () => {
  const source = readFileSync('lib/db/preview.ts', 'utf8')

  it('จองแถวรางวัลของแคมเปญไว้ก่อนเริ่มเล่น', () => {
    expect(source).toMatch(/SELECT id, quota, issued_count FROM reward[\s\S]{0,200}FOR UPDATE/)
  })

  it('คืนค่าที่ยืมมาอยู่ในธุรกรรมเดียวกับที่ยืม', () => {
    // ถ้า restore หลุดออกไปนอก sql.begin การ์ดจะยังถูกเล่นในธุรกรรมที่ commit ไปแล้ว
    // และช่วงที่โควตาหายไปจะกว้างเท่าที่เน็ตเวิร์กช้า ไม่ใช่แค่ในธุรกรรม
    const begin = source.indexOf('return sql.begin(')
    const restore = source.indexOf('UPDATE reward SET quota = ${row.quota}')
    const body = source.indexOf('const out = await body(tx)')
    expect(begin).toBeGreaterThan(-1)
    expect(restore).toBeGreaterThan(body)
  })
})
