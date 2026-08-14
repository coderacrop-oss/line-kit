import type postgres from 'postgres'

export type Seeded = {
  userId: string
  campaignId: string
  channelId: string
  configVersionId: string
  activityId: string
  cardIds: Record<string, string>
  counterId: string
  rewardIds: Record<string, string>
  participantIds: string[]
}

let unique = 0
const uid = () => `${Date.now().toString(36)}${(unique++).toString(36)}`

/**
 * A minimal but complete campaign: one activity that draws one of two rewards,
 * one counter with a milestone, and as many participants as a test needs.
 *
 * Seeded through SQL rather than the admin API on purpose — what these tests
 * exercise is the write path, not the screens.
 */
export async function seed(
  sql: postgres.Sql,
  opts: { participants?: number; quotaA?: number | null; quotaB?: number | null } = {},
): Promise<Seeded> {
  const participants = opts.participants ?? 1
  const tag = uid()

  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`seed-${tag}@example.com`}, 'configurator')
    RETURNING id`

  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES ('Seed', ${`seed_${tag}`}, now() - interval '1 day', now() + interval '30 days', ${user.id})
    RETURNING id`

  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (name, channel_type, created_by)
    VALUES ('Seed preview', 'preview', ${user.id})
    RETURNING id`

  await sql`
    INSERT INTO campaign_channel (campaign_id, channel_id, is_published)
    VALUES (${campaign.id}, ${channel.id}, true)`

  const cardIds: Record<string, string> = {}
  for (const code of ['win_a', 'win_b', 'blocked', 'fallback']) {
    const [card] = await sql<{ id: string }[]>`
      INSERT INTO card (campaign_id, code) VALUES (${campaign.id}, ${code}) RETURNING id`
    cardIds[code] = card.id
  }

  const [counter] = await sql<{ id: string }[]>`
    INSERT INTO counter (campaign_id, code, name, mode, target)
    VALUES (${campaign.id}, 'food', 'อาหาร', 'accumulate', 100)
    RETURNING id`

  await sql`
    INSERT INTO counter_milestone (counter_id, at_value, effects)
    VALUES (${counter.id}, 50, '[]'::jsonb)`

  const rewardIds: Record<string, string> = {}
  const quotas: Array<[string, number | null]> = [
    ['reward_a', opts.quotaA === undefined ? 10 : opts.quotaA],
    ['reward_b', opts.quotaB === undefined ? null : opts.quotaB],
  ]
  for (const [code, quota] of quotas) {
    const [reward] = await sql<{ id: string }[]>`
      INSERT INTO reward (campaign_id, code, reward_type, value, quota, use_limit)
      VALUES (${campaign.id}, ${code}, 'link', 'https://example.com/r', ${quota}, NULL)
      RETURNING id`
    rewardIds[code] = reward.id
  }

  const [activity] = await sql<{ id: string }[]>`
    INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, fallback_card_id)
    VALUES (${campaign.id}, 'draw', 'สุ่มรางวัล', 'none', 'quota', ${cardIds.fallback})
    RETURNING id`

  const [version] = await sql<{ id: string }[]>`
    INSERT INTO config_version (campaign_id, version_no, snapshot, channel_id, published_by)
    VALUES (${campaign.id}, 1, '{}'::jsonb, ${channel.id}, ${user.id})
    RETURNING id`

  const participantIds: string[] = []
  for (let i = 0; i < participants; i++) {
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO participant (channel_id, line_uid) VALUES (${channel.id}, ${`U-${tag}-${i}`})
      RETURNING id`
    participantIds.push(p.id)
  }

  return {
    userId: user.id, campaignId: campaign.id, channelId: channel.id,
    configVersionId: version.id, activityId: activity.id, cardIds,
    counterId: counter.id, rewardIds, participantIds,
  }
}
