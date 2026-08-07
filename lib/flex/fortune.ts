import type { Fortune } from '../game/fortunes'
import { NEW_GAME_DATA } from '../game/postback'
import { COLORS, TONE_STYLE } from './theme'
import type { FlexMessage } from './types'

export function fortuneAltText(fortune: Fortune): string {
  return `คำทำนายของคุณ: ${fortune.text}`
}

export function buildFortuneCard(fortune: Fortune): FlexMessage {
  const tone = TONE_STYLE[fortune.tone]

  return {
    type: 'flex',
    altText: fortuneAltText(fortune),
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        backgroundColor: COLORS.cream,
        contents: [{ type: 'text', text: tone.label, size: 'sm', weight: 'bold', color: tone.color }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        backgroundColor: COLORS.cream,
        contents: [
          { type: 'text', text: '🥠', size: 'xxl', align: 'center' },
          {
            type: 'text',
            text: fortune.text,
            size: 'lg',
            color: COLORS.ink,
            align: 'center',
            wrap: true,
            margin: 'lg',
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        backgroundColor: COLORS.cream,
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: COLORS.accent,
            height: 'sm',
            action: {
              type: 'postback',
              label: 'เสี่ยงใหม่อีกครั้ง',
              data: NEW_GAME_DATA,
              displayText: 'เสี่ยงใหม่อีกครั้ง',
            },
          },
        ],
      },
    },
  }
}
