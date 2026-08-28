import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Answer, GroupRecord, PairRecord, Store } from './types'

interface StoreData {
  answers: Record<string, Answer[]>
  pairs: Record<string, PairRecord>
  groups: Record<string, GroupRecord>
}

function emptyData(): StoreData {
  return { answers: {}, pairs: {}, groups: {} }
}

/**
 * JSON-file-backed `Store` (design doc §8). Every call — read or write — goes through
 * a single in-process promise chain (`writeQueue` below) so a read-modify-write cycle
 * from one call can never interleave with another call's read-modify-write on the same
 * file, which would otherwise clobber whichever write lost the race.
 *
 * Caveat (design doc §13): this only serializes calls *within one Node process*. It
 * does not coordinate across multiple OS processes or serverless instances writing to
 * the same file concurrently. That's an accepted trade-off for a small, single-instance
 * deployment — swap in a Postgres/Redis-backed `Store` implementation behind this same
 * interface if you need multi-instance safety; nothing else in this project needs to
 * change, since every call site goes through the `Store` interface.
 */
export function createFileStore(dataDir?: string): Store {
  const dir = dataDir ?? path.join(process.cwd(), '.data')
  const filePath = path.join(dir, 'store.json')

  let queue: Promise<unknown> = Promise.resolve()

  async function readData(): Promise<StoreData> {
    try {
      const raw = await readFile(filePath, 'utf-8')
      return JSON.parse(raw) as StoreData
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return emptyData()
      }
      throw err
    }
  }

  async function writeData(data: StoreData): Promise<void> {
    await mkdir(dir, { recursive: true })
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
  }

  // Runs `fn` against the current file contents, persists whatever `fn` mutated, and
  // returns `fn`'s return value — all serialized behind `queue` so calls never interleave.
  function enqueue<T>(fn: (data: StoreData) => T): Promise<T> {
    const run = queue.then(async () => {
      const data = await readData()
      const result = fn(data)
      await writeData(data)
      return result
    })
    // Keep the queue alive even if this operation rejects, so later calls aren't stuck
    // waiting on a promise that will never resolve.
    queue = run.catch(() => undefined)
    return run
  }

  return {
    async saveAnswers(participantId, answers) {
      await enqueue((data) => {
        data.answers[participantId] = answers
      })
    },

    async loadAnswers(participantId) {
      return enqueue((data) => data.answers[participantId] ?? null)
    },

    async createPair(inviterId, joinerId, scoresA, scoresB) {
      const pairId = randomUUID()
      return enqueue((data) => {
        data.pairs[pairId] = {
          pairId,
          inviterId,
          joinerId,
          scoresA,
          scoresB,
          createdAt: new Date().toISOString(),
        }
        return { pairId }
      })
    },

    async getPair(pairId) {
      return enqueue((data) => data.pairs[pairId] ?? null)
    },

    async createGroup(creatorId, topAxis, axisScores) {
      const groupId = randomUUID()
      return enqueue((data) => {
        data.groups[groupId] = {
          groupId,
          creatorId,
          members: [{ participantId: creatorId, topAxis, axisScores, joinedAt: new Date().toISOString() }],
          createdAt: new Date().toISOString(),
        }
        return { groupId }
      })
    },

    async joinGroup(groupId, participantId, topAxis, axisScores) {
      await enqueue((data) => {
        const group = data.groups[groupId]
        if (!group) {
          throw new Error(`joinGroup: no such group "${groupId}"`)
        }
        group.members.push({ participantId, topAxis, axisScores, joinedAt: new Date().toISOString() })
      })
    },

    async getGroup(groupId) {
      return enqueue((data) => data.groups[groupId] ?? null)
    },
  }
}
