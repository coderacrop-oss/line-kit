// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FriendGate } from './FriendGate'

afterEach(cleanup)

const friendGate = {
  title: 'MARKER_GATE_TITLE',
  body: 'MARKER_GATE_BODY',
  ctaLabel: 'MARKER_ADD_FRIEND_CTA',
}

describe('FriendGate', () => {
  it('renders title, body, and cta label from props', () => {
    const { getByText } = render(<FriendGate friendGate={friendGate} />)

    expect(getByText('MARKER_GATE_TITLE')).toBeTruthy()
    expect(getByText('MARKER_GATE_BODY')).toBeTruthy()
    expect(getByText('MARKER_ADD_FRIEND_CTA')).toBeTruthy()
  })

  it('calls onContinue when the cta button is clicked', () => {
    const onContinue = vi.fn()
    const { getByText } = render(<FriendGate friendGate={friendGate} onContinue={onContinue} />)

    fireEvent.click(getByText('MARKER_ADD_FRIEND_CTA'))

    expect(onContinue).toHaveBeenCalledTimes(1)
  })
})
