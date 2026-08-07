import { describe, expect, it } from 'vitest'
import { drawNine } from '../game/draw'
import { decodeAction } from '../game/postback'
import { seededRng } from '../test-utils/rng'
import type { FlexBox } from './types'
import { GRID_ALT_TEXT, buildGridCard } from './grid'

const fortunes = drawNine(seededRng(11))
const card = buildGridCard(fortunes)
const rows = (card.contents.body as FlexBox).contents as FlexBox[]
const tiles = rows.flatMap((row) => row.contents as FlexBox[])

describe('buildGridCard', () => {
  it('is a flex message with the grid alt text', () => {
    expect(card.type).toBe('flex')
    expect(card.altText).toBe(GRID_ALT_TEXT)
  })

  it('lays out three rows of three tiles', () => {
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.layout).toBe('horizontal')
      expect(row.contents).toHaveLength(3)
    }
  })

  it('gives every tile a postback action carrying its own fortune id', () => {
    const decoded = tiles.map((tile) => decodeAction(tile.action!.data))
    expect(decoded).toEqual(fortunes.map((fortune) => ({ kind: 'open', fortuneId: fortune.id })))
  })

  it('numbers the tiles one through nine in the display text', () => {
    expect(tiles.map((tile) => tile.action!.displayText)).toEqual([
      'ทุบคุกกี้ชิ้นที่ 1',
      'ทุบคุกกี้ชิ้นที่ 2',
      'ทุบคุกกี้ชิ้นที่ 3',
      'ทุบคุกกี้ชิ้นที่ 4',
      'ทุบคุกกี้ชิ้นที่ 5',
      'ทุบคุกกี้ชิ้นที่ 6',
      'ทุบคุกกี้ชิ้นที่ 7',
      'ทุบคุกกี้ชิ้นที่ 8',
      'ทุบคุกกี้ชิ้นที่ 9',
    ])
  })

  it('makes every tile equal width so the grid stays square on any screen', () => {
    for (const tile of tiles) {
      expect(tile.flex).toBe(1)
    }
  })

  it('never leaks the fortune text into the unopened grid', () => {
    const serialised = JSON.stringify(card)
    for (const fortune of fortunes) {
      expect(serialised).not.toContain(fortune.text)
    }
  })
})
