import type { Tone } from '../game/fortunes'

export const COLORS = {
  cream: '#FFF8EC',
  tile: '#FFE9C2',
  tileBorder: '#E6C88E',
  ink: '#4A3A28',
  muted: '#9B8A74',
  accent: '#D98324',
  white: '#FFFFFF',
} as const

export const TONE_STYLE: Record<Tone, { label: string; color: string }> = {
  daily: { label: 'ดวงวันนี้', color: '#4C6EF5' },
  funny: { label: 'แซ่บ ๆ', color: '#E64980' },
  inspire: { label: 'ข้อคิด', color: '#2F9E44' },
}
