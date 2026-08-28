import postgres from 'postgres'
import type { Answer, GroupRecord, PairRecord, Store } from './types'

/** Re-exported so callers/tests can annotate a shared connection without importing 'postgres' themselves. */
export type Sql = postgres.Sql

// pair_id / group_id are the only ids this store mints, and it always mints real UUIDs —
// so any id that doesn't even look like one can't be a hit. Guarding on shape here means
// getPair('no-such-pair') / getGroup('no-such-group') (a real fileStore.test.ts case, and
// perfectly reachable in production from a stale/typo'd link) returns null like the
// interface promises, instead of Postgres throwing "invalid input syntax for type uuid"
// (error 22P02) and turning a routine "not found" into a 500.
const UUID_SHAPE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuidShape(id: string): boolean {
  return UUID_SHAPE_RE.test(id)
}

/**
 * Opens a new `postgres.Sql` connection pool for the given connection string. Exported
 * mainly so tests that want to prove concurrency-safety across genuinely separate
 * connections (not just one in-process pool — the whole point of moving off fileStore)
 * can open more than one of these against the same database.
 */
export function connect(connectionString: string): Sql {
  return postgres(connectionString, { max: 10, prepare: false, onnotice: () => {} })
}

/**
 * Postgres-backed `Store` (design doc §8/§13) — the multi-instance-safe counterpart to
 * `fileStore.ts`. `fileStore`'s in-process promise queue only serializes calls *within
 * one Node process*; it does nothing for two OS processes or serverless instances
 * writing to the same file concurrently. Here, every read-then-write sequence runs
 * inside a real Postgres transaction, and `joinGroup` additionally takes a row lock
 * (`SELECT ... FOR UPDATE`) on the parent group row before touching membership, so two
 * concurrent joins against the same group — from any process, anywhere — serialize
 * against each other at the database instead of racing. See db/schema.sql for the
 * tables this expects.
 */
export function createPostgresStore(sqlOrConnectionString: Sql | string): Store {
  const sql: Sql = typeof sqlOrConnectionString === 'string' ? connect(sqlOrConnectionString) : sqlOrConnectionString

  return {
    async saveAnswers(participantId, answers) {
      // `Answer[]` (a fixed-shape interface array) doesn't structurally satisfy postgres.js's
      // `JSONValue` index-signature branch the way a plain `Record<string, T>` does — it's
      // still valid JSON at runtime, just a TS structural-typing gap, hence the cast.
      await sql`
        INSERT INTO quiz_answers (participant_id, answers)
        VALUES (${participantId}, ${sql.json(answers as unknown as postgres.JSONValue)})
        ON CONFLICT (participant_id) DO UPDATE SET answers = EXCLUDED.answers, updated_at = now()`
    },

    async loadAnswers(participantId) {
      const rows = await sql<{ answers: Answer[] }[]>`
        SELECT answers FROM quiz_answers WHERE participant_id = ${participantId}`
      return rows[0] ? rows[0].answers : null
    },

    async createPair(inviterId, joinerId, scoresA, scoresB) {
      const [row] = await sql<{ pair_id: string }[]>`
        INSERT INTO quiz_pairs (inviter_id, joiner_id, scores_a, scores_b)
        VALUES (${inviterId}, ${joinerId}, ${sql.json(scoresA)}, ${sql.json(scoresB)})
        RETURNING pair_id`
      return { pairId: row.pair_id }
    },

    async getPair(pairId) {
      if (!isUuidShape(pairId)) return null
      const rows = await sql<
        { pair_id: string; inviter_id: string; joiner_id: string; scores_a: Record<string, number>; scores_b: Record<string, number>; created_at: Date }[]
      >`
        SELECT pair_id, inviter_id, joiner_id, scores_a, scores_b, created_at
        FROM quiz_pairs WHERE pair_id = ${pairId}`
      const row = rows[0]
      if (!row) return null
      const pair: PairRecord = {
        pairId: row.pair_id,
        inviterId: row.inviter_id,
        joinerId: row.joiner_id,
        scoresA: row.scores_a,
        scoresB: row.scores_b,
        createdAt: row.created_at.toISOString(),
      }
      return pair
    },

    async createGroup(creatorId, topAxis, axisScores) {
      return sql.begin(async (tx) => {
        const [group] = await tx<{ group_id: string }[]>`
          INSERT INTO quiz_groups (creator_id) VALUES (${creatorId}) RETURNING group_id`
        await tx`
          INSERT INTO quiz_group_members (group_id, participant_id, top_axis, axis_scores)
          VALUES (${group.group_id}, ${creatorId}, ${topAxis}, ${tx.json(axisScores)})`
        return { groupId: group.group_id }
      })
    },

    async joinGroup(groupId, participantId, topAxis, axisScores) {
      if (!isUuidShape(groupId)) {
        throw new Error(`joinGroup: no such group "${groupId}"`)
      }
      await sql.begin(async (tx) => {
        // Row lock on the parent group serializes concurrent joins against *this* group —
        // a second joinGroup call (any process) blocks here until this transaction commits
        // or rolls back, so membership never gets read-modify-written from a stale snapshot.
        const [group] = await tx`SELECT group_id FROM quiz_groups WHERE group_id = ${groupId} FOR UPDATE`
        if (!group) {
          throw new Error(`joinGroup: no such group "${groupId}"`)
        }
        // ON CONFLICT DO NOTHING on the (group_id, participant_id) primary key makes a
        // duplicate join for the same participant — including two concurrent requests
        // racing to join the same group as the same participant — a no-op instead of a
        // second membership row (the "double-count" case).
        await tx`
          INSERT INTO quiz_group_members (group_id, participant_id, top_axis, axis_scores)
          VALUES (${groupId}, ${participantId}, ${topAxis}, ${tx.json(axisScores)})
          ON CONFLICT (group_id, participant_id) DO NOTHING`
      })
    },

    async getGroup(groupId) {
      if (!isUuidShape(groupId)) return null
      const rows = await sql<{ group_id: string; creator_id: string; created_at: Date }[]>`
        SELECT group_id, creator_id, created_at FROM quiz_groups WHERE group_id = ${groupId}`
      const group = rows[0]
      if (!group) return null

      const memberRows = await sql<
        { participant_id: string; top_axis: string; axis_scores: Record<string, number>; joined_at: Date }[]
      >`
        SELECT participant_id, top_axis, axis_scores, joined_at FROM quiz_group_members
        WHERE group_id = ${groupId} ORDER BY joined_seq ASC`

      const record: GroupRecord = {
        groupId: group.group_id,
        creatorId: group.creator_id,
        members: memberRows.map((m) => ({
          participantId: m.participant_id,
          topAxis: m.top_axis,
          axisScores: m.axis_scores,
          joinedAt: m.joined_at.toISOString(),
        })),
        createdAt: group.created_at.toISOString(),
      }
      return record
    },
  }
}
