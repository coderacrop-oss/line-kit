import { describe, expect, it } from 'vitest'
import type { ImageLayer, Layer, TextLayer } from './composition'
import {
  addLayer, deleteLayer, duplicateLayer, moveLayerInStack, updateLayerBox, updateTextLayer,
} from './layers'

const image = (id: string, patch: Partial<ImageLayer> = {}): ImageLayer => ({
  id, type: 'image', assetId: `asset-${id}`, fit: 'cover', x: 0, y: 0, width: 100, height: 100, ...patch,
})

const text = (id: string, patch: Partial<TextLayer> = {}): TextLayer => ({
  id, type: 'text', text: 'ข้อความ', fontSize: 20, color: '#000000', align: 'left', bold: false,
  x: 0, y: 0, width: 100, height: 40, ...patch,
})

describe('addLayer', () => {
  it('เพิ่มไว้ท้ายอาเรย์เสมอ — บนสุดของกองซ้อน', () => {
    const layers = addLayer([image('a')], text('b'))
    expect(layers.map((l) => l.id)).toEqual(['a', 'b'])
  })

  it('ไม่แก้อาเรย์ต้นฉบับ', () => {
    const original: Layer[] = [image('a')]
    addLayer(original, text('b'))
    expect(original).toHaveLength(1)
  })
})

describe('duplicateLayer', () => {
  it('สำเนาอยู่ติดกับต้นฉบับทันที ในลำดับที่สูงกว่าหนึ่งขั้น', () => {
    const layers = duplicateLayer([image('a'), text('b')], 'a', 'a-copy')
    expect(layers.map((l) => l.id)).toEqual(['a', 'a-copy', 'b'])
  })

  it('ตำแหน่งเยื้องจากต้นฉบับ ไม่ซ้อนทับเป๊ะ', () => {
    const layers = duplicateLayer([image('a', { x: 10, y: 20 })], 'a', 'a-copy', 24)
    const copy = layers.find((l) => l.id === 'a-copy')
    expect(copy).toMatchObject({ x: 34, y: 44 })
  })

  it('id ต้นฉบับที่ไม่มีอยู่จริง — คืนอาเรย์เดิม ไม่มีอะไรเกิดขึ้น', () => {
    const layers = duplicateLayer([image('a')], 'ghost', 'new-id')
    expect(layers).toHaveLength(1)
  })

  it('ชนิดของชั้นถูกคัดลอกไปด้วย (ทั้งภาพและข้อความ)', () => {
    const layers = duplicateLayer([text('t', { text: 'สวัสดี' })], 't', 't-copy')
    const copy = layers.find((l) => l.id === 't-copy')
    expect(copy).toMatchObject({ type: 'text', text: 'สวัสดี' })
  })
})

describe('deleteLayer', () => {
  it('ลบชั้นที่ระบุ เหลือที่เหลือครบ', () => {
    const layers = deleteLayer([image('a'), text('b'), image('c')], 'b')
    expect(layers.map((l) => l.id)).toEqual(['a', 'c'])
  })

  it('id ที่ไม่มีอยู่จริง ไม่ลบอะไรเลย', () => {
    const layers = deleteLayer([image('a')], 'ghost')
    expect(layers).toHaveLength(1)
  })
})

describe('moveLayerInStack', () => {
  const stack = () => [image('a'), image('b'), image('c'), image('d')]

  it('up — สลับกับชั้นที่อยู่สูงกว่าหนึ่งขั้น', () => {
    expect(moveLayerInStack(stack(), 'b', 'up').map((l) => l.id)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('down — สลับกับชั้นที่อยู่ต่ำกว่าหนึ่งขั้น', () => {
    expect(moveLayerInStack(stack(), 'c', 'down').map((l) => l.id)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('up ที่ชั้นบนสุดอยู่แล้ว — ไม่มีอะไรเปลี่ยน (ไม่มีที่ให้ขยับขึ้นอีก)', () => {
    expect(moveLayerInStack(stack(), 'd', 'up').map((l) => l.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('down ที่ชั้นล่างสุดอยู่แล้ว — ไม่มีอะไรเปลี่ยน', () => {
    expect(moveLayerInStack(stack(), 'a', 'down').map((l) => l.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('front — ไปอยู่บนสุดของกองซ้อนทันที ไม่ว่าจะเริ่มจากตรงไหน', () => {
    expect(moveLayerInStack(stack(), 'a', 'front').map((l) => l.id)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('back — ไปอยู่ล่างสุดของกองซ้อนทันที', () => {
    expect(moveLayerInStack(stack(), 'd', 'back').map((l) => l.id)).toEqual(['d', 'a', 'b', 'c'])
  })

  it('id ที่ไม่มีอยู่จริง — คืนอาเรย์เดิม', () => {
    expect(moveLayerInStack(stack(), 'ghost', 'up').map((l) => l.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('updateLayerBox', () => {
  it('เขียนทับ x/y/width/height ของชั้นที่ระบุเท่านั้น', () => {
    const layers = updateLayerBox([image('a'), image('b')], 'a', { x: 5, y: 6, width: 7, height: 8 })
    expect(layers[0]).toMatchObject({ x: 5, y: 6, width: 7, height: 8 })
    expect(layers[1]).toEqual(image('b'))
  })

  it('ไม่แตะฟิลด์อื่นของชั้นที่แก้ (assetId/fit ยังอยู่ครบ)', () => {
    const layers = updateLayerBox([image('a', { assetId: 'keep-me' })], 'a', { x: 1, y: 1, width: 1, height: 1 })
    expect(layers[0]).toMatchObject({ assetId: 'keep-me', fit: 'cover' })
  })
})

describe('updateTextLayer', () => {
  it('แก้เนื้อหาของชั้นข้อความที่ระบุ', () => {
    const layers = updateTextLayer([text('t')], 't', { text: 'ใหม่', color: '#ff0000' })
    expect(layers[0]).toMatchObject({ text: 'ใหม่', color: '#ff0000' })
  })

  it('ชั้นภาพไม่ถูกแตะแม้ id จะตรงกันโดยบังเอิญ (ชนิดไม่ตรง)', () => {
    const layers = updateTextLayer([image('shared')], 'shared', { text: 'ไม่ควรมีผล' } as never)
    expect(layers[0]).toEqual(image('shared'))
  })
})
