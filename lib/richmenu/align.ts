import type { Rect } from './gesture'

/**
 * ปุ่มจัดแนวหกทิศของแถบเครื่องมือ — จัดชั้นที่เลือกอยู่ให้ชิดขอบ/กึ่งกลางของผืนภาพ
 * ทั้งใบ ไม่ใช่จัดเทียบกับชั้นอื่น (จอนี้ยังไม่มีเลือกได้หลายชั้นพร้อมกัน) ขนาดของ
 * ชั้นไม่เปลี่ยนเลย เปลี่ยนแค่ x หรือ y ค่าเดียว
 */
export const ALIGN_DIRECTIONS = ['left', 'center-h', 'right', 'top', 'center-v', 'bottom'] as const
export type AlignDirection = (typeof ALIGN_DIRECTIONS)[number]

export function alignLayer(box: Rect, canvas: { width: number; height: number }, direction: AlignDirection): Rect {
  switch (direction) {
    case 'left':
      return { ...box, x: 0 }
    case 'center-h':
      return { ...box, x: (canvas.width - box.width) / 2 }
    case 'right':
      return { ...box, x: canvas.width - box.width }
    case 'top':
      return { ...box, y: 0 }
    case 'center-v':
      return { ...box, y: (canvas.height - box.height) / 2 }
    case 'bottom':
      return { ...box, y: canvas.height - box.height }
  }
}
