// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Group } from './Group'
import type { GroupMemberSlot } from './Group'

afterEach(cleanup)

const members: GroupMemberSlot[] = [
  { participantId: 'p1', displayName: 'MARKER_MEMBER_ONE', axisLabel: 'MARKER_AXIS_ONE' },
  { participantId: 'p2', displayName: 'MARKER_MEMBER_TWO', axisLabel: 'MARKER_AXIS_TWO' },
]

describe('Group', () => {
  it('renders each present member displayName and axisLabel', () => {
    const { getByText } = render(<Group members={members} maxMembers={4} />)

    expect(getByText('MARKER_MEMBER_ONE')).toBeTruthy()
    expect(getByText('MARKER_AXIS_ONE')).toBeTruthy()
    expect(getByText('MARKER_MEMBER_TWO')).toBeTruthy()
    expect(getByText('MARKER_AXIS_TWO')).toBeTruthy()
  })

  it('shows a generic "?" placeholder for every open slot up to maxMembers', () => {
    const { getAllByText } = render(<Group members={members} maxMembers={5} />)

    // 5 max - 2 present members = 3 open slots
    expect(getAllByText('?')).toHaveLength(3)
  })

  it('shows no open-slot placeholders when the group is full', () => {
    const { queryAllByText } = render(<Group members={members} maxMembers={2} />)

    expect(queryAllByText('?')).toHaveLength(0)
  })

  it('renders the archetype title/body when provided, and nothing when omitted', () => {
    const { getByText, queryByText, rerender } = render(
      <Group
        members={members}
        maxMembers={4}
        archetype={{ title: 'MARKER_ARCHETYPE_TITLE', body: 'MARKER_ARCHETYPE_BODY' }}
      />,
    )
    expect(getByText('MARKER_ARCHETYPE_TITLE')).toBeTruthy()
    expect(getByText('MARKER_ARCHETYPE_BODY')).toBeTruthy()

    rerender(<Group members={members} maxMembers={4} />)
    expect(queryByText('MARKER_ARCHETYPE_TITLE')).toBeNull()
  })

  it('calls onInvite when the invite control is clicked', () => {
    const onInvite = vi.fn()
    const { getByText } = render(
      <Group members={members} maxMembers={4} onInvite={onInvite} />,
    )

    fireEvent.click(getByText('+'))

    expect(onInvite).toHaveBeenCalledTimes(1)
  })
})
