import { readFile } from 'node:fs/promises'
import path from 'node:path'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createPostgresStore } from './postgresStore'
import type { Answer } from './types'

// Mirrors fileStore.test.ts's test shape against the same `Store` interface, run against
// a real Postgres instead of a JSON file — plus a concurrency-safety suite that fileStore
// can't be held to (its in-process promise queue only serializes calls within one Node
// process; it says nothing about two processes writing to the same file, which is exactly
// the scenario that motivated this store).
//
// Needs a real Postgres reachable at TEST_DATABASE_URL (defaults to a local
// `liff_template_test` database — see `npm run db:reset` / README).
const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/liff_template_test'

let sql: postgres.Sql

beforeAll(async () => {
  sql = postgres(url, { max: 10, prepare: false, onnotice: () => {} })
  const schema = await readFile(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf-8')
  await sql.unsafe(schema)
})

afterEach(async () => {
  await sql`TRUNCATE quiz_answers, quiz_pairs, quiz_groups, quiz_group_members RESTART IDENTITY CASCADE`
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

describe('createPostgresStore · answers', () => {
  it('saves then loads answers for a participant (round-trip)', async () => {
    const store = createPostgresStore(sql)
    const answers: Answer[] = [
      { questionId: 'q1', optionId: 'q1-opt-a' },
      { questionId: 'q2', optionId: 'q2-opt-b' },
    ]

    await store.saveAnswers('participant-1', answers)
    const loaded = await store.loadAnswers('participant-1')

    expect(loaded).toEqual(answers)
  })

  it('returns null for a participant with no saved answers', async () => {
    const store = createPostgresStore(sql)

    const loaded = await store.loadAnswers('nobody')

    expect(loaded).toBeNull()
  })

  it('a second saveAnswers for the same participant overwrites, not appends', async () => {
    const store = createPostgresStore(sql)
    await store.saveAnswers('participant-1', [{ questionId: 'q1', optionId: 'a' }])
    await store.saveAnswers('participant-1', [{ questionId: 'q1', optionId: 'b' }])

    const loaded = await store.loadAnswers('participant-1')

    expect(loaded).toEqual([{ questionId: 'q1', optionId: 'b' }])
  })
})

describe('createPostgresStore · pairs', () => {
  it('creates then reads back a pair with both participants and scores', async () => {
    const store = createPostgresStore(sql)
    const scoresA = { EI: 3, SN: -2 }
    const scoresB = { EI: -1, SN: 4 }

    const { pairId } = await store.createPair('inviter-1', 'joiner-1', scoresA, scoresB)
    const pair = await store.getPair(pairId)

    expect(pair).toEqual({
      pairId,
      inviterId: 'inviter-1',
      joinerId: 'joiner-1',
      scoresA,
      scoresB,
      createdAt: expect.any(String),
    })
  })

  it('returns null for a pair id that does not exist (valid UUID shape, no row)', async () => {
    const store = createPostgresStore(sql)

    const pair = await store.getPair('00000000-0000-0000-0000-000000000000')

    expect(pair).toBeNull()
  })

  it('returns null for a pair id that is not even UUID-shaped, instead of throwing', async () => {
    const store = createPostgresStore(sql)

    const pair = await store.getPair('no-such-pair')

    expect(pair).toBeNull()
  })
})

describe('createPostgresStore · groups', () => {
  it('creates a group, joins two more members, and reflects all members on read in join order', async () => {
    const store = createPostgresStore(sql)

    const { groupId } = await store.createGroup('creator-1', 'EI', { EI: 5 })
    await store.joinGroup(groupId, 'member-2', 'SN', { SN: 3 })
    await store.joinGroup(groupId, 'member-3', 'TF', { TF: -2 })

    const group = await store.getGroup(groupId)

    expect(group).not.toBeNull()
    expect(group?.creatorId).toBe('creator-1')
    expect(group?.members).toEqual([
      { participantId: 'creator-1', topAxis: 'EI', axisScores: { EI: 5 }, joinedAt: expect.any(String) },
      { participantId: 'member-2', topAxis: 'SN', axisScores: { SN: 3 }, joinedAt: expect.any(String) },
      { participantId: 'member-3', topAxis: 'TF', axisScores: { TF: -2 }, joinedAt: expect.any(String) },
    ])
  })

  it('returns null for a group id that does not exist (valid UUID shape, no row)', async () => {
    const store = createPostgresStore(sql)

    const group = await store.getGroup('00000000-0000-0000-0000-000000000000')

    expect(group).toBeNull()
  })

  it('returns null for a group id that is not even UUID-shaped, instead of throwing', async () => {
    const store = createPostgresStore(sql)

    const group = await store.getGroup('no-such-group')

    expect(group).toBeNull()
  })

  it('joinGroup on a nonexistent group throws, same as fileStore', async () => {
    const store = createPostgresStore(sql)

    await expect(
      store.joinGroup('00000000-0000-0000-0000-000000000000', 'member-x', 'EI', { EI: 1 }),
    ).rejects.toThrow(/no such group/)
  })
})

describe('createPostgresStore · concurrency safety (the reason this store exists)', () => {
  it('many concurrent joinGroup calls from independent connections all persist — no lost writes', async () => {
    // Each "participant" opens its own postgres.Sql pool against the same database,
    // instead of sharing the test's `sql` — this is the difference that matters: fileStore's
    // in-process promise queue would serialize these fine too as long as they ran in one
    // process, but it can't coordinate across separate connections/processes the way real
    // row locking in Postgres does. This proves the lock is at the database, not in Node.
    const setupStore = createPostgresStore(sql)
    const { groupId } = await setupStore.createGroup('creator-x', 'EI', { EI: 1 })

    const joinerCount = 12
    const pools = Array.from({ length: joinerCount }, () => postgres(url, { max: 1, prepare: false, onnotice: () => {} }))

    try {
      await Promise.all(
        pools.map((pool, i) =>
          createPostgresStore(pool).joinGroup(groupId, `concurrent-member-${i}`, 'SN', { SN: i }),
        ),
      )

      const group = await setupStore.getGroup(groupId)
      expect(group?.members).toHaveLength(joinerCount + 1)

      const participantIds = group?.members.map((m) => m.participantId) ?? []
      // Every id appears — nothing lost — and none repeated — nothing duplicated.
      expect(new Set(participantIds).size).toBe(joinerCount + 1)
      expect(participantIds).toContain('creator-x')
      for (let i = 0; i < joinerCount; i++) {
        expect(participantIds).toContain(`concurrent-member-${i}`)
      }
    } finally {
      await Promise.all(pools.map((pool) => pool.end({ timeout: 5 })))
    }
  })

  it('the same participant racing to join the same group concurrently does not double-count', async () => {
    const setupStore = createPostgresStore(sql)
    const { groupId } = await setupStore.createGroup('creator-y', 'EI', { EI: 1 })

    const raceCount = 8
    const pools = Array.from({ length: raceCount }, () => postgres(url, { max: 1, prepare: false, onnotice: () => {} }))

    try {
      // All `raceCount` requests are the *same* participantId joining at once — simulating
      // a double-tapped "join" button or a retried request racing itself across instances.
      await Promise.all(
        pools.map((pool) => createPostgresStore(pool).joinGroup(groupId, 'same-participant', 'SN', { SN: 1 })),
      )

      const group = await setupStore.getGroup(groupId)
      // Exactly one row for that participant, plus the creator — not `raceCount` extra rows.
      expect(group?.members).toHaveLength(2)
      expect(group?.members.filter((m) => m.participantId === 'same-participant')).toHaveLength(1)
    } finally {
      await Promise.all(pools.map((pool) => pool.end({ timeout: 5 })))
    }
  })

  it('concurrent saveAnswers for the same participant leaves exactly one consistent row (last-write, not a merge artifact)', async () => {
    const pools = Array.from({ length: 6 }, () => postgres(url, { max: 1, prepare: false, onnotice: () => {} }))

    try {
      await Promise.all(
        pools.map((pool, i) =>
          createPostgresStore(pool).saveAnswers('racer', [{ questionId: 'q1', optionId: `opt-${i}` }]),
        ),
      )

      const [{ count }] = await sql<{ count: string }[]>`SELECT count(*) FROM quiz_answers WHERE participant_id = 'racer'`
      expect(Number(count)).toBe(1)

      const store = createPostgresStore(sql)
      const loaded = await store.loadAnswers('racer')
      expect(loaded).toHaveLength(1)
      expect(loaded?.[0].optionId).toMatch(/^opt-\d$/)
    } finally {
      await Promise.all(pools.map((pool) => pool.end({ timeout: 5 })))
    }
  })
})
