// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Rewards } from './Rewards'
import type { RewardMilestone } from '../../lib/schema'

afterEach(cleanup)

const milestones: RewardMilestone[] = [
  { key: 'm1', label: 'MARKER_MILESTONE_ONE', icon: '🎉', triggerCount: 1 },
  { key: 'm2', label: 'MARKER_MILESTONE_TWO', triggerCount: 5 },
]

describe('Rewards', () => {
  it('renders every milestone label from props', () => {
    const { getByText } = render(<Rewards milestones={milestones} claimed={[]} />)

    expect(getByText('MARKER_MILESTONE_ONE')).toBeTruthy()
    expect(getByText('MARKER_MILESTONE_TWO')).toBeTruthy()
  })

  it('marks a milestone whose key is in claimed as claimed, others as locked', () => {
    const { getAllByText } = render(<Rewards milestones={milestones} claimed={['m1']} />)

    const claimedLabels = getAllByText('Claimed')
    const lockedLabels = getAllByText('Locked')
    expect(claimedLabels).toHaveLength(1)
    expect(lockedLabels).toHaveLength(1)
  })
})
