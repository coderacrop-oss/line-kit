// @vitest-environment jsdom
// app/(admin)/campaigns/[id]/activities/[activityId]/quiz/GroupConfigEditor.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GroupConfigEditor } from './GroupConfigEditor'
import type { GroupConfig, QuizAxis } from '@/lib/quiz/schema'

afterEach(cleanup)

const axes: QuizAxis[] = [{ id: 'ei', label: 'E/I', poles: ['E', 'I'] }, { id: 'sn', label: 'S/N', poles: ['S', 'N'] }]

const fullGroup: GroupConfig = {
  enabled: true, minMembers: 2, maxMembers: 10, resultLocksAt: 0,
  archetypes: [
    { code: 'balanced', title: 'สมดุล', body: 'b', minGroupSize: 2, fallback: false, condition: { hasMode: 'any', topN: 1, dominantThreshold: 0.5, isBalanced: true } },
    { code: 'mixed', title: 'ปนกัน', body: 'b', minGroupSize: 2, fallback: true },
  ],
  fallbackArchetype: 'mixed',
}

describe('GroupConfigEditor', () => {
  it('shows only the enable checkbox when group is undefined', () => {
    render(<GroupConfigEditor group={undefined} axes={axes} canEdit onChange={vi.fn()} />)
    const checkbox = screen.getByLabelText(/เปิดใช้งานผลลัพธ์กลุ่ม/) as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    expect(screen.queryByText(/archetype/i)).toBeNull()
  })

  it('checking the enable box calls onChange with a minimal default GroupConfig', () => {
    const onChange = vi.fn()
    render(<GroupConfigEditor group={undefined} axes={axes} canEdit onChange={onChange} />)
    fireEvent.click(screen.getByLabelText(/เปิดใช้งานผลลัพธ์กลุ่ม/))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }))
  })

  it('renders every archetype row and lets you edit a title', () => {
    const onChange = vi.fn()
    render(<GroupConfigEditor group={fullGroup} axes={axes} canEdit onChange={onChange} />)
    const titleInputs = screen.getAllByDisplayValue(/สมดุล|ปนกัน/)
    expect(titleInputs).toHaveLength(2)
    fireEvent.change(titleInputs[0], { target: { value: 'สมดุลใหม่' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      archetypes: expect.arrayContaining([expect.objectContaining({ title: 'สมดุลใหม่' })]),
    }))
  })

  it('adding an archetype uses a code that does not collide with existing ones', () => {
    const onChange = vi.fn()
    render(<GroupConfigEditor group={fullGroup} axes={axes} canEdit onChange={onChange} />)
    fireEvent.click(screen.getByText('＋ เพิ่ม archetype'))
    const call = onChange.mock.calls[0][0] as GroupConfig
    const codes = call.archetypes.map((a) => a.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('warns when a non-fallback archetype has no condition set (dead entry, never matches)', () => {
    const deadGroup: GroupConfig = {
      ...fullGroup,
      archetypes: [{ code: 'dead', title: 'ตาย', body: 'b', minGroupSize: 2, fallback: false }, fullGroup.archetypes[1]],
    }
    render(<GroupConfigEditor group={deadGroup} axes={axes} canEdit onChange={vi.fn()} />)
    expect(screen.getByText(/ไม่มีเงื่อนไข.*ไม่มีวันถูกใช้/)).toBeDefined()
  })
})
