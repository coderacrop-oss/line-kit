// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PairResult } from './PairResult'
import type { QuizAxis, QuizResultRule } from '../../lib/schema'

afterEach(cleanup)

const result: QuizResultRule = {
  code: 'RESULT_X',
  title: 'MARKER_RESULT_TITLE',
  body: 'MARKER_RESULT_BODY',
}

const axisA: QuizAxis = { id: 'ei', label: 'MARKER_AXIS_A_LABEL', poles: ['E', 'I'] }
const axisB: QuizAxis = { id: 'sn', label: 'MARKER_AXIS_B_LABEL', poles: ['S', 'N'] }

describe('PairResult', () => {
  it('renders result title/body and both axis labels from props', () => {
    const { getByText } = render(<PairResult result={result} axisA={axisA} axisB={axisB} />)

    expect(getByText('MARKER_RESULT_TITLE')).toBeTruthy()
    expect(getByText('MARKER_RESULT_BODY')).toBeTruthy()
    expect(getByText('MARKER_AXIS_A_LABEL')).toBeTruthy()
    expect(getByText('MARKER_AXIS_B_LABEL')).toBeTruthy()
  })

  it('renders a placeholder box when result.imageUrl is undefined', () => {
    const { getByTestId, queryByRole } = render(
      <PairResult result={result} axisA={axisA} axisB={axisB} />,
    )

    expect(getByTestId('result-image-placeholder')).toBeTruthy()
    expect(queryByRole('img')).toBeNull()
  })

  it('renders the result image when result.imageUrl is provided', () => {
    const withImage: QuizResultRule = { ...result, imageUrl: 'https://example.test/r.png' }
    const { getByRole, queryByTestId } = render(
      <PairResult result={withImage} axisA={axisA} axisB={axisB} />,
    )

    const img = getByRole('img') as HTMLImageElement
    expect(img.src).toBe('https://example.test/r.png')
    expect(queryByTestId('result-image-placeholder')).toBeNull()
  })

  it('shows the rank when provided, and omits it when undefined', () => {
    const withRank = render(<PairResult result={result} axisA={axisA} axisB={axisB} rank={2} />)
    expect(withRank.getByText('#2')).toBeTruthy()
    withRank.unmount()

    const withoutRank = render(<PairResult result={result} axisA={axisA} axisB={axisB} />)
    expect(withoutRank.queryByText('#2')).toBeNull()
  })
})
