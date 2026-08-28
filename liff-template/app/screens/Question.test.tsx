// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Question } from './Question'
import type { QuizQuestion } from '../../lib/schema'

afterEach(cleanup)

const question: QuizQuestion = {
  id: 'q1',
  text: 'MARKER_QUESTION_TEXT',
  options: [
    { id: 'opt-a', label: 'MARKER_OPTION_A', scores: { EI: 1 } },
    { id: 'opt-b', label: 'MARKER_OPTION_B', scores: { EI: -1 } },
  ],
}

describe('Question', () => {
  it('renders the question text and every option label from props', () => {
    const { getByText } = render(<Question question={question} onAnswer={() => {}} />)

    expect(getByText('MARKER_QUESTION_TEXT')).toBeTruthy()
    expect(getByText('MARKER_OPTION_A')).toBeTruthy()
    expect(getByText('MARKER_OPTION_B')).toBeTruthy()
  })

  it('calls onAnswer with the clicked option id', () => {
    const onAnswer = vi.fn()
    const { getByText } = render(<Question question={question} onAnswer={onAnswer} />)

    fireEvent.click(getByText('MARKER_OPTION_B'))

    expect(onAnswer).toHaveBeenCalledWith('opt-b')
    expect(onAnswer).toHaveBeenCalledTimes(1)
  })

  it('rendering a different question shows different text (not hardcoded)', () => {
    const other: QuizQuestion = {
      id: 'q2',
      text: 'MARKER_OTHER_QUESTION',
      options: [{ id: 'opt-c', label: 'MARKER_OPTION_C', scores: {} }],
    }
    const { getByText, queryByText } = render(<Question question={other} onAnswer={() => {}} />)

    expect(getByText('MARKER_OTHER_QUESTION')).toBeTruthy()
    expect(queryByText('MARKER_QUESTION_TEXT')).toBeNull()
  })
})
