/**
 * Runtime persistence contract for the standalone LIFF template (design doc §8).
 *
 * Solo mode never touches this — a solo quiz result is computed straight from the
 * answers submitted in a single request. Duo/group modes need state that survives
 * across devices/requests (waiting for a partner to answer, waiting for a group to
 * fill up), so every duo/group code path goes through this one interface. Swapping
 * the JSON-file-backed `createFileStore` (lib/store/fileStore.ts) for a
 * Postgres/Redis-backed implementation later means writing a new `Store` — nothing
 * in engine/render/screens/routes needs to change.
 */

export interface Answer {
  questionId: string
  optionId: string
}

export interface PairRecord {
  pairId: string
  inviterId: string
  joinerId: string
  scoresA: Record<string, number>
  scoresB: Record<string, number>
  createdAt: string
}

export interface GroupMember {
  participantId: string
  topAxis: string
  axisScores: Record<string, number>
  joinedAt: string
}

export interface GroupRecord {
  groupId: string
  creatorId: string
  members: GroupMember[]
  createdAt: string
}

export interface Store {
  saveAnswers(participantId: string, answers: Answer[]): Promise<void>
  loadAnswers(participantId: string): Promise<Answer[] | null>
  createPair(
    inviterId: string,
    joinerId: string,
    scoresA: Record<string, number>,
    scoresB: Record<string, number>,
  ): Promise<{ pairId: string }>
  getPair(pairId: string): Promise<PairRecord | null>
  createGroup(
    creatorId: string,
    topAxis: string,
    axisScores: Record<string, number>,
  ): Promise<{ groupId: string }>
  joinGroup(
    groupId: string,
    participantId: string,
    topAxis: string,
    axisScores: Record<string, number>,
  ): Promise<void>
  getGroup(groupId: string): Promise<GroupRecord | null>
}
