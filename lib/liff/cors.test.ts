import { describe, expect, it } from 'vitest'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from './cors'

describe('LIFF CORS', () => {
  it('allows any origin — auth is the real gate, not origin (spec §8)', () => {
    expect(LIFF_CORS_HEADERS['Access-Control-Allow-Origin']).toBe('*')
  })

  it('allows the Authorization and Content-Type headers a LIFF call needs', () => {
    expect(LIFF_CORS_HEADERS['Access-Control-Allow-Headers']).toContain('Authorization')
    expect(LIFF_CORS_HEADERS['Access-Control-Allow-Headers']).toContain('Content-Type')
  })

  it('liffOptionsResponse answers preflight with 204 and the same headers', async () => {
    const response = liffOptionsResponse()
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})
