import { createFileStore } from './fileStore'
import { createPostgresStore } from './postgresStore'
import type { Store } from './types'

let cached: Store | null = null

/**
 * Picks the backing `Store` implementation (design doc §8/§13): Postgres when
 * `DATABASE_URL` is set, the JSON-file store otherwise. Local dev with no database
 * configured keeps working out of the box (fine for solo mode, and for quick duo/group
 * testing on one machine); set `DATABASE_URL` — e.g. pointed at a Supabase Postgres
 * project, see README — to get the multi-instance-safe store instead, with zero code
 * changes anywhere else, since every duo/group call site goes through this factory.
 *
 * Cached as a module-level singleton for the same reason `lib/db/client.ts` in the
 * LineKit app this was exported from does: a Next.js route handler can be invoked many
 * times per server process, and re-opening a connection pool (or re-reading the file
 * store's directory) on every call is wasteful.
 */
export function getStore(): Store {
  if (cached) return cached
  const url = process.env.DATABASE_URL
  cached = url ? createPostgresStore(url) : createFileStore()
  return cached
}
