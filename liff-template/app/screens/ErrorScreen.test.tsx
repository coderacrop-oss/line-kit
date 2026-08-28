// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ErrorScreen } from './ErrorScreen'

afterEach(cleanup)

describe('ErrorScreen', () => {
  it('renders exactly its title and body props and nothing else', () => {
    const { container, getByText } = render(
      <ErrorScreen title="MARKER_ERROR_TITLE" body="MARKER_ERROR_BODY" />,
    )

    expect(getByText('MARKER_ERROR_TITLE')).toBeTruthy()
    expect(getByText('MARKER_ERROR_BODY')).toBeTruthy()
    expect(container.textContent).toBe('MARKER_ERROR_TITLEMARKER_ERROR_BODY')
  })

  it('changing the props changes the rendered text (no hardcoded copy)', () => {
    const { container } = render(
      <ErrorScreen title="MARKER_OTHER_TITLE" body="MARKER_OTHER_BODY" />,
    )
    expect(container.textContent).toBe('MARKER_OTHER_TITLEMARKER_OTHER_BODY')
  })
})
