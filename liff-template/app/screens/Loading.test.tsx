// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Loading } from './Loading'

afterEach(cleanup)

describe('Loading', () => {
  it('shows a generic loading label', () => {
    const { getByText } = render(<Loading />)
    expect(getByText('Loading…')).toBeTruthy()
  })
})
