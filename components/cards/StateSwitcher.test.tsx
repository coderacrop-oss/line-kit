// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StateSwitcher, type StateSwitcherProps } from './StateSwitcher'
import type { PlayerState } from '@/lib/state'

afterEach(cleanup)

/**
 * StateSwitcher เป็น controlled component ล้วน — ไม่มี state ของตัวเอง (PreviewPanel
 * เป็นคนถือ state จริง) การเพิ่มแถวใหม่แล้วพิมพ์ต่อในแถวนั้นทันทีจึงต้องมีอะไรสัก
 * อย่างคอย re-render ด้วย state ใหม่ให้ เหมือนที่การใช้งานจริงจะเป็น — harness นี้คือ
 * ตัวนั้น พร้อม spy ที่บันทึกทุกครั้งที่ onChange ถูกเรียกไว้ให้เทสต์ตรวจ
 */
function Harness(
  props: Omit<StateSwitcherProps, 'state' | 'onChange'> & { initial: PlayerState; spy: (s: PlayerState) => void },
) {
  const { initial, spy, ...rest } = props
  const [state, setState] = useState(initial)
  return (
    <StateSwitcher
      {...rest}
      state={state}
      onChange={(next) => { spy(next); setState(next) }}
    />
  )
}

/**
 * ห้าเรื่องที่ Condition (lib/state.ts) อ้างถึงได้ — attribute · counter · entitlement ·
 * play count · completed — สวิตช์นี้ต้องปรับได้ครบทั้งห้า ไม่ใช่แค่ entitlement ตัวเดียว
 * ตามเทสต์ตัวอย่างในแผน (บรรทัด 1841–1853)
 */

const emptyState: PlayerState = {
  attributes: {}, counters: {}, entitlements: [], playCounts: {}, completed: [],
}

const baseProps = {
  rewardCodes: ['gold', 'silver'],
  activities: [{ code: 'quiz', name: 'ตอบคำถาม' }, { code: 'draw', name: 'สุ่มรางวัล' }],
  counterCodes: ['checkin_days'],
}

describe('StateSwitcher · attributes', () => {
  it('เพิ่มแถวค่าประจำตัวใหม่แล้วกรอกคีย์กับค่า ยิง onChange ที่มีคีย์นั้น', () => {
    const spy = vi.fn()
    const { container } = render(<Harness {...baseProps} initial={emptyState} spy={spy} />)

    fireEvent.click(container.querySelector('[data-add-attribute]')!)
    const keyInput = container.querySelector('[data-attr-row="0"] input[name="key"]') as HTMLInputElement
    fireEvent.change(keyInput, { target: { value: 'name' } })

    const lastState = spy.mock.calls.at(-1)![0] as PlayerState
    expect(lastState.attributes).toEqual({ name: '' })
  })

  it('มีแถวอยู่แล้ว แก้ค่าแล้ว onChange ได้ state ใหม่ที่ค่าตรง', () => {
    const onChange = vi.fn()
    const withAttr = { ...emptyState, attributes: { name: 'มีนา' } }
    const { container } = render(<StateSwitcher {...baseProps} state={withAttr} onChange={onChange} />)

    const valueInput = container.querySelector('[data-attr-row="name"] input[name="value"]') as HTMLInputElement
    fireEvent.change(valueInput, { target: { value: 'จอย' } })

    expect(onChange).toHaveBeenCalledWith({ ...withAttr, attributes: { name: 'จอย' } })
  })

  it('ลบแถวค่าประจำตัว คีย์นั้นหายไปจาก attributes', () => {
    const onChange = vi.fn()
    const withAttr = { ...emptyState, attributes: { name: 'มีนา', vip: 'yes' } }
    const { container } = render(<StateSwitcher {...baseProps} state={withAttr} onChange={onChange} />)

    fireEvent.click(container.querySelector('[data-attr-row="name"] [data-remove-row]')!)

    expect(onChange).toHaveBeenCalledWith({ ...withAttr, attributes: { vip: 'yes' } })
  })
})

describe('StateSwitcher · counters', () => {
  it('เพิ่มแถวค่าสะสมแล้วกรอกรหัสกับจำนวน ยิง onChange ที่มีค่าตัวเลข', () => {
    const spy = vi.fn()
    const { container } = render(<Harness {...baseProps} initial={emptyState} spy={spy} />)

    fireEvent.click(container.querySelector('[data-add-counter]')!)
    const keyInput = container.querySelector('[data-counter-row="0"] input[name="key"]') as HTMLInputElement
    fireEvent.change(keyInput, { target: { value: 'checkin_days' } })

    const afterKey = spy.mock.calls.at(-1)![0] as PlayerState
    expect(Object.keys(afterKey.counters)).toEqual(['checkin_days'])
  })

  it('แก้จำนวนของค่าสะสมที่มีอยู่แล้ว ได้ตัวเลขใหม่ ไม่ใช่สตริง', () => {
    const onChange = vi.fn()
    const withCounter = { ...emptyState, counters: { checkin_days: 3 } }
    const { container } = render(<StateSwitcher {...baseProps} state={withCounter} onChange={onChange} />)

    const valueInput = container.querySelector('[data-counter-row="checkin_days"] input[name="value"]') as HTMLInputElement
    fireEvent.change(valueInput, { target: { value: '7' } })

    expect(onChange).toHaveBeenCalledWith({ ...withCounter, counters: { checkin_days: 7 } })
  })

  it('ลบแถวค่าสะสม คีย์นั้นหายไป', () => {
    const onChange = vi.fn()
    const withCounter = { ...emptyState, counters: { checkin_days: 3, food: 1 } }
    const { container } = render(<StateSwitcher {...baseProps} state={withCounter} onChange={onChange} />)

    fireEvent.click(container.querySelector('[data-counter-row="food"] [data-remove-row]')!)

    expect(onChange).toHaveBeenCalledWith({ ...withCounter, counters: { checkin_days: 3 } })
  })
})

