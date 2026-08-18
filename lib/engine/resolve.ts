export type Outcome = {
  id: string
  cardId: string
  /** relative chance, for weighted and quota */
  weight?: number
  /** reward this outcome grants, if any */
  rewardCode?: string
  /** inclusive score band, for score */
  scoreMin?: number
  scoreMax?: number
}

export type ResolveMethod = 'fixed' | 'weighted' | 'quota' | 'score'

export type ResolveInput = { pickedId?: string; score?: number }

/**
 * Draw without replacement so the whole list comes back ranked rather than a
 * single winner.
 *
 * Quota can run out between deciding and writing, and handing the database a
 * ranked list lets it take the first still-available outcome in the same round
 * trip — no retry loop, and no second decision that could disagree with the
 * first.
 */
function rank(outcomes: Outcome[], rng: () => number): Outcome[] {
  const pool = outcomes.map((o) => ({ o, w: Math.max(0, o.weight ?? 1) }))
  const ranked: Outcome[] = []

  while (pool.length > 0) {
    const total = pool.reduce((sum, p) => sum + p.w, 0)
    let index = 0

    if (total > 0) {
      let roll = rng() * total
      for (let i = 0; i < pool.length; i++) {
        index = i
        roll -= pool[i].w
        if (roll <= 0) break
      }
    } else {
      // Every weight is zero. Order is arbitrary but must stay deterministic
      // under a fixed seed, so still spend a roll rather than bailing out.
      index = Math.min(pool.length - 1, Math.floor(rng() * pool.length))
    }

    ranked.push(pool[index].o)
    pool.splice(index, 1)
  }

  return ranked
}

export function resolve(
  method: ResolveMethod,
  outcomes: Outcome[],
  input: ResolveInput,
  rng: () => number,
): Outcome[] {
  switch (method) {
    case 'fixed': {
      const picked = outcomes.find((o) => o.id === input.pickedId)
      return picked ? [picked] : []
    }

    case 'weighted':
    case 'quota':
      // Identical here. The difference is not how the order is drawn but
      // whether remaining stock filters it, and stock lives in the database
      // where the race can actually be settled.
      return rank(outcomes, rng)

    case 'score': {
      const score = input.score ?? 0
      const band = outcomes.find(
        (o) => score >= (o.scoreMin ?? -Infinity) && score <= (o.scoreMax ?? Infinity),
      )
      return band ? [band] : []
    }
  }
}
