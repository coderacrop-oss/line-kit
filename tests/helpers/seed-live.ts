import type postgres from 'postgres'

export type SeededLive = {
  lineChannelId: string
  campaignId: string
  campaignCode: string
  cardIds: Record<string, string>
  activityId: string
}

let unique = 0
const uid = () => `${Date.now().toString(36)}${(unique++).toString(36)}`

/**
 * A campaign as it exists once published: bound to a channel, with a config
 * version, one keyword, one activity that grants a reward, and cards with real
 * blocks. What the end-to-end tests read is exactly what the webhook reads.
 */
export async function seedLive(
  sql: postgres.Sql,
  opts: { oncePerDay?: boolean } = {},
): Promise<SeededLive> {
  const tag = uid()
  const code = `live_${tag}`
  const lineChannelId = `LINE-${tag}`

  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`live-${tag}@example.com`}, 'configurator') RETURNING id`

  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, timezone, start_at, end_at, created_by, theme)
    VALUES ('Live', ${code}, 'Asia/Bangkok', now() - interval '2 days', now() + interval '20 days',
            ${user.id}, '{"primary":"#17756A"}'::jsonb)
    RETURNING id`

  const cardIds: Record<string, string> = {}
  const blocks: Record<string, Array<[string, string | null, unknown]>> = {
    win: [['title', 'ผลของคุณ', null], ['body', 'คุณได้รางวัล', null]],
    fallback: [['body', 'ของรางวัลหมดแล้ว', null]],
    blocked: [['body', 'วันนี้เล่นแล้ว พรุ่งนี้มาใหม่นะ', null]],
    greeting: [['body', 'ยินดีต้อนรับ', null]],
    fallbackText: [['body', 'พิมพ์ว่า เล่น เพื่อเริ่ม', null]],
  }
  for (const [key, rows] of Object.entries(blocks)) {
    const renderAs = key === 'win' ? 'flex_bubble' : 'text'
    const [card] = await sql<{ id: string }[]>`
      INSERT INTO card (campaign_id, code, render_as)
      VALUES (${campaign.id}, ${`${key}_${tag}`}, ${renderAs}) RETURNING id`
    cardIds[key] = card.id
    let order = 0
    for (const [type, content] of rows) {
      await sql`
        INSERT INTO card_block (card_id, block_type, sort_order, content)
        VALUES (${card.id}, ${type}, ${order++}, ${content})`
    }
  }

  const [reward] = await sql<{ id: string }[]>`
    INSERT INTO reward (campaign_id, code, reward_type, value, quota, use_limit)
    VALUES (${campaign.id}, 'sticker', 'link', 'https://example.com/sticker', 100, NULL)
    RETURNING id`

  const entryRules = opts.oncePerDay
    ? [{ type: 'limit', count: 1, per: 'day', cardId: cardIds.blocked }]
    : []

  const [activity] = await sql<{ id: string }[]>`
    INSERT INTO activity (
      campaign_id, code, name, input_type, resolve_method,
      resolve_config, entry_rules, effects, fallback_card_id)
    VALUES (
      ${campaign.id}, 'draw', 'สุ่มรางวัล', 'none', 'weighted',
      ${sql.json({ outcomes: [{ id: 'a', cardId: cardIds.win, weight: 1, rewardCode: 'sticker' }] } as never)},
      ${sql.json(entryRules as never)},
      ${sql.json([{ type: 'grant_reward' }] as never)},
      ${cardIds.fallback})
    RETURNING id`

  await sql`
    INSERT INTO keyword_rule (campaign_id, keyword, match_mode, target_activity_id, sort_order)
    VALUES (${campaign.id}, 'เล่น', 'exact', ${activity.id}, 1)`

  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (
      name, channel_type, line_channel_id, encrypted_token, encrypted_secret,
      token_last4, default_card_id, greeting_card_id, greeting_enabled, created_by)
    VALUES (
      'Live test OA', 'test', ${lineChannelId}, 'enc-token', 'enc-secret',
      '1234', ${cardIds.fallbackText}, ${cardIds.greeting}, true, ${user.id})
    RETURNING id`

  await sql`
    INSERT INTO campaign_channel (campaign_id, channel_id, is_published, published_at)
    VALUES (${campaign.id}, ${channel.id}, true, now())`

  await sql`
    INSERT INTO config_version (campaign_id, version_no, snapshot, channel_id, published_by)
    VALUES (${campaign.id}, 1, '{}'::jsonb, ${channel.id}, ${user.id})`

  void reward
  return { lineChannelId, campaignId: campaign.id, campaignCode: code, cardIds, activityId: activity.id }
}
