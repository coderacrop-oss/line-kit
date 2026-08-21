// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImageBlockField } from './ImageBlockField'

afterEach(cleanup)

const file = (name = 'a.png') => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })

describe('ImageBlockField · อัปโหลดตรงจากเอดิเตอร์บล็อกภาพ', () => {
  it('อัปโหลดสำเร็จ → ช่อง URL ถูกเติมด้วย url ที่ action คืนมาโดยอัตโนมัติ', async () => {
    const uploadAction = vi.fn(async () => ({ ok: true as const, url: '/uploads/c1/x/new.png' }))
    const { container } = render(
      <ImageBlockField
        campaignId="c1" cardId="card-1" blockId="b1"
        defaultValue="" disabled={false} uploadAction={uploadAction}
      />,
    )

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file()] } })

    await waitFor(() => expect(uploadAction).toHaveBeenCalledWith('c1', 'card-1', expect.any(FormData)))
    const urlInput = container.querySelector('input[name="content"]') as HTMLInputElement
    await waitFor(() => expect(urlInput.value).toBe('/uploads/c1/x/new.png'))
  })

  it('อัปโหลดพัง → แสดงเหตุผลจริง และไม่ล้างค่าเดิมที่กรอกไว้ในช่อง', async () => {
    const uploadAction = vi.fn(async () => ({ ok: false as const, message: 'ภาพกว้าง 400 px — ต้องกว้างระหว่าง 800 ถึง 2500 px' }))
    const { container } = render(
      <ImageBlockField
        campaignId="c1" cardId="card-1" blockId="b1"
        defaultValue="https://cdn.example.com/เดิม.png" disabled={false} uploadAction={uploadAction}
      />,
    )

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file('narrow.png')] } })

    await waitFor(() => expect(screen.getByText(/ภาพกว้าง 400 px/)).toBeDefined())
    const urlInput = container.querySelector('input[name="content"]') as HTMLInputElement
    expect(urlInput.value).toBe('https://cdn.example.com/เดิม.png')
  })

  it('disabled=true → ไม่มีปุ่มอัปโหลด และช่อง URL ถูกปิดไว้', () => {
    const uploadAction = vi.fn()
    const { container } = render(
      <ImageBlockField
        campaignId="c1" cardId="card-1" blockId="b1"
        defaultValue="https://cdn.example.com/x.png" disabled uploadAction={uploadAction}
      />,
    )

    expect(container.querySelector('input[type="file"]')).toBeNull()
    const urlInput = container.querySelector('input[name="content"]') as HTMLInputElement
    expect(urlInput.disabled).toBe(true)
  })
})
