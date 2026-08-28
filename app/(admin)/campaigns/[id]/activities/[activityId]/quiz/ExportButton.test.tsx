// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExportButton } from './ExportButton'

afterEach(cleanup)

/**
 * Finding 7 — ปุ่ม Export เดิมเป็น `<a href="…/quiz/export">` เฉยๆ ซึ่งพา browser ไปแสดง raw
 * JSON ตรงๆ เวลา route คืน error 400 แทนที่จะโชว์ UI error ของแอปเอง ตอนนี้เปลี่ยนเป็นปุ่มที่
 * ยิง fetch() เอง — เทสต์นี้ครอบทั้งสองทาง (สำเร็จ = ดาวน์โหลดไฟล์ / error = โชว์ ErrorModal)
 */
describe('ExportButton', () => {
  let createObjectURL: ReturnType<typeof vi.fn>
  let revokeObjectURL: ReturnType<typeof vi.fn>
  let anchorClick: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:fake-object-url')
    revokeObjectURL = vi.fn()
    // jsdom ไม่มี URL.createObjectURL/revokeObjectURL ให้ในตัว ต้อง stub เอง
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(URL as any).createObjectURL = createObjectURL
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(URL as any).revokeObjectURL = revokeObjectURL
    anchorClick = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(anchorClick)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('downloads the zip via fetch on success, staying on the same page (no navigation)', async () => {
    const fakeBlob = new Blob(['zip bytes'], { type: 'application/zip' })
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-disposition': 'attachment; filename="my-quiz-liff-template.zip"' }),
      blob: async () => fakeBlob,
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<ExportButton href="/campaigns/c1/activities/a1/quiz/export" fallbackFileName="fallback.zip" />)
    fireEvent.click(screen.getByText('↓ Export .zip'))

    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/campaigns/c1/activities/a1/quiz/export')
    expect(createObjectURL).toHaveBeenCalledWith(fakeBlob)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-object-url')
    // ไม่มี error modal โผล่ขึ้นมา
    expect(screen.queryByText(/เกิดข้อผิดพลาด/)).toBeNull()
  })

  it('uses the fallback file name when Content-Disposition is missing', async () => {
    const fakeBlob = new Blob(['zip bytes'])
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, headers: new Headers(), blob: async () => fakeBlob,
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<ExportButton href="/x" fallbackFileName="fallback.zip" />)
    fireEvent.click(screen.getByText('↓ Export .zip'))

    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1))
  })

  it('shows the app error UI with the actual message on a 400 response, instead of navigating away', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Quiz config is invalid — fix it on the quiz content screen before exporting.' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<ExportButton href="/campaigns/c1/activities/a1/quiz/export" fallbackFileName="fallback.zip" />)
    fireEvent.click(screen.getByText('↓ Export .zip'))

    await waitFor(() =>
      expect(screen.getByText(/Quiz config is invalid/)).toBeDefined(),
    )
    expect(screen.getByRole('dialog')).toBeDefined()
    // ไม่มีการดาวน์โหลดเกิดขึ้นเมื่อ error
    expect(anchorClick).not.toHaveBeenCalled()
  })

  it('shows a fallback message when the error response is not valid JSON', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json') },
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<ExportButton href="/x" fallbackFileName="fallback.zip" />)
    fireEvent.click(screen.getByText('↓ Export .zip'))

    await waitFor(() => expect(screen.getByText(/HTTP 500/)).toBeDefined())
  })
})
