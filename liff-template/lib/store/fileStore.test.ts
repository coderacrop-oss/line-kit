import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFileStore } from './fileStore'
import type { Answer } from './types'

let dataDir: string

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'liff-template-store-'))
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

describe('createFileStore · answers', () => {
  it('saves then loads answers for a participant (round-trip)', async () => {
    const store = createFileStore(dataDir)
    const answers: Answer[] = [
      { questionId: 'q1', optionId: 'q1-opt-a' },
      { questionId: 'q2', optionId: 'q2-opt-b' },
    ]

    await store.saveAnswers('participant-1', answers)
    const loaded = await store.loadAnswers('participant-1')

    expect(loaded).toEqual(answers)
  })

  it('returns null for a participant with no saved answers (no store file yet)', async () => {
    const store = createFileStore(dataDir)

    const loaded = await store.loadAnswers('nobody')

    expect(loaded).toBeNull()
  })
})

describe('createFileStore · pairs', () => {
  it('creates then reads back a pair with both participants and scores', async () => {
    const store = createFileStore(dataDir)
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

  it('returns null for a pair id that does not exist', async () => {
    const store = createFileStore(dataDir)

    const pair = await store.getPair('no-such-pair')

    expect(pair).toBeNull()
  })
})

describe('createFileStore · groups', () => {
  it('creates a group, joins two more members, and reflects all members on read', async () => {
    const store = createFileStore(dataDir)

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

  it('returns null for a group id that does not exist', async () => {
    const store = createFileStore(dataDir)

    const group = await store.getGroup('no-such-group')

    expect(group).toBeNull()
  })
})

describe('createFileStore · missing store file', () => {
  it('loading from a data dir where the store file was never written returns empty, not throws', async () => {
    const emptyDir = await mkdtemp(path.join(tmpdir(), 'liff-template-store-empty-'))
    try {
      const store = createFileStore(emptyDir)

      await expect(store.loadAnswers('x')).resolves.toBeNull()
      await expect(store.getPair('x')).resolves.toBeNull()
      await expect(store.getGroup('x')).resolves.toBeNull()
    } finally {
      await rm(emptyDir, { recursive: true, force: true })
    }
  })
})

describe('createFileStore · concurrent writes do not clobber each other', () => {
  it('two saveAnswers calls fired without awaiting in between both persist correctly', async () => {
    const store = createFileStore(dataDir)
    const answersA: Answer[] = [{ questionId: 'q1', optionId: 'a' }]
    const answersB: Answer[] = [{ questionId: 'q1', optionId: 'b' }]

    await Promise.all([
      store.saveAnswers('participant-a', answersA),
      store.saveAnswers('participant-b', answersB),
    ])

    await expect(store.loadAnswers('participant-a')).resolves.toEqual(answersA)
    await expect(store.loadAnswers('participant-b')).resolves.toEqual(answersB)
  })

  it('creating a group then immediately (without await) joining it does not lose the join', async () => {
    const store = createFileStore(dataDir)

    const createPromise = store.createGroup('creator-x', 'EI', { EI: 1 })
    const { groupId } = await createPromise
    // Fire two joins back-to-back without awaiting the first before starting the second.
    const join1 = store.joinGroup(groupId, 'm1', 'SN', { SN: 1 })
    const join2 = store.joinGroup(groupId, 'm2', 'TF', { TF: 1 })
    await Promise.all([join1, join2])

    const group = await store.getGroup(groupId)
    expect(group?.members).toHaveLength(3)
    expect(group?.members.map((m) => m.participantId).sort()).toEqual(['creator-x', 'm1', 'm2'])
  })
})

describe('createFileStore · data dir is created on demand', () => {
  it('writes succeed even when the data dir does not exist yet', async () => {
    const freshDir = path.join(dataDir, 'nested', 'does-not-exist-yet')
    const store = createFileStore(freshDir)

    await store.saveAnswers('p1', [{ questionId: 'q1', optionId: 'a' }])
    const raw = await readFile(path.join(freshDir, 'store.json'), 'utf-8')

    expect(JSON.parse(raw)).toBeTruthy()
  })
})
