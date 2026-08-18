import postgres from 'postgres'

/**
 * อะไรก็ได้ที่ยิงคำสั่งได้ · ตัวพูลเอง หรือธุรกรรมที่เปิดออกมาจากมัน
 *
 * postgres.js hands a transaction back as its own type, which is the pool's
 * type minus begin() and end(). Widening the query helpers to accept either is
 * what lets the preview screen run the webhook's own Ports inside a transaction
 * instead of owning a second copy of them.
 */
export type Queryable = postgres.Sql | postgres.TransactionSql

/**
 * The one connection to the database.
 *
 * Kept behind a lazy singleton because a Next.js route handler may be invoked
 * many times per process, and opening a pool per invocation exhausts the server
 * long before traffic does.
 */
let pool: postgres.Sql | null = null

export function db(): postgres.Sql {
  if (!pool) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('Missing environment variable: DATABASE_URL')
    pool = postgres(url, { max: 10, prepare: false, onnotice: () => {} })
  }
  return pool
}

/** Tests open their own pool so they can close it deterministically. */
export function testDb(url: string): postgres.Sql {
  return postgres(url, { max: 20, prepare: false, onnotice: () => {} })
}
