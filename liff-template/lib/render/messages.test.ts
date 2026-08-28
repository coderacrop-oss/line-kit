import { describe, expect, it } from 'vitest'
import {
  interpolate,
  renderFollowMessage,
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
