import type { Layer } from './composition'

/**
 * แก้ไขอาเรย์ของชั้น — ล้วนเป็นฟังก์ชันบริสุทธิ์ คืนอาเรย์ใหม่เสมอ ไม่แก้ต้นฉบับ
 * ไม่สร้าง id เอง (id/สุ่มเลขมาจากผู้เรียกเสมอ) เพื่อให้ทดสอบได้แบบกำหนดผลลัพธ์
 * ล่วงหน้าได้ — ไฟล์นี้ไม่มีทางสุ่มเองได้อยู่แล้วเพราะสภาพแวดล้อมของ workflow ห้าม
 * Math.random()/Date.now() แต่ก็เป็นทางที่ถูกอยู่ดีแม้นอก workflow — ลำดับในอาเรย์
 * คือลำดับชั้น (ต้นอาเรย์ = ล่างสุด) ดู lib/richmenu/composition.ts
 */

/** เพิ่มชั้นใหม่ไว้บนสุด (ท้ายอาเรย์) — ไม่ว่าจะเป็นภาพหรือข้อความก็เพิ่มแบบเดียวกัน */
export function addLayer(layers: readonly Layer[], layer: Layer): Layer[] {
  return [...layers, layer]
}

/**
 * ทำสำเนาชั้นหนึ่งชั้น วางไว้เหนือต้นฉบับทันที (z-order ติดกัน) ขยับตำแหน่งเยื้อง
 * เล็กน้อยกันสองชั้นซ้อนทับเป๊ะจนแยกไม่ออกว่ามีสำเนาเกิดขึ้นจริง
 */
export function duplicateLayer(layers: readonly Layer[], id: string, newId: string, offset = 24): Layer[] {
  const index = layers.findIndex((l) => l.id === id)
  if (index === -1) return [...layers]
  const original = layers[index]
  const copy: Layer = { ...original, id: newId, x: original.x + offset, y: original.y + offset }
  return [...layers.slice(0, index + 1), copy, ...layers.slice(index + 1)]
}

export function deleteLayer(layers: readonly Layer[], id: string): Layer[] {
  return layers.filter((l) => l.id !== id)
}

export type StackMove = 'up' | 'down' | 'front' | 'back'

/** ย้ายลำดับชั้นหนึ่งชั้นในกองซ้อน — 'up'/'down' สลับกับเพื่อนบ้านหนึ่งขั้น 'front'/'back' ไปสุดกอง */
export function moveLayerInStack(layers: readonly Layer[], id: string, move: StackMove): Layer[] {
  const index = layers.findIndex((l) => l.id === id)
  if (index === -1) return [...layers]
  const next = [...layers]

  if (move === 'front') {
    const [item] = next.splice(index, 1)
    next.push(item)
    return next
  }
  if (move === 'back') {
    const [item] = next.splice(index, 1)
    next.unshift(item)
    return next
  }

  const target = move === 'up' ? index + 1 : index - 1
  if (target < 0 || target >= next.length) return next
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/** เขียนทับตำแหน่ง/ขนาดของชั้นหนึ่งชั้น — จุดที่ commit ผลของการลาก/ปรับขนาดจาก lib/richmenu/gesture.ts */
export function updateLayerBox(
  layers: readonly Layer[], id: string, box: { x: number; y: number; width: number; height: number },
): Layer[] {
  return layers.map((l) => (l.id === id ? { ...l, ...box } : l))
}

/** แก้เนื้อหาของชั้นข้อความ (พิมพ์ตัวอักษร/เปลี่ยนสี/ตัวหนา ฯลฯ) — ไม่แตะชั้นภาพ */
export function updateTextLayer(
  layers: readonly Layer[], id: string, patch: Partial<Omit<Extract<Layer, { type: 'text' }>, 'id' | 'type'>>,
): Layer[] {
  return layers.map((l) => (l.id === id && l.type === 'text' ? { ...l, ...patch } : l))
}
