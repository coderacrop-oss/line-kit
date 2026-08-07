import { GRID_SIZE } from '../game/draw'
import type { Fortune } from '../game/fortunes'
import { encodeOpen } from '../game/postback'
import { COLORS } from './theme'
import type { FlexBox, FlexMessage } from './types'

export const GRID_ALT_TEXT = 'คุกกี้เสี่ยงทาย — แตะเลือกคุกกี้ 1 ชิ้น'

const COLUMNS = 3

export function buildGridCard(fortunes: readonly Fortune[]): FlexMessage {
  if (fortunes.length !== GRID_SIZE) {
    throw new Error(`buildGridCard expects exactly ${GRID_SIZE} fortunes, got ${fortunes.length}`)
  }

  const rows: FlexBox[] = []
  for (let row = 0; row < fortunes.length / COLUMNS; row += 1) {
    rows.push({
      type: 'box',
      layout: 'horizontal',
      spacing: 'md',
      margin: row === 0 ? 'none' : 'md',
      contents: fortunes
        .slice(row * COLUMNS, row * COLUMNS + COLUMNS)
        .map((fortune, column) => buildTile(fortune, row * COLUMNS + column)),
    })
  }

  return {
    type: 'flex',
    altText: GRID_ALT_TEXT,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        backgroundColor: COLORS.accent,
        contents: [
          { type: 'text', text: '🥠 คุกกี้เสี่ยงทาย', weight: 'bold', size: 'lg', color: COLORS.white },
          { type: 'text', text: 'แตะเลือกคุกกี้ 1 ชิ้น', size: 'sm', color: COLORS.white, margin: 'sm' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        backgroundColor: COLORS.cream,
        contents: rows,
      },
    },
  }
}

function buildTile(fortune: Fortune, index: number): FlexBox {
  return {
    type: 'box',
    layout: 'vertical',
    flex: 1,
    height: '64px',
    backgroundColor: COLORS.tile,
    borderColor: COLORS.tileBorder,
    borderWidth: '1px',
    cornerRadius: '12px',
    justifyContent: 'center',
    alignItems: 'center',
    action: {
      type: 'postback',
      label: `คุกกี้ ${index + 1}`,
      data: encodeOpen(fortune.id),
      displayText: `ทุบคุกกี้ชิ้นที่ ${index + 1}`,
    },
    contents: [
      { type: 'text', text: '🥠', size: 'xxl', align: 'center' },
      { type: 'text', text: String(index + 1), size: 'xxs', color: COLORS.muted, align: 'center' },
    ],
  }
}
