import { NEW_GAME_DATA } from '../game/postback'
import { COLORS } from './theme'
import type { FlexMessage } from './types'

export const WELCOME_ALT_TEXT = 'ยินดีต้อนรับสู่คุกกี้เสี่ยงทาย'
export const HINT_ALT_TEXT = 'พิมพ์ว่า เสี่ยงทาย เพื่อเริ่มเล่น'

export function buildWelcomeCard(): FlexMessage {
  return buildPromptCard(
    WELCOME_ALT_TEXT,
    'ยินดีต้อนรับ 🥠',
    'กดปุ่มด้านล่าง หรือพิมพ์ว่า "เสี่ยงทาย" แล้วเลือกคุกกี้ 1 ชิ้นจากตาราง 9 ช่อง เล่นได้ไม่จำกัด',
  )
}

export function buildHintCard(): FlexMessage {
  return buildPromptCard(
    HINT_ALT_TEXT,
    'อยากรู้ดวงไหม? 🥠',
    'พิมพ์ว่า "เสี่ยงทาย" หรือกดปุ่มด้านล่างได้เลย',
  )
}

function buildPromptCard(altText: string, title: string, body: string): FlexMessage {
  return {
    type: 'flex',
    altText,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        backgroundColor: COLORS.cream,
        contents: [
          { type: 'text', text: title, size: 'lg', weight: 'bold', color: COLORS.ink, wrap: true },
          { type: 'text', text: body, size: 'sm', color: COLORS.muted, wrap: true, margin: 'md' },
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
              label: 'เสี่ยงทายเลย',
              data: NEW_GAME_DATA,
              displayText: 'เสี่ยงทายเลย',
            },
          },
        ],
      },
    },
  }
}
