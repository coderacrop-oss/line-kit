// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CopyUrlButton } from './CopyUrlButton'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const URL = 'https://assets.example.com/campaigns/c1/lucky-cat.png'

/**
 * jsdom ไม่มี navigator.clipboard ให้โดย default (ต่างจาก browser จริง) — ทุกเทสต์
 * ต้องปลูก stub เองก่อนเรียกปุ่ม ไม่งั้น handleClick จะ throw เพราะ .writeText เป็น undefined
 */
function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
}

describe('CopyUrlButton', () => {
  it('คลิกแล้วเรียก writeText ด้วย URL ตรงตัวที่ส่งเข้ามา', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)

    render(<CopyUrlButton url={URL} />)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL))
    expect(writeText).toHaveBeenCalledTimes(1)
  })

  it('คัดลอกสำเร็จ ปุ่มเปลี่ยนข้อความเป็นคัดลอกแล้ว', async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined))

    render(<CopyUrlButton url={URL} />)
    fireEvent.click(screen.getByRole('button'))

    expect(await screen.findByText('คัดลอกแล้ว ✓')).not.toBeNull()
  })

  it('ข้อความคัดลอกแล้วหายไปเองหลังพ้นเวลายืนยัน กลับเป็นปุ่มปกติ', async () => {
    vi.useFakeTimers()
    stubClipboard(vi.fn().mockResolvedValue(undefined))

    render(<CopyUrlButton url={URL} />)
    fireEvent.click(screen.getByRole('button'))

    // resolve microtask ของ writeText ก่อนเดินเวลา ไม่งั้น setStatus('copied') ยังไม่ทันเกิด
    await vi.waitFor(() => expect(screen.getByRole('button').textContent).toContain('คัดลอกแล้ว'))

    vi.advanceTimersByTime(1600)
    await vi.waitFor(() => expect(screen.getByRole('button').textContent).toBe('คัดลอก URL'))
  })

  it('writeText ถูกปฏิเสธ ไม่ throw ออกมา และขึ้นช่อง URL สำรองให้คัดลอกเอง', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('permission denied'))
    stubClipboard(writeText)

    render(<CopyUrlButton url={URL} />)

    // ปุ่มนี้ไม่มี type="submit" ในฟอร์มไหน — ถ้า handleClick ปล่อย rejection ไม่ถูกจับ
    // ก็จะโผล่เป็น unhandled rejection ในเทสต์รัน ไม่ใช่แค่ UI เงียบ
    expect(() => fireEvent.click(screen.getByRole('button'))).not.toThrow()

    const fallback = await screen.findByLabelText('URL ของภาพ') as HTMLInputElement
    expect(fallback.value).toBe(URL)
  })
})
