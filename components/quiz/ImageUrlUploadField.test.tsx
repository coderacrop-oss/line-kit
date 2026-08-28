// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImageUrlUploadField } from './ImageUrlUploadField'

afterEach(cleanup)

const file = (name = 'a.png') => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })

describe('ImageUrlUploadField · อัปโหลดตรงจากฟอร์มควิซ (controlled)', () => {
  it('อัปโหลดสำเร็จ → onChange ถูกเรียกด้วย url ที่ action คืนมา', async () => {
    const uploadAction = vi.fn(async () => ({ ok: true as const, url: '/uploads/c1/x/new.png' }))
    const onChange = vi.fn()
    const { container } = render(
      <ImageUrlUploadField
        id="axis-image-0" label="รูปภาพ" value=""
        disabled={false} campaignId="c1" activityId="act-1"
        uploadAction={uploadAction} onChange={onChange}
      />,
    )

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file()] } })

    await waitFor(() => expect(uploadAction).toHaveBeenCalledWith('c1', 'act-1', expect.any(FormData)))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('/uploads/c1/x/new.png'))
  })

  it('อัปโหลดพัง → แสดงเหตุผลจริง และไม่เรียก onChange (ไม่ล้าง/ไม่แก้ค่าเดิมที่กรอกไว้)', async () => {
    const uploadAction = vi.fn(async () => ({ ok: false as const, message: 'ภาพกว้าง 400 px — ต้องกว้างระหว่าง 800 ถึง 2500 px' }))
    const onChange = vi.fn()
    const { container } = render(
      <ImageUrlUploadField
        id="axis-image-0" label="รูปภาพ" value="https://cdn.example.com/เดิม.png"
        disabled={false} campaignId="c1" activityId="act-1"
        uploadAction={uploadAction} onChange={onChange}
      />,
    )

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file('narrow.png')] } })

    await waitFor(() => expect(screen.getByText(/ภาพกว้าง 400 px/)).toBeDefined())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('พิมพ์ URL เองในช่อง → onChange ถูกเรียกด้วยค่าที่พิมพ์ (ทางเดิมยังใช้ได้ ไม่ต้องอัปโหลดเสมอไป)', () => {
    const onChange = vi.fn()
    render(
      <ImageUrlUploadField
        id="axis-image-0" label="รูปภาพ" value=""
        disabled={false} campaignId="c1" activityId="act-1"
        uploadAction={vi.fn()} onChange={onChange}
      />,
    )

    const urlInput = screen.getByLabelText('รูปภาพ') as HTMLInputElement
    fireEvent.change(urlInput, { target: { value: 'https://cdn.example.com/manual.png' } })
    expect(onChange).toHaveBeenCalledWith('https://cdn.example.com/manual.png')
  })

  it('disabled=true → ไม่มีปุ่มอัปโหลด และช่อง URL ถูกปิดไว้', () => {
    const { container } = render(
      <ImageUrlUploadField
        id="axis-image-0" label="รูปภาพ" value="https://cdn.example.com/x.png"
        disabled campaignId="c1" activityId="act-1"
        uploadAction={vi.fn()} onChange={vi.fn()}
      />,
    )

    expect(container.querySelector('input[type="file"]')).toBeNull()
    const urlInput = screen.getByLabelText('รูปภาพ') as HTMLInputElement
    expect(urlInput.disabled).toBe(true)
  })
})