describe('StateSwitcher · entitlements (has_entitlement)', () => {
  it('ติ๊กรางวัลที่รู้จักแล้ว entitlements มีรหัสนั้น', () => {
    const onChange = vi.fn()
    const { container } = render(<StateSwitcher {...baseProps} state={emptyState} onChange={onChange} />)

    fireEvent.click(container.querySelector('[data-entitlement-toggle="gold"]')!)

    expect(onChange).toHaveBeenCalledWith({ ...emptyState, entitlements: ['gold'] })
  })

  it('ติ๊กออกแล้วรหัสหายจาก entitlements', () => {
    const onChange = vi.fn()
    const withEnt = { ...emptyState, entitlements: ['gold'] }
    const { container } = render(<StateSwitcher {...baseProps} state={withEnt} onChange={onChange} />)

    fireEvent.click(container.querySelector('[data-entitlement-toggle="gold"]')!)

    expect(onChange).toHaveBeenCalledWith({ ...withEnt, entitlements: [] })
  })

  it('เพิ่มรหัสรางวัลที่ไม่อยู่ในรายการที่รู้จักได้ด้วยช่องกรอกเอง', () => {
    const onChange = vi.fn()
    const { container } = render(<StateSwitcher {...baseProps} state={emptyState} onChange={onChange} />)

    const input = container.querySelector('[data-add-entitlement-input]') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'custom_code' } })
    fireEvent.click(container.querySelector('[data-add-entitlement]')!)

    expect(onChange).toHaveBeenCalledWith({ ...emptyState, entitlements: ['custom_code'] })
  })
})

describe('StateSwitcher · completed (activity_completed / activity_not_completed)', () => {
  it('ติ๊กกิจกรรมที่รู้จักแล้ว completed มีรหัสนั้น', () => {
    const onChange = vi.fn()
    const { container } = render(<StateSwitcher {...baseProps} state={emptyState} onChange={onChange} />)

    fireEvent.click(container.querySelector('[data-completed-toggle="quiz"]')!)

    expect(onChange).toHaveBeenCalledWith({ ...emptyState, completed: ['quiz'] })
  })

  it('ติ๊กออกแล้วรหัสหายจาก completed', () => {
    const onChange = vi.fn()
    const withCompleted = { ...emptyState, completed: ['quiz'] }
    const { container } = render(<StateSwitcher {...baseProps} state={withCompleted} onChange={onChange} />)

    fireEvent.click(container.querySelector('[data-completed-toggle="quiz"]')!)

    expect(onChange).toHaveBeenCalledWith({ ...withCompleted, completed: [] })
  })
})

describe('StateSwitcher · play counts (activity_play_count)', () => {
  it('เพิ่มแถวจำนวนครั้งที่เล่นแล้วกรอกรหัสกิจกรรมกับจำนวน', () => {
    const spy = vi.fn()
    const { container } = render(<Harness {...baseProps} initial={emptyState} spy={spy} />)

    fireEvent.click(container.querySelector('[data-add-playcount]')!)
    const keyInput = container.querySelector('[data-playcount-row="0"] input[name="key"]') as HTMLInputElement
    fireEvent.change(keyInput, { target: { value: 'quiz' } })

    const afterKey = spy.mock.calls.at(-1)![0] as PlayerState
    expect(Object.keys(afterKey.playCounts)).toEqual(['quiz'])
  })

  it('แก้จำนวนครั้งของกิจกรรมที่มีอยู่แล้ว ได้ตัวเลขใหม่', () => {
    const onChange = vi.fn()
    const withPlays = { ...emptyState, playCounts: { quiz: 2 } }
    const { container } = render(<StateSwitcher {...baseProps} state={withPlays} onChange={onChange} />)

    const valueInput = container.querySelector('[data-playcount-row="quiz"] input[name="value"]') as HTMLInputElement
    fireEvent.change(valueInput, { target: { value: '5' } })

    expect(onChange).toHaveBeenCalledWith({ ...withPlays, playCounts: { quiz: 5 } })
  })

  it('ลบแถวจำนวนครั้งที่เล่น รหัสนั้นหายไป', () => {
    const onChange = vi.fn()
    const withPlays = { ...emptyState, playCounts: { quiz: 2, draw: 1 } }
    const { container } = render(<StateSwitcher {...baseProps} state={withPlays} onChange={onChange} />)

    fireEvent.click(container.querySelector('[data-playcount-row="draw"] [data-remove-row]')!)

    expect(onChange).toHaveBeenCalledWith({ ...withPlays, playCounts: { quiz: 2 } })
  })
})
