import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createFileStore = vi.fn(() => 'file-store-instance' as unknown)
const createPostgresStore = vi.fn(() => 'postgres-store-instance' as unknown)

vi.mock('./fileStore', () => ({ createFileStore }))
vi.mock('./postgresStore', () => ({ createPostgresStore }))

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL

beforeEach(() => {
  vi.resetModules()
  createFileStore.mockClear()
  createPostgresStore.mockClear()
})

afterEach(() => {
  if (ORIGINAL_DATABASE_URL === undefined) {
    delete process.env.DATABASE_URL
  } else {
    process.env.DATABASE_URL = ORIGINAL_DATABASE_URL
  }
})

describe('getStore', () => {
  it('picks the file store when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL

    const { getStore } = await import('./index')
    const store = getStore()

    expect(store).toBe('file-store-instance')
    expect(createFileStore).toHaveBeenCalledTimes(1)
    expect(createPostgresStore).not.toHaveBeenCalled()
  })

  it('picks the Postgres store when DATABASE_URL is set, passing the connection string through', async () => {
    process.env.DATABASE_URL = 'postgres://localhost:5432/example'

    const { getStore } = await import('./index')
    const store = getStore()

    expect(store).toBe('postgres-store-instance')
    expect(createPostgresStore).toHaveBeenCalledWith('postgres://localhost:5432/example')
    expect(createFileStore).not.toHaveBeenCalled()
  })

  it('caches the store instance across calls instead of re-picking every time', async () => {
    delete process.env.DATABASE_URL

    const { getStore } = await import('./index')
    const first = getStore()
    const second = getStore()

    expect(first).toBe(second)
    expect(createFileStore).toHaveBeenCalledTimes(1)
  })
})
