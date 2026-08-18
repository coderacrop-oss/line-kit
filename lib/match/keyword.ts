export type KeywordRule = {
  id: string
  keyword: string
  matchMode: 'exact' | 'contains'
  sortOrder: number
}

const ZERO_WIDTH = /[​-‍﻿]/g

/**
 * People type with stray spaces, mixed case, and invisible characters pasted in
 * from elsewhere. Both sides of a comparison go through here so a rule that
 * looks like it should match, does.
 */
export function normalizeText(input: string): string {
  return input.replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Exact always wins, regardless of ordering. A rule matching the whole message
 * is a stronger signal of intent than one that merely appears inside it.
 * Within a mode, the author's ordering decides.
 */
export function matchKeyword(text: string, rules: KeywordRule[]): KeywordRule | null {
  const needle = normalizeText(text)
  if (!needle) return null

  const byOrder = [...rules].sort((a, b) => a.sortOrder - b.sortOrder)

  const exact = byOrder.find(
    (r) => r.matchMode === 'exact' && normalizeText(r.keyword) === needle,
  )
  if (exact) return exact

  return byOrder.find(
    (r) => r.matchMode === 'contains' && needle.includes(normalizeText(r.keyword)),
  ) ?? null
}
