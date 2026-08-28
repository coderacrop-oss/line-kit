// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Invited } from './Invited'

afterEach(cleanup)

const invite = {
  shareTitle: 'MARKER_SHARE_TITLE',
  shareBodyTemplate: 'MARKER_BODY_PREFIX {inviterName} MARKER_BODY_SUFFIX',
}

describe('Invited · duo', () => {
  it('renders invite.shareTitle and interpolates inviterDisplayName into shareBodyTemplate', () => {
    const { getByText } = render(
      <Invited inviterDisplayName="MARKER_INVITER_NAME" invite={invite} />,
    )

    expect(getByText('MARKER_SHARE_TITLE')).toBeTruthy()
    expect(
      getByText('MARKER_BODY_PREFIX MARKER_INVITER_NAME MARKER_BODY_SUFFIX'),
    ).toBeTruthy()
  })

  it('changing inviterDisplayName changes the interpolated text', () => {
    const { getByText } = render(
      <Invited inviterDisplayName="MARKER_OTHER_NAME" invite={invite} />,
    )

    expect(
      getByText('MARKER_BODY_PREFIX MARKER_OTHER_NAME MARKER_BODY_SUFFIX'),
    ).toBeTruthy()
  })
})

describe('Invited · group', () => {
  it('renders groupInfo details when provided', () => {
    const { getByText } = render(
      <Invited
        inviterDisplayName="MARKER_INVITER_NAME"
        invite={invite}
        groupInfo={{
          memberCount: 3,
          creatorName: 'MARKER_CREATOR_NAME',
          currentArchetypeTitle: 'MARKER_ARCHETYPE_TITLE',
        }}
      />,
    )

    expect(getByText('MARKER_CREATOR_NAME')).toBeTruthy()
    expect(getByText('MARKER_ARCHETYPE_TITLE')).toBeTruthy()
    expect(getByText('3', { exact: false })).toBeTruthy()
  })

  it('omits archetype title text when currentArchetypeTitle is not set', () => {
    const { queryByText } = render(
      <Invited
        inviterDisplayName="MARKER_INVITER_NAME"
        invite={invite}
        groupInfo={{ memberCount: 1, creatorName: 'MARKER_CREATOR_NAME' }}
      />,
    )

    expect(queryByText('MARKER_ARCHETYPE_TITLE')).toBeNull()
  })
})
