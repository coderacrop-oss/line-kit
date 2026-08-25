// @vitest-environment jsdom
// app/(admin)/campaigns/[id]/activities/[activityId]/quiz/GroupConfigEditor.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GroupConfigEditor } from './GroupConfigEditor'
import { GroupConfig as GroupConfigSchema, type GroupConfig, type QuizAxis } from '@/lib/quiz/schema'

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
    const defaultGroup = onChange.mock.calls[0][0] as GroupConfig
    expect(GroupConfigSchema.safeParse(defaultGroup).success).toBe(true)
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

  it('renders the archetype imageUrl field with the current value and lets you edit it', () => {
    const onChange = vi.fn()
    const groupWithImage: GroupConfig = {
      ...fullGroup,
      archetypes: [
        { ...fullGroup.archetypes[0], imageUrl: 'https://example.com/balanced.png' },
        fullGroup.archetypes[1],
      ],
    }
    render(<GroupConfigEditor group={groupWithImage} axes={axes} canEdit onChange={onChange} />)
    const imageInput = screen.getByDisplayValue('https://example.com/balanced.png') as HTMLInputElement
    fireEvent.change(imageInput, { target: { value: 'https://example.com/new.png' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      archetypes: expect.arrayContaining([expect.objectContaining({ imageUrl: 'https://example.com/new.png' })]),
    }))
  })

  it('gives each conditioned archetype row distinct condition-field ids (no DOM id collisions)', () => {
    const twoConditionedGroup: GroupConfig = {
      enabled: true, minMembers: 2, maxMembers: 10, resultLocksAt: 0,
      archetypes: [
        { code: 'a', title: 'A', body: 'b', minGroupSize: 2, fallback: false, condition: { hasMode: 'any', topN: 1, dominantThreshold: 0.5, isBalanced: true } },
        { code: 'b', title: 'B', body: 'b', minGroupSize: 2, fallback: false, condition: { hasMode: 'all', topN: 2, dominantThreshold: 0.6, hasAxes: ['ei'] } },
        { code: 'c', title: 'C', body: 'b', minGroupSize: 2, fallback: true },
      ],
      fallbackArchetype: 'c',
    }
    render(<GroupConfigEditor group={twoConditionedGroup} axes={axes} canEdit onChange={vi.fn()} />)
    const hasAxesInputs = document.querySelectorAll('input[id^="cond-has-axes"]')
    expect(hasAxesInputs).toHaveLength(2)
    const ids = Array.from(hasAxesInputs).map((el) => el.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(document.getElementById('cond-has-axes-0')).not.toBeNull()
    expect(document.getElementById('cond-has-axes-1')).not.toBeNull()
  })

  it('unchecking "enable group" on an already-configured group flips enabled without discarding archetypes', () => {
    const onChange = vi.fn()
    render(<GroupConfigEditor group={fullGroup} axes={axes} canEdit onChange={onChange} />)
    fireEvent.click(screen.getByLabelText(/เปิดใช้งานผลลัพธ์กลุ่ม/))
    expect(onChange).toHaveBeenCalledWith({ ...fullGroup, enabled: false })
  })
})
