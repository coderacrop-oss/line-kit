// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Intro } from './Intro'

afterEach(cleanup)

const brand = { name: 'MARKER_BRAND_ACME' }
const intro = {
  title: 'MARKER_INTRO_TITLE',
  body: 'MARKER_INTRO_BODY',
  ctaLabel: 'MARKER_START_CTA',
}

describe('Intro', () => {
  it('renders brand name, intro title/body, and cta label from props', () => {
    const { getByText } = render(<Intro brand={brand} intro={intro} />)

    expect(getByText('MARKER_BRAND_ACME')).toBeTruthy()
    expect(getByText('MARKER_INTRO_TITLE')).toBeTruthy()
    expect(getByText('MARKER_INTRO_BODY')).toBeTruthy()
    expect(getByText('MARKER_START_CTA')).toBeTruthy()
  })

  it('calls onContinue when the cta button is clicked', () => {
    const onContinue = vi.fn()
    const { getByText } = render(<Intro brand={brand} intro={intro} onContinue={onContinue} />)

    fireEvent.click(getByText('MARKER_START_CTA'))

    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('changing the intro prop changes the rendered text (not hardcoded)', () => {
    const { getByText } = render(
      <Intro brand={brand} intro={{ ...intro, title: 'MARKER_OTHER_TITLE' }} />,
    )
    expect(getByText('MARKER_OTHER_TITLE')).toBeTruthy()
  })
})
