// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { OpenInLine } from './OpenInLine'

afterEach(cleanup)

const openInLine = {
  title: 'MARKER_OPEN_IN_LINE_TITLE',
  body: 'MARKER_OPEN_IN_LINE_BODY',
}

describe('OpenInLine', () => {
  it('renders title and body from props', () => {
    const { getByText } = render(<OpenInLine openInLine={openInLine} />)

    expect(getByText('MARKER_OPEN_IN_LINE_TITLE')).toBeTruthy()
    expect(getByText('MARKER_OPEN_IN_LINE_BODY')).toBeTruthy()
  })

  it('changing the prop changes the rendered text', () => {
    const { getByText } = render(
      <OpenInLine openInLine={{ ...openInLine, body: 'MARKER_OTHER_BODY' }} />,
    )
    expect(getByText('MARKER_OTHER_BODY')).toBeTruthy()
  })
})
