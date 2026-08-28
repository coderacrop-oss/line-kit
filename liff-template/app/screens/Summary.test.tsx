// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Summary } from './Summary'
import type { PairOrGroupSummary } from './Summary'

afterEach(cleanup)

const history: PairOrGroupSummary[] = [
  { id: 'h1', label: 'MARKER_HISTORY_ONE' },
  { id: 'h2', label: 'MARKER_HISTORY_TWO', imageUrl: 'https://example.test/h2.png' },
]

describe('Summary', () => {
  it('renders resultTitle and resultBody from props', () => {
    const { getByText } = render(
      <Summary
        resultTitle="MARKER_RESULT_TITLE"
        resultBody="MARKER_RESULT_BODY"
        history={[]}
      />,
    )

    expect(getByText('MARKER_RESULT_TITLE')).toBeTruthy()
    expect(getByText('MARKER_RESULT_BODY')).toBeTruthy()
  })

  it('renders the result image when resultImageUrl is provided', () => {
    const { getByRole, queryByTestId } = render(
      <Summary
        resultTitle="t"
        resultBody="b"
        resultImageUrl="https://example.test/result.png"
        history={[]}
      />,
    )

    const img = getByRole('img') as HTMLImageElement
    expect(img.src).toBe('https://example.test/result.png')
    expect(queryByTestId('result-image-placeholder')).toBeNull()
  })

  it('renders a generic placeholder box when resultImageUrl is undefined', () => {
    const { getByTestId, queryByRole } = render(
      <Summary resultTitle="t" resultBody="b" history={[]} />,
    )

    expect(getByTestId('result-image-placeholder')).toBeTruthy()
    expect(queryByRole('img')).toBeNull()
  })

  it('renders every history entry label from props', () => {
    const { getByText } = render(
      <Summary resultTitle="t" resultBody="b" history={history} />,
    )

    expect(getByText('MARKER_HISTORY_ONE')).toBeTruthy()
    expect(getByText('MARKER_HISTORY_TWO')).toBeTruthy()
  })
})
