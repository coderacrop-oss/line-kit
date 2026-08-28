import { describe, expect, it } from 'vitest'
import {
  interpolate,
  renderDuoInviteCard,
  renderDuoPairResultCard,
  renderDuoPartnerAnsweredPush,
  renderDuoReminderPush,
  renderFollowMessage,
  renderGroupCompletePush,
  renderGroupInviteCard,
  renderGroupReminderPush,
  renderGroupUnlockPush,
  renderKeywordCard,
  renderKeywordCustom,
  renderKeywordText,
  renderResultCard,
  renderSoloShareCard,
} from './messages'
import type { QuizConfig } from '../schema'

/**
 * One shared fixture reused (and grown, task by task) across every renderer test in this file.
 * Every field holds a distinctive marker string unique to that field, so a test asserting the
 * marker appears in the right spot of a renderer's output fails loudly if the renderer either
 * (a) forgets to read the field at all, or (b) hardcodes a default instead of reading it —
 * design doc's "mistake #1 to avoid".
 */
const fullCfg: QuizConfig = {
  mode: 'duo',
  axes: [
    { id: 'ei', label: 'AXIS_EI_LABEL', poles: ['E', 'I'] },
    { id: 'sn', label: 'AXIS_SN_LABEL', poles: ['S', 'N'] },
  ],
  questions: [
    { id: 'q1', text: 'q1', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
    { id: 'q2', text: 'q2', options: [{ id: 'a', label: 'A', scores: { sn: 1 } }, { id: 'b', label: 'B', scores: { sn: -1 } }] },
    { id: 'q3', text: 'q3', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
  ],
  results: [
    { code: 'ES', title: 'RESULT_ES_TITLE', body: 'RESULT_ES_BODY', imageUrl: 'https://example.com/es.png' },
    { code: 'IN', title: 'RESULT_IN_TITLE', body: 'RESULT_IN_BODY' },
  ],
  fallbackResultCode: 'ES',
  group: {
    enabled: true, minMembers: 2, maxMembers: 5, resultLocksAt: 0,
    archetypes: [{ code: 'ARCH1', title: 'ARCH1_TITLE', body: 'ARCH1_BODY', imageUrl: 'https://example.com/arch1.png', minGroupSize: 2, fallback: true }],
    fallbackArchetype: 'ARCH1',
  },
  templateCopy: {
    brand: { name: 'BRAND_NAME' },
    intro: { title: 'INTRO_TITLE', body: 'INTRO_BODY', ctaLabel: 'INTRO_CTA' },
    friendGate: { title: 'FRIENDGATE_TITLE', body: 'FRIENDGATE_BODY', ctaLabel: 'FRIENDGATE_CTA' },
    openInLine: { title: 'OPENINLINE_TITLE', body: 'OPENINLINE_BODY' },
    invite: { shareTitle: 'INVITE_SHARE_TITLE', shareBodyTemplate: 'INVITE_BODY_{axisName}' },
    rewards: { milestones: [] },
    messages: {
      resultCard: { eyebrow: 'RESULTCARD_EYEBROW', ctaLabel: 'RESULTCARD_CTA' },
      keywordCard: { title: 'KEYWORD_TITLE', body: 'KEYWORD_BODY', ctaLabel: 'KEYWORD_CTA' },
      soloShare: { badge: 'SOLOSHARE_BADGE', ctaLabel: 'SOLOSHARE_CTA', secondaryCtaLabel: 'SOLOSHARE_CTA2' },
      duoInvite: { titleTemplate: 'DUOINVITE_TITLE_{axisName}', bodyTemplate: 'DUOINVITE_BODY_{axisName}', ctaLabel: 'DUOINVITE_CTA' },
      duoPartnerAnswered: { badge: 'DUOPARTNER_BADGE', ctaLabel: 'DUOPARTNER_CTA' },
      duoPairResult: { badge: 'DUOPAIR_BADGE', rankLineTemplate: 'DUOPAIR_RANK_{rank}', ctaLabel: 'DUOPAIR_CTA' },
      duoReminder: { badge: 'DUOREMIND_BADGE', headlineTemplate: 'DUOREMIND_HEADLINE_{hours}', ctaLabel: 'DUOREMIND_CTA' },
      groupComplete: { badge: 'GROUPCOMPLETE_BADGE', ctaLabel: 'GROUPCOMPLETE_CTA' },
      groupUnlock: { headlineTemplate: 'GROUPUNLOCK_HEADLINE_{archetype}', ctaLabel: 'GROUPUNLOCK_CTA' },
      groupReminder: { badge: 'GROUPREMIND_BADGE', headlineTemplate: 'GROUPREMIND_HEADLINE_{current}_{remaining}', subText: 'GROUPREMIND_SUBTEXT', ctaLabel: 'GROUPREMIND_CTA' },
      groupInvite: {
        headerCompleteTemplate: 'GROUPINVITE_COMPLETE_{archetype}',
        headerIncompleteTemplate: 'GROUPINVITE_INCOMPLETE_{current}_{max}',
        body: 'GROUPINVITE_BODY', ctaLabel: 'GROUPINVITE_CTA', secondaryCtaLabel: 'GROUPINVITE_CTA2',
      },
    },
  },
}

describe('interpolate', () => {
  it('replaces every {key} placeholder with the given value, coerced to string', () => {
    expect(interpolate('Hello {name}, you are {age}', { name: 'Kim', age: 7 })).toBe('Hello Kim, you are 7')
  })
  it('replaces every occurrence of a repeated placeholder', () => {
    expect(interpolate('{x}-{x}', { x: 'a' })).toBe('a-a')
  })
  it('leaves unknown placeholders untouched', () => {
    expect(interpolate('{known} {unknown}', { known: 'K' })).toBe('K {unknown}')
  })
})

describe('renderFollowMessage', () => {
  it('draws every visible string from templateCopy.intro', () => {
    const msg = renderFollowMessage(fullCfg)
    const json = JSON.stringify(msg)
    expect(msg.type).toBe('flex')
    expect(json).toContain('INTRO_TITLE')
    expect(json).toContain('INTRO_BODY')
    expect(json).toContain('INTRO_CTA')
  })
})

describe('renderResultCard', () => {
  it('looks up the result by resultCode and includes its title/body/imageUrl plus resultCard copy and shareUrl', () => {
    const msg = renderResultCard(fullCfg, { resultCode: 'IN', shareUrl: 'https://share.example/xyz' })
    const json = JSON.stringify(msg)
    expect(json).toContain('RESULT_IN_TITLE')
    expect(json).toContain('RESULT_IN_BODY')
    expect(json).toContain('RESULTCARD_EYEBROW')
    expect(json).toContain('RESULTCARD_CTA')
    expect(json).toContain('https://share.example/xyz')
    // Must not leak the other result's copy
    expect(json).not.toContain('RESULT_ES_TITLE')
  })

  it('includes the matched result\'s imageUrl as a hero image when present', () => {
    const msg = renderResultCard(fullCfg, { resultCode: 'ES', shareUrl: 'https://share.example/es' })
    expect(JSON.stringify(msg)).toContain('https://example.com/es.png')
  })
})

describe('renderKeywordText', () => {
  it('draws its text entirely from templateCopy.messages.keywordCard', () => {
    const msg = renderKeywordText(fullCfg)
    expect(msg.type).toBe('text')
    if (msg.type === 'text') {
      expect(msg.text).toContain('KEYWORD_TITLE')
      expect(msg.text).toContain('KEYWORD_BODY')
    }
  })
})

describe('renderKeywordCard', () => {
  it('includes keywordCard copy and the given liffUrl as the CTA target', () => {
    const msg = renderKeywordCard(fullCfg, { liffUrl: 'https://liff.example/abc' })
    const json = JSON.stringify(msg)
    expect(json).toContain('KEYWORD_TITLE')
    expect(json).toContain('KEYWORD_BODY')
    expect(json).toContain('KEYWORD_CTA')
    expect(json).toContain('https://liff.example/abc')
  })
})

describe('renderKeywordCustom', () => {
  it('returns customFlexJson verbatim when present', () => {
    const custom = { type: 'flex', altText: 'CUSTOM_ALT', contents: { type: 'bubble', marker: 'CUSTOM_MARKER_XYZ' } }
    const cfgWithCustom: QuizConfig = {
      ...fullCfg,
      templateCopy: {
        ...fullCfg.templateCopy!,
        messages: {
          ...fullCfg.templateCopy!.messages,
          keywordCard: { ...fullCfg.templateCopy!.messages.keywordCard, customFlexJson: custom },
        },
      },
    }
    const msg = renderKeywordCustom(cfgWithCustom, { liffUrl: 'https://liff.example/abc' })
    expect(msg).toEqual(custom)
  })

  it('falls back to renderKeywordCard\'s output when customFlexJson is absent', () => {
    const msg = renderKeywordCustom(fullCfg, { liffUrl: 'https://liff.example/fallback' })
    expect(msg).toEqual(renderKeywordCard(fullCfg, { liffUrl: 'https://liff.example/fallback' }))
  })
})

describe('renderSoloShareCard', () => {
  it('includes soloShare copy, the matched result\'s title/body/imageUrl', () => {
    const msg = renderSoloShareCard(fullCfg, { resultCode: 'ES' })
    const json = JSON.stringify(msg)
    expect(json).toContain('SOLOSHARE_BADGE')
    expect(json).toContain('SOLOSHARE_CTA')
    expect(json).toContain('SOLOSHARE_CTA2')
    expect(json).toContain('RESULT_ES_TITLE')
    expect(json).toContain('RESULT_ES_BODY')
    expect(json).toContain('https://example.com/es.png')
  })
})

describe('renderDuoInviteCard', () => {
  it('interpolates {axisName} (looked up from cfg.axes by myAxisId) into titleTemplate/bodyTemplate, and uses shareUrl as the CTA target', () => {
    const msg = renderDuoInviteCard(fullCfg, { myAxisId: 'ei', shareUrl: 'https://share.example/invite' })
    const json = JSON.stringify(msg)
    expect(json).toContain('DUOINVITE_TITLE_AXIS_EI_LABEL')
    expect(json).toContain('DUOINVITE_BODY_AXIS_EI_LABEL')
    expect(json).toContain('DUOINVITE_CTA')
    expect(json).toContain('https://share.example/invite')
    // Must not leak the other axis's label
    expect(json).not.toContain('AXIS_SN_LABEL')
  })

  it('looks up a different axis correctly when myAxisId differs', () => {
    const msg = renderDuoInviteCard(fullCfg, { myAxisId: 'sn', shareUrl: 'https://share.example/invite2' })
    expect(JSON.stringify(msg)).toContain('DUOINVITE_TITLE_AXIS_SN_LABEL')
  })
})

describe('renderDuoPartnerAnsweredPush', () => {
  it('includes the runtime partnerName, the partner\'s axis label, and duoPartnerAnswered copy', () => {
    const msg = renderDuoPartnerAnsweredPush(fullCfg, { partnerName: 'PARTNER_DISPLAY_NAME', partnerAxisId: 'sn' })
    const json = JSON.stringify(msg)
    expect(json).toContain('PARTNER_DISPLAY_NAME')
    expect(json).toContain('AXIS_SN_LABEL')
    expect(json).toContain('DUOPARTNER_BADGE')
    expect(json).toContain('DUOPARTNER_CTA')
  })
})

describe('renderDuoPairResultCard', () => {
  it('includes the matched result copy, the runtime heroImageUrl, and an interpolated rank line', () => {
    const msg = renderDuoPairResultCard(fullCfg, { resultCode: 'IN', heroImageUrl: 'https://hero.example/composited.png', rank: 3 })
    const json = JSON.stringify(msg)
    expect(json).toContain('RESULT_IN_TITLE')
    expect(json).toContain('RESULT_IN_BODY')
    expect(json).toContain('DUOPAIR_BADGE')
    expect(json).toContain('DUOPAIR_RANK_3')
    expect(json).toContain('DUOPAIR_CTA')
    expect(json).toContain('https://hero.example/composited.png')
  })
})

describe('renderDuoReminderPush', () => {
  it('interpolates {hours} into headlineTemplate', () => {
    const msg = renderDuoReminderPush(fullCfg, { hoursSinceInvite: 12 })
    const json = JSON.stringify(msg)
    expect(json).toContain('DUOREMIND_BADGE')
    expect(json).toContain('DUOREMIND_HEADLINE_12')
    expect(json).toContain('DUOREMIND_CTA')
  })
})

describe('renderGroupCompletePush', () => {
  it('looks up the archetype by archetypeCode and includes its title/body/imageUrl plus groupComplete copy and memberCount', () => {
    const msg = renderGroupCompletePush(fullCfg, { archetypeCode: 'ARCH1', memberCount: 4 })
    const json = JSON.stringify(msg)
    expect(json).toContain('ARCH1_TITLE')
    expect(json).toContain('ARCH1_BODY')
    expect(json).toContain('https://example.com/arch1.png')
    expect(json).toContain('GROUPCOMPLETE_BADGE')
    expect(json).toContain('GROUPCOMPLETE_CTA')
    expect(json).toContain('4')
  })
})

describe('renderGroupUnlockPush', () => {
  it('interpolates the unlocked archetype\'s title into headlineTemplate', () => {
    const msg = renderGroupUnlockPush(fullCfg, { archetypeCode: 'ARCH1' })
    const json = JSON.stringify(msg)
    expect(json).toContain('GROUPUNLOCK_HEADLINE_ARCH1_TITLE')
    expect(json).toContain('GROUPUNLOCK_CTA')
  })
})

describe('renderGroupReminderPush', () => {
  it('interpolates {current}/{remaining} into headlineTemplate and includes subText', () => {
    const msg = renderGroupReminderPush(fullCfg, { currentMembers: 3, remaining: 2 })
    const json = JSON.stringify(msg)
    expect(json).toContain('GROUPREMIND_BADGE')
    expect(json).toContain('GROUPREMIND_HEADLINE_3_2')
    expect(json).toContain('GROUPREMIND_SUBTEXT')
    expect(json).toContain('GROUPREMIND_CTA')
  })
})

describe('renderGroupInviteCard', () => {
  it('shows each present member\'s axis label and interpolates the incomplete header when archetype is not yet computed', () => {
    const msg = renderGroupInviteCard(fullCfg, { members: [{ axisId: 'ei' }, { axisId: 'sn' }], maxMembers: 4 })
    const json = JSON.stringify(msg)
    expect(json).toContain('GROUPINVITE_INCOMPLETE_2_4')
    expect(json).toContain('GROUPINVITE_BODY')
    expect(json).toContain('GROUPINVITE_CTA')
    expect(json).toContain('GROUPINVITE_CTA2')
    expect(json).toContain('AXIS_EI_LABEL')
    expect(json).toContain('AXIS_SN_LABEL')
    // 2 open slots (4 max - 2 present) rendered as the generic placeholder
    expect((json.match(/"\?"/g) ?? []).length).toBe(2)
    expect(json).not.toContain('GROUPINVITE_COMPLETE')
  })

  it('shows the complete header (interpolating the archetype title) once archetypeCode is given', () => {
    const msg = renderGroupInviteCard(fullCfg, { members: [{ axisId: 'ei' }, { axisId: 'sn' }], maxMembers: 2, archetypeCode: 'ARCH1' })
    const json = JSON.stringify(msg)
    expect(json).toContain('GROUPINVITE_COMPLETE_ARCH1_TITLE')
    expect(json).not.toContain('GROUPINVITE_INCOMPLETE')
    // all slots filled: no "?" placeholders
    expect((json.match(/"\?"/g) ?? []).length).toBe(0)
  })
})
