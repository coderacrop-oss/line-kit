import type { QuizConfig } from '../schema'
import type { FlexBubble, FlexMessage } from './types'

/**
 * Twelve pure Flex/text-message renderers (design doc §6). Every visible string comes from
 * cfg.templateCopy / cfg.results / cfg.group.archetypes / the runtime `data` argument — never a
 * hardcoded campaign-specific default (design doc's "mistake #1 to avoid"). The only literal
 * strings in this file are generic technical labels with no campaign meaning (e.g. the "?" open
 * group-member-slot placeholder, added in the group-renderers slice).
 *
 * Every function below assumes cfg.templateCopy and its mode/group-specific sub-fields are
 * present — the same "caller's responsibility" convention lib/quiz/groupEngine.ts documents for
 * `cfg.group!` — because by the time a campaign is exported, lib/quiz/schema.ts's superRefine
 * (§4.1) has already required them for the modes/features this campaign actually uses.
 */

/** Simple `{key}` placeholder substitution — no template-engine dependency (design doc §6). */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  let out = template
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{${key}}`, String(value))
  }
  return out
}

function textBlock(text: string, opts: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'text', text, wrap: true, ...opts }
}

function primaryButton(label: string, uri: string): Record<string, unknown> {
  return { type: 'button', style: 'primary', action: { type: 'uri', label, uri } }
}

function secondaryButton(label: string, uri: string): Record<string, unknown> {
  return { type: 'button', style: 'secondary', action: { type: 'uri', label, uri } }
}

function bubble(opts: { hero?: Record<string, unknown>; bodyContents: Record<string, unknown>[]; footerContents?: Record<string, unknown>[] }): FlexBubble {
  const out: FlexBubble = {
    type: 'bubble',
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: opts.bodyContents },
  }
  if (opts.hero) out.hero = opts.hero
  if (opts.footerContents && opts.footerContents.length > 0) {
    out.footer = { type: 'box', layout: 'vertical', spacing: 'sm', contents: opts.footerContents }
  }
  return out
}

function heroImage(url: string | undefined): Record<string, unknown> | undefined {
  return url ? { type: 'image', url, size: 'full', aspectMode: 'cover' } : undefined
}

// ---------------------------------------------------------------------------
// Shared + solo renderers (Task 6)
// ---------------------------------------------------------------------------

/** follow event — constant copy from templateCopy.intro, no runtime data (design doc §6 row 1). */
export function renderFollowMessage(cfg: QuizConfig): FlexMessage {
  const intro = cfg.templateCopy!.intro
  return {
    type: 'flex',
    altText: intro.title,
    contents: bubble({
      bodyContents: [
        textBlock(intro.title, { weight: 'bold', size: 'lg' }),
        textBlock(intro.body, { size: 'md' }),
      ],
      footerContents: [primaryButton(intro.ctaLabel, '')],
    }),
  }
}

/** quiz finished — the computed resultCode's copy + a share link (design doc §6 row 2). */
export function renderResultCard(cfg: QuizConfig, data: { resultCode: string; shareUrl: string }): FlexMessage {
  const result = cfg.results.find((r) => r.code === data.resultCode)
  const copy = cfg.templateCopy!.messages.resultCard
  return {
    type: 'flex',
    altText: result?.title ?? copy.eyebrow,
    contents: bubble({
      hero: heroImage(result?.imageUrl),
      bodyContents: [
        textBlock(copy.eyebrow, { size: 'sm', weight: 'bold' }),
        textBlock(result?.title ?? '', { size: 'xl', weight: 'bold' }),
        textBlock(result?.body ?? '', { size: 'md' }),
      ],
      footerContents: [primaryButton(copy.ctaLabel, data.shareUrl)],
    }),
  }
}

/** keyword reply — plain-text variant (design doc §6 row 3). */
export function renderKeywordText(cfg: QuizConfig): FlexMessage {
  const kw = cfg.templateCopy!.messages.keywordCard
  return { type: 'text', text: `${kw.title}\n${kw.body}` }
}

/** keyword reply — generic card variant, linking into the LIFF app (design doc §6 row 4). */
export function renderKeywordCard(cfg: QuizConfig, data: { liffUrl: string }): FlexMessage {
  const kw = cfg.templateCopy!.messages.keywordCard
  return {
    type: 'flex',
    altText: kw.title,
    contents: bubble({
      bodyContents: [
        textBlock(kw.title, { weight: 'bold', size: 'lg' }),
        textBlock(kw.body, { size: 'md' }),
      ],
      footerContents: [primaryButton(kw.ctaLabel, data.liffUrl)],
    }),
  }
}

/**
 * keyword reply — escape hatch (design doc §6 row 5): returns
 * templateCopy.messages.keywordCard.customFlexJson verbatim when the admin has authored raw Flex
 * JSON, falling back to renderKeywordCard's own output otherwise (plan Task 6's back-fill note).
 */
export function renderKeywordCustom(cfg: QuizConfig, data: { liffUrl: string }): FlexMessage {
  const custom = cfg.templateCopy!.messages.keywordCard.customFlexJson
  if (custom) return custom as FlexMessage
  return renderKeywordCard(cfg, data)
}

/** solo mode — share card for the player's own result (design doc §6 row 6). */
export function renderSoloShareCard(cfg: QuizConfig, data: { resultCode: string }): FlexMessage {
  const result = cfg.results.find((r) => r.code === data.resultCode)
  const share = cfg.templateCopy!.messages.soloShare!
  return {
    type: 'flex',
    altText: share.badge,
    contents: bubble({
      hero: heroImage(result?.imageUrl),
      bodyContents: [
        textBlock(share.badge, { size: 'sm', weight: 'bold' }),
        textBlock(result?.title ?? '', { size: 'xl', weight: 'bold' }),
        textBlock(result?.body ?? '', { size: 'md' }),
      ],
      footerContents: [
        primaryButton(share.ctaLabel, ''),
        secondaryButton(share.secondaryCtaLabel, ''),
      ],
    }),
  }
}

// ---------------------------------------------------------------------------
// Duo renderers (Task 7)
// ---------------------------------------------------------------------------

/** duo — invite a buddy; interpolates {axisName} (the inviter's strongest axis) into the copy (design doc §6 row 7). */
export function renderDuoInviteCard(cfg: QuizConfig, data: { myAxisId: string; shareUrl: string }): FlexMessage {
  const axis = cfg.axes.find((a) => a.id === data.myAxisId)
  const vars = { axisName: axis?.label ?? data.myAxisId }
  const invite = cfg.templateCopy!.messages.duoInvite!
  const title = interpolate(invite.titleTemplate, vars)
  const body = interpolate(invite.bodyTemplate, vars)
  return {
    type: 'flex',
    altText: title,
    contents: bubble({
      bodyContents: [
        textBlock(title, { weight: 'bold', size: 'lg' }),
        textBlock(body, { size: 'md' }),
      ],
      footerContents: [primaryButton(invite.ctaLabel, data.shareUrl)],
    }),
  }
}

/** duo — push telling the inviter their buddy has answered (design doc §6 row 8). partnerName/partnerAxisId are runtime, not config. */
export function renderDuoPartnerAnsweredPush(cfg: QuizConfig, data: { partnerName: string; partnerAxisId: string }): FlexMessage {
  const axis = cfg.axes.find((a) => a.id === data.partnerAxisId)
  const copy = cfg.templateCopy!.messages.duoPartnerAnswered!
  return {
    type: 'flex',
    altText: copy.badge,
    contents: bubble({
      bodyContents: [
        textBlock(copy.badge, { size: 'sm', weight: 'bold' }),
        textBlock(data.partnerName, { size: 'lg', weight: 'bold' }),
        textBlock(axis?.label ?? data.partnerAxisId, { size: 'md' }),
      ],
      footerContents: [primaryButton(copy.ctaLabel, '')],
    }),
  }
}

/** duo — full pair result card; heroImageUrl is a pre-composited runtime image, not something this renderer builds (design doc §6 row 9). */
export function renderDuoPairResultCard(cfg: QuizConfig, data: { resultCode: string; heroImageUrl: string; rank: number }): FlexMessage {
  const result = cfg.results.find((r) => r.code === data.resultCode)
  const copy = cfg.templateCopy!.messages.duoPairResult!
  const rankLine = interpolate(copy.rankLineTemplate, { rank: data.rank })
  return {
    type: 'flex',
    altText: result?.title ?? copy.badge,
    contents: bubble({
      hero: heroImage(data.heroImageUrl),
      bodyContents: [
        textBlock(copy.badge, { size: 'sm', weight: 'bold' }),
        textBlock(result?.title ?? '', { size: 'xl', weight: 'bold' }),
        textBlock(rankLine, { size: 'sm' }),
        textBlock(result?.body ?? '', { size: 'md' }),
      ],
      footerContents: [primaryButton(copy.ctaLabel, '')],
    }),
  }
}

/** duo — reminder push when the buddy hasn't matched yet; interpolates {hours} (design doc §6 row 10). */
export function renderDuoReminderPush(cfg: QuizConfig, data: { hoursSinceInvite: number }): FlexMessage {
  const copy = cfg.templateCopy!.messages.duoReminder!
  const headline = interpolate(copy.headlineTemplate, { hours: data.hoursSinceInvite })
  return {
    type: 'flex',
    altText: copy.badge,
    contents: bubble({
      bodyContents: [
        textBlock(copy.badge, { size: 'sm', weight: 'bold' }),
        textBlock(headline, { size: 'lg', weight: 'bold' }),
      ],
      footerContents: [primaryButton(copy.ctaLabel, '')],
    }),
  }
}

// ---------------------------------------------------------------------------
// Group renderers (Task 8)
// ---------------------------------------------------------------------------

/** group — push when the group's result completes; looks up the computed archetype by code (design doc §6 row 11). */
export function renderGroupCompletePush(cfg: QuizConfig, data: { archetypeCode: string; memberCount: number }): FlexMessage {
  const archetype = cfg.group?.archetypes.find((a) => a.code === data.archetypeCode)
  const copy = cfg.templateCopy!.messages.groupComplete!
  return {
    type: 'flex',
    altText: archetype?.title ?? copy.badge,
    contents: bubble({
      hero: heroImage(archetype?.imageUrl),
      bodyContents: [
        textBlock(copy.badge, { size: 'sm', weight: 'bold' }),
        textBlock(archetype?.title ?? '', { size: 'xl', weight: 'bold' }),
        textBlock(archetype?.body ?? '', { size: 'md' }),
        textBlock(String(data.memberCount), { size: 'sm' }),
      ],
      footerContents: [primaryButton(copy.ctaLabel, '')],
    }),
  }
}

/** group — push when a new archetype tier unlocks; interpolates {archetype} (its title) into headlineTemplate (design doc §6 row 12a). */
export function renderGroupUnlockPush(cfg: QuizConfig, data: { archetypeCode: string }): FlexMessage {
  const archetype = cfg.group?.archetypes.find((a) => a.code === data.archetypeCode)
  const copy = cfg.templateCopy!.messages.groupUnlock!
  const headline = interpolate(copy.headlineTemplate, { archetype: archetype?.title ?? data.archetypeCode })
  return {
    type: 'flex',
    altText: headline,
    contents: bubble({
      hero: heroImage(archetype?.imageUrl),
      bodyContents: [
        textBlock(headline, { size: 'lg', weight: 'bold' }),
        textBlock(archetype?.body ?? '', { size: 'md' }),
      ],
      footerContents: [primaryButton(copy.ctaLabel, '')],
    }),
  }
}

/** group — reminder push while the group hasn't reached minMembers yet; interpolates {current}/{remaining} (design doc §6 row 12b). */
export function renderGroupReminderPush(cfg: QuizConfig, data: { currentMembers: number; remaining: number }): FlexMessage {
  const copy = cfg.templateCopy!.messages.groupReminder!
  const headline = interpolate(copy.headlineTemplate, { current: data.currentMembers, remaining: data.remaining })
  return {
    type: 'flex',
    altText: copy.badge,
    contents: bubble({
      bodyContents: [
        textBlock(copy.badge, { size: 'sm', weight: 'bold' }),
        textBlock(headline, { size: 'lg', weight: 'bold' }),
        textBlock(copy.subText, { size: 'sm' }),
      ],
      footerContents: [primaryButton(copy.ctaLabel, '')],
    }),
  }
}

/**
 * group — invite more people into the group; renders one avatar-shaped slot per member up to
 * maxMembers, each present member showing their axis's short chip label when set (falling back
 * to the full label — matches QuizAxis.short's stated purpose as "the one-liner shown on axis
 * chips," and this slot literally is one) and each open slot showing a generic "?" placeholder —
 * the one literal string in this file that isn't campaign copy, since an empty slot has no
 * member to draw an axis label from (design doc §6 row 12c/§7's note on Matching/Group
 * placeholders).
 */
export function renderGroupInviteCard(
  cfg: QuizConfig,
  data: { members: { axisId: string }[]; maxMembers: number; archetypeCode?: string },
): FlexMessage {
  const copy = cfg.templateCopy!.messages.groupInvite!
  const archetype = data.archetypeCode ? cfg.group?.archetypes.find((a) => a.code === data.archetypeCode) : undefined
  const header = archetype
    ? interpolate(copy.headerCompleteTemplate, { archetype: archetype.title })
    : interpolate(copy.headerIncompleteTemplate, { current: data.members.length, max: data.maxMembers })

  const slots: Record<string, unknown>[] = []
  for (let i = 0; i < data.maxMembers; i++) {
    const member = data.members[i]
    if (!member) {
      slots.push(textBlock('?', { align: 'center' }))
      continue
    }
    const axis = cfg.axes.find((a) => a.id === member.axisId)
    slots.push(textBlock(axis?.short ?? axis?.label ?? member.axisId, { align: 'center' }))
  }

  return {
    type: 'flex',
    altText: header,
    contents: bubble({
      bodyContents: [
        textBlock(header, { weight: 'bold', size: 'lg' }),
        textBlock(copy.body, { size: 'md' }),
        { type: 'box', layout: 'horizontal', contents: slots },
      ],
      footerContents: [
        primaryButton(copy.ctaLabel, ''),
        secondaryButton(copy.secondaryCtaLabel, ''),
      ],
    }),
  }
}
