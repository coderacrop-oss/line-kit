import type { GroupArchetype, GroupCondition, QuizConfig } from './schema'

export type GroupMember = { topAxis: string; axisScores: Record<string, number> }

export function axisCountsFromMembers(members: GroupMember[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const m of members) counts[m.topAxis] = (counts[m.topAxis] ?? 0) + 1
  return counts
}

/** Clamp negatives to 0, normalise to sum=1 · a member whose clamped scores sum to 0 contributes 0 on every axis (no div-by-zero) */
function normaliseScores(raw: Record<string, number>): Record<string, number> {
  const total = Object.values(raw).reduce((s, v) => s + Math.max(0, v), 0)
  if (total === 0) return Object.fromEntries(Object.entries(raw).map(([k]) => [k, 0]))
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Math.max(0, v) / total]))
}

export function avgScoresFromMembers(members: GroupMember[]): Record<string, number> {
  if (members.length === 0) return {}
  const sums: Record<string, number> = {}
  for (const m of members) {
    const norm = normaliseScores(m.axisScores)
    for (const [k, v] of Object.entries(norm)) sums[k] = (sums[k] ?? 0) + v
  }
  return Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, v / members.length]))
}

export function matchesGroupCondition(
  cond: GroupCondition, axisCounts: Record<string, number>, avgNorm: Record<string, number>,
): boolean {
  if (cond.hasAxes && cond.hasAxes.length > 0) {
    const present = cond.hasAxes.map((ax) => (axisCounts[ax] ?? 0) > 0)
    if (cond.hasMode === 'all' && !present.every(Boolean)) return false
    if (cond.hasMode === 'any' && !present.some(Boolean)) return false

    if (cond.minMembersWithAxis !== undefined && cond.hasAxes.length === 1) {
      if ((axisCounts[cond.hasAxes[0]] ?? 0) < cond.minMembersWithAxis) return false
    }
  }

  if (cond.topAxes && cond.topAxes.length > 0) {
    const sorted = Object.entries(axisCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, cond.topN)
      .map(([ax]) => ax)
    if (!cond.topAxes.some((ax) => sorted.includes(ax))) return false
  }

  if (cond.isBalanced === true) {
    if (!Object.values(avgNorm).every((v) => v < cond.dominantThreshold)) return false
  }

  if (cond.maxDistinct !== undefined) {
    const distinctCount = Object.keys(axisCounts).filter((ax) => (axisCounts[ax] ?? 0) > 0).length
    if (distinctCount > cond.maxDistinct) return false
  }

  return true
}

/** Assumes cfg.group is set — caller's responsibility, same convention as resolvePair assuming cfg.mode === 'duo' */
export function evaluateGroupArchetype(cfg: QuizConfig, members: GroupMember[]): GroupArchetype | null {
  const groupCfg = cfg.group!
  const n = members.length
  if (n < groupCfg.minMembers) return null

  const axisCounts = axisCountsFromMembers(members)
  const avgNorm = avgScoresFromMembers(members)

  const eligible = groupCfg.archetypes.filter((a) => {
    if (a.minGroupSize > n) return false
    if (a.maxGroupSize !== undefined && a.maxGroupSize < n) return false
    return true
  })
  eligible.sort((a, b) => b.minGroupSize - a.minGroupSize)

  for (const arch of eligible) {
    if (arch.fallback) continue
    if (!arch.condition) continue
    if (matchesGroupCondition(arch.condition, axisCounts, avgNorm)) return arch
  }

  for (const arch of eligible) {
    if (arch.fallback) return arch
  }

  return null
}
