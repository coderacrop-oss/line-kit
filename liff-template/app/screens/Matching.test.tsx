// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Matching } from './Matching'

afterEach(cleanup)

describe('Matching', () => {
  it('renders both axis card images when both urls are provided', () => {
    const { getAllByRole, queryAllByText } = render(
      <Matching
        axisCardImageUrlA="https://example.test/a.png"
        axisCardImageUrlB="https://example.test/b.png"
      />,
    )

    const images = getAllByRole('img') as HTMLImageElement[]
    expect(images.map((img) => img.src)).toEqual([
      'https://example.test/a.png',
      'https://example.test/b.png',
    ])
    expect(queryAllByText('?')).toHaveLength(0)
  })

  it('shows a generic placeholder for the side whose image url is undefined', () => {
    const { getAllByRole, getAllByText } = render(
      <Matching axisCardImageUrlA="https://example.test/a.png" />,
    )

    expect(getAllByRole('img')).toHaveLength(1)
    expect(getAllByText('?')).toHaveLength(1)
  })

  it('shows two generic placeholders when neither url is provided', () => {
    const { queryAllByRole, getAllByText } = render(<Matching />)

    expect(queryAllByRole('img')).toHaveLength(0)
    expect(getAllByText('?')).toHaveLength(2)
  })
})
