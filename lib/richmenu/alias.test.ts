import { describe, expect, it } from 'vitest'
import { danglingSwitchTargets, menuIdsTargetedBySwitch, menusNeedingAlias } from './alias'

const menu = (id: string, alias: string, areas: Array<{ kind: string; target: string | null }> = []) =>
  ({ id, alias, areas: areas as never })

describe('menuIdsTargetedBySwitch', () => {
  it('ไม่มีปุ่มสลับแท็บเลย → เซตว่าง', () => {
    const menus = [menu('a', 'main', [{ kind: 'url', target: 'https://x.example' }])]
    expect(menuIdsTargetedBySwitch(menus)).toEqual(new Set())
  })

  it('รวบรวม id ที่ถูกช่อง menu ชี้ถึง ข้ามซ้ำ', () => {
    const menus = [
      menu('a', 'main', [{ kind: 'menu', target: 'b' }, { kind: 'menu', target: 'b' }]),
      menu('b', 'promo', [{ kind: 'menu', target: 'a' }]),
      menu('c', 'other', []),
    ]
    expect(menuIdsTargetedBySwitch(menus)).toEqual(new Set(['b', 'a']))
  })
})

describe('menusNeedingAlias · §4.4 ขั้น 5b (BR-77)', () => {
  it('ไม่มีปุ่มสลับแท็บชี้มาเลย → ไม่ต้องลงทะเบียนใครเลย', () => {
    const menus = [menu('a', 'main', []), menu('b', 'promo', [])]
    expect(menusNeedingAlias(menus)).toEqual([])
  })

  it('เฉพาะเมนูที่ถูกชี้ถึง ไม่ใช่ทุกเมนูในแคมเปญ', () => {
    const menus = [
      menu('a', 'main', [{ kind: 'menu', target: 'b' }]),
      menu('b', 'promo', []),
      menu('c', 'untouched', []),
    ]
    const needed = menusNeedingAlias(menus)
    expect(needed.map((m) => m.id)).toEqual(['b'])
  })

  it('เมนูที่ชี้ไปหาตัวเองก็นับ — ปุ่มสลับกลับมาแท็บเดิมยังต้องมี alias ใช้ได้จริง', () => {
    const menus = [menu('a', 'main', [{ kind: 'menu', target: 'a' }])]
    expect(menusNeedingAlias(menus).map((m) => m.id)).toEqual(['a'])
  })
})

describe('danglingSwitchTargets', () => {
  it('ทุกปุ่มชี้ไปเมนูที่มีจริง → ไม่มีรายการค้าง', () => {
    const menus = [
      menu('a', 'main', [{ kind: 'menu', target: 'b' }]),
      menu('b', 'promo', []),
    ]
    expect(danglingSwitchTargets(menus)).toEqual([])
  })

  it('ปุ่มชี้ไปเมนูที่ไม่มีอยู่จริง (ถูกลบไปแล้ว หรือยังไม่ได้สร้าง) → ติดรายการ (ERR-036)', () => {
    const menus = [menu('a', 'main', [{ kind: 'menu', target: 'ghost' }])]
    expect(danglingSwitchTargets(menus)).toEqual(['ghost'])
  })

  it('ไม่นับช่องที่ไม่ใช่ kind menu แม้ target จะบังเอิญตรงกับ id ที่ไม่มีอยู่', () => {
    const menus = [menu('a', 'main', [{ kind: 'url', target: 'ghost' }])]
    expect(danglingSwitchTargets(menus)).toEqual([])
  })
})
