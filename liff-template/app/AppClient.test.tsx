// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuizConfig } from '../lib/schema'

afterEach(cleanup)

vi.mock('../lib/liff/client', () => ({
  isInClient: vi.fn(() => true),
  getProfile: vi.fn(async () => ({ displayName: 'Test User' })),
  isFriend: vi.fn(async () => true),
}))

import { getProfile, isFriend, isInClient } from '../lib/liff/client'
import { AppClient } from './AppClient'

const quiz: QuizConfig = {
  mode: 'solo',
  axes: [
    { id: 'ei', label: 'E/I', poles: ['Extrovert', 'Introvert'] },
    { id: 'sn', label: 'S/N', poles: ['Sensing', 'Intuition'] },
  ],
  questions: [
    { id: 'q1', text: 'Question one?', options: [{ id: 'a', label: 'Opt A1', scores: { ei: 2, sn: -1 } }, { id: 'b', label: 'Opt B1', scores: { ei: -2, sn: 1 } }] },
    { id: 'q2', text: 'Question two?', options: [{ id: 'a', label: 'Opt A2', scores: { ei: 1, sn: 1 } }, { id: 'b', label: 'Opt B2', scores: { ei: -1, sn: -1 } }] },
    { id: 'q3', text: 'Question three?', options: [{ id: 'a', label: 'Opt A3', scores: { ei: 1, sn: -1 } }, { id: 'b', label: 'Opt B3', scores: { ei: -1, sn: 1 } }] },
  ],
  results: [
    { code: 'ES', title: 'You are ES!', body: 'ES body copy' },
    { code: 'EI', title: 'You are EI!', body: 'EI body copy' },
    { code: 'IS', title: 'You are IS!', body: 'IS body copy' },
    { code: 'II', title: 'You are II!', body: 'II body copy' },
  ],
  fallbackResultCode: 'ES',
  templateCopy: {
    brand: { name: 'Marker Brand' },
    intro: { title: 'Marker Intro Title', body: 'Marker intro body', ctaLabel: 'Marker Start' },
    friendGate: { title: 'Marker FG title', body: 'Marker FG body', ctaLabel: 'Marker FG cta' },
    openInLine: { title: 'Marker OIL title', body: 'Marker OIL body' },
    rewards: { milestones: [{ key: 'm1', label: 'Marker milestone', triggerCount: 1 }] },
    messages: {
      resultCard: { eyebrow: 'e', ctaLabel: 'c' },
      keywordCard: { title: 't', body: 'b', ctaLabel: 'c' },
      soloShare: { badge: 'b', ctaLabel: 'c', secondaryCtaLabel: 'd' },
    },
  },
}

beforeEach(() => {
  vi.mocked(isInClient).mockReturnValue(true)
  vi.mocked(isFriend).mockResolvedValue(true)
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ resultCode: 'ES', scores: { ei: 2, sn: 1 }, usedFallback: false }),
  })))
})

describe('AppClient — solo flow', () => {
  it('walks Loading -> Intro -> Question (x3) -> Summary -> Rewards', async () => {
    render(<AppClient quiz={quiz} />)

    // Loading first, then Intro once isInClient/getProfile/isFriend resolve
    await waitFor(() => expect(screen.getByText('Marker Intro Title')).toBeDefined())
    fireEvent.click(screen.getByText('Marker Start'))

    expect(screen.getByText('Question one?')).toBeDefined()
    fireEvent.click(screen.getByText('Opt A1'))
    expect(screen.getByText('Question two?')).toBeDefined()
    fireEvent.click(screen.getByText('Opt A2'))
    expect(screen.getByText('Question three?')).toBeDefined()
    fireEvent.click(screen.getByText('Opt B3'))

    await waitFor(() => expect(screen.getByText('You are ES!')).toBeDefined())
    expect(screen.getByText('ES body copy')).toBeDefined()

    fireEvent.click(screen.getByText('Rewards'))
    expect(screen.getByText('Marker milestone')).toBeDefined()
  })

  it('shows OpenInLine when not opened inside the LINE app', async () => {
    vi.mocked(isInClient).mockReturnValue(false)
    render(<AppClient quiz={quiz} />)
    await waitFor(() => expect(screen.getByText('Marker OIL title')).toBeDefined())
  })

  it('shows FriendGate when the visitor has not added the OA as a friend', async () => {
    vi.mocked(isFriend).mockResolvedValue(false)
    render(<AppClient quiz={quiz} />)
    await waitFor(() => expect(screen.getByText('Marker FG title')).toBeDefined())
    fireEvent.click(screen.getByText('Marker FG cta'))
    await waitFor(() => expect(screen.getByText('Marker Intro Title')).toBeDefined())
  })

  it('shows an error screen when the answer submission fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'boom' }) })))
    render(<AppClient quiz={quiz} />)
    await waitFor(() => expect(screen.getByText('Marker Intro Title')).toBeDefined())
    fireEvent.click(screen.getByText('Marker Start'))
    fireEvent.click(screen.getByText('Opt A1'))
    fireEvent.click(screen.getByText('Opt A2'))
    fireEvent.click(screen.getByText('Opt B3'))
    await waitFor(() => expect(screen.getByText('boom')).toBeDefined())
  })
})
