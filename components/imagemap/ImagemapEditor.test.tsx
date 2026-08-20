// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImagemapEditor, type ImagemapDraftPayload, type ImagemapEditorInitial } from './ImagemapEditor'
import type { TapArea } from '@/lib/imagemap/regions'

afterEach(cleanup)

const push = vi.fn()
const refresh = vi.fn()
beforeEach(() => { push.mockClear(); refresh.mockClear() })
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))

const withImage = (patch: Partial<ImagemapEditorInitial> = {}): ImagemapEditorInitial => ({
  baseImageUrl: '/uploads/base.jpg', baseWidth: 1040, baseHeight: 585, altText: 'โปรโมชัน',
  actions: [], ready: false,
  ...patch,
})

const area = (patch: Partial<TapArea> = {}): TapArea => ({
  id: 'a1', x: 20, y: 20, width: 260, height: 140, action: { type: 'uri', linkUri: 'https://example.com' },
  ...patch,
})

const draw = (over: Partial<Parameters<typeof ImagemapEditor>[0]> = {}) => {
  const saveDraft = vi.fn(async (_c: string, _k: string, _p: ImagemapDraftPayload) => {})
  const applyImagemap = vi.fn(async (_c: string, _k: string, _p: ImagemapDraftPayload) => {})
  const uploadBaseImage = vi.fn(async (_c: string, _k: string, _f: FormData) => (
    { url: '/uploads/new.jpg', baseWidth: 1040, baseHeight: 700 }
  ))

  const utils = render(
    <ImagemapEditor
      campaignId="c1" cardId="card-1" initial={withImage()} canEdit backHref="/campaigns/c1/cards"
      uploadBaseImage={uploadBaseImage} saveDraft={saveDraft} applyImagemap={applyImagemap}
      {...over}
    />,
  )
  return { ...utils, saveDraft, applyImagemap, uploadBaseImage }
}

describe('ImagemapEditor · โครงเริ่มต้น', () => {
  it('ยังไม่มีภาพฐาน — บอกให้อัปโหลดก่อน ปุ่มเพิ่มพื้นที่กดถูกปิดไว้', () => {
    draw({ initial: withImage({ baseImageUrl: null, baseWidth: null, baseHeight: null }) })
    expect(screen.getByText(/ยังไม่มีภาพฐาน/)).toBeDefined()
    expect((screen.getByText('+ เพิ่มพื้นที่กด') as HTMLButtonElement).disabled).toBe(true)
  })

  it('พื้นที่แต่งภาพย่อขนาดตามอัตราส่วนของภาพจริง (1040 กว้างเสมอ)', () => {
    const { container } = draw()
    const stage = container.querySelector('[data-imagemap-stage]') as HTMLElement
    expect(stage.style.width).toBe('820px')
    expect(Math.round(parseFloat(stage.style.height))).toBe(Math.round(820 * (585 / 1040)))
  })

  it('canEdit=false — ไม่มีปุ่มแก้ไขใดๆ เลย (โหมดดูอย่างเดียว)', () => {
    draw({ canEdit: false })
    expect(screen.queryByText('+ เพิ่มพื้นที่กด')).toBeNull()
    expect(screen.queryByText('แทนที่ภาพฐาน')).toBeNull()
    expect(screen.queryByText('ใช้')).toBeNull()
  })

  it('ยังไม่เคยกด "ใช้" — แสดงสถานะยังไม่พร้อมส่ง', () => {
    draw({ initial: withImage({ ready: false }) })
    expect(screen.getByText(/ยังไม่พร้อมส่ง/)).toBeDefined()
  })

  it('เคยกด "ใช้" สำเร็จแล้ว — แสดงสถานะพร้อมส่งจริง', () => {
    draw({ initial: withImage({ ready: true }) })
    expect(screen.getByText(/พร้อมส่งจริง/)).toBeDefined()
  })
})

describe('ImagemapEditor · อัปโหลด/แทนที่ภาพฐาน', () => {
  it('อัปโหลดภาพใหม่ — เรียก uploadBaseImage แล้วอัปเดตขนาดผืนทันทีที่สำเร็จ', async () => {
    const { container, uploadBaseImage } = draw({ initial: withImage({ baseImageUrl: null, baseWidth: null, baseHeight: null }) })
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => expect(uploadBaseImage).toHaveBeenCalled())
    await waitFor(() => {
      const stage = container.querySelector('[data-imagemap-stage]') as HTMLElement
      expect(Math.round(parseFloat(stage.style.height))).toBe(Math.round(820 * (700 / 1040)))
    })
  })

  it('แทนที่ภาพฐานที่เคยพร้อมส่งแล้ว — สถานะกลับไปเป็นยังไม่พร้อมส่ง', async () => {
    const { container } = draw({ initial: withImage({ ready: true }) })
    expect(screen.getByText(/พร้อมส่งจริง/)).toBeDefined()

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByText(/ยังไม่พร้อมส่ง/)).toBeDefined())
  })
})

describe('ImagemapEditor · เพิ่ม/เลือก/ลบพื้นที่กด', () => {
  it('เพิ่มพื้นที่กด — ปรากฏในรายการทันทีและถูกเลือกอยู่ พร้อมค่าลิงก์เริ่มต้นที่บันทึกได้จริง', async () => {
    const { container, saveDraft } = draw()
    fireEvent.click(screen.getByText('+ เพิ่มพื้นที่กด'))

    await waitFor(() => expect(saveDraft).toHaveBeenCalled())
    expect(container.querySelectorAll('[data-area-id]')).toHaveLength(1)
    const call = saveDraft.mock.calls.at(-1)
    expect(call?.[2].actions[0].action).toEqual({ type: 'uri', linkUri: 'https://example.com' })
  })

  it('คลิกที่พื้นที่บนเวที (pointerdown+click ตามลำดับจริงของเบราว์เซอร์) — ยังเลือกอยู่ ไม่ถูกยกเลิกด้วย onClick ของพื้นหลัง', () => {
    const { container } = draw({ initial: withImage({ actions: [area()] }) })
    const node = container.querySelector('[data-area-id="a1"]')!
    // เบราว์เซอร์จริงยิง click ตามหลัง pointerdown/pointerup บนเป้าหมายเดียวกันเสมอ
    // และ click นั้นไหลขึ้นไปโดน onClick ของเวที (ซึ่งเคลียร์ selectedId) ถ้าไม่ได้
    // stopPropagation ไว้ที่ตัวพื้นที่ด้วย
    fireEvent.pointerDown(node)
    fireEvent.click(node)

    // เลือกอยู่ = ฟอร์มแก้ไขพื้นที่ (ชนิดการกระทำ) ปรากฏขึ้น
    expect(screen.getByText('ชนิดการกระทำ')).toBeDefined()
  })

  it('ลบพื้นที่ — หายไปจากรายการและเวที', async () => {
    const { container, saveDraft } = draw({ initial: withImage({ actions: [area()] }) })
    expect(container.querySelectorAll('[data-area-id]')).toHaveLength(1)

    fireEvent.pointerDown(container.querySelector('[data-area-id="a1"]')!)
    fireEvent.click(screen.getByLabelText('ลบพื้นที่นี้'))

    await waitFor(() => expect(saveDraft).toHaveBeenCalled())
    expect(container.querySelectorAll('[data-area-id]')).toHaveLength(0)
  })
})

describe('ImagemapEditor · ฟอร์มของพื้นที่ที่เลือก', () => {
  it('สลับชนิดจาก uri เป็น message — ช่องกรอกเปลี่ยนตาม และบันทึกชนิดใหม่', async () => {
    const { container, saveDraft } = draw({ initial: withImage({ actions: [area()] }) })
    fireEvent.pointerDown(container.querySelector('[data-area-id="a1"]')!)

    fireEvent.change(screen.getByLabelText('ชนิดการกระทำ'), { target: { value: 'message' } })

    await waitFor(() => {
      const call = saveDraft.mock.calls.at(-1)
      expect(call?.[2].actions[0].action).toEqual({ type: 'message', text: '' })
    })
    expect(screen.getByLabelText('ข้อความที่จะส่งกลับ')).toBeDefined()
  })

  it('แก้ลิงก์ปลายทางแล้วออกจากช่อง (blur) — บันทึกค่าใหม่', async () => {
    const { container, saveDraft } = draw({ initial: withImage({ actions: [area()] }) })
    fireEvent.pointerDown(container.querySelector('[data-area-id="a1"]')!)

    const input = screen.getByLabelText('ลิงก์ปลายทาง') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'https://new-target.example.com' } })
    fireEvent.blur(input)

    await waitFor(() => {
      const call = saveDraft.mock.calls.at(-1)
      expect(call?.[2].actions[0].action).toMatchObject({ linkUri: 'https://new-target.example.com' })
    })
  })

  it('ใส่ป้ายกำกับแล้ว blur — ติดไปกับพื้นที่นั้น', async () => {
    const { container, saveDraft } = draw({ initial: withImage({ actions: [area()] }) })
    fireEvent.pointerDown(container.querySelector('[data-area-id="a1"]')!)

    const input = screen.getByLabelText('ป้ายกำกับ (ไม่บังคับ)') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'ไปโปรโมชัน' } })
    fireEvent.blur(input)

    await waitFor(() => {
      const call = saveDraft.mock.calls.at(-1)
      expect(call?.[2].actions[0].action).toMatchObject({ label: 'ไปโปรโมชัน' })
    })
  })
})

describe('ImagemapEditor · ข้อความสำรอง (alt text)', () => {
  it('แก้แล้วออกจากช่อง (blur) — บันทึกค่าใหม่', async () => {
    const { saveDraft } = draw()
    const input = screen.getByLabelText('ข้อความสำรอง (alt text)') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'ข้อความใหม่' } })
    fireEvent.blur(input)

    await waitFor(() => {
      const call = saveDraft.mock.calls.at(-1)
      expect(call?.[2].altText).toBe('ข้อความใหม่')
    })
  })

  it('ไม่ได้เปลี่ยนอะไรเลยแล้ว blur — ไม่ยิงบันทึกซ้ำโดยไม่จำเป็น', () => {
    const { saveDraft } = draw()
    const input = screen.getByLabelText('ข้อความสำรอง (alt text)') as HTMLInputElement
    fireEvent.blur(input)
    expect(saveDraft).not.toHaveBeenCalled()
  })
})

describe('ImagemapEditor · บันทึกล้มเหลว', () => {
  it('saveDraft ล้ม — ย้อน state กลับและแสดงเหตุผล', async () => {
    const saveDraft = vi.fn(async () => { throw new Error('เครือข่ายขัดข้อง') })
    const { container } = draw({ saveDraft })
    fireEvent.click(screen.getByText('+ เพิ่มพื้นที่กด'))

    await waitFor(() => expect(screen.getByText('เครือข่ายขัดข้อง')).toBeDefined())
    expect(container.querySelectorAll('[data-area-id]')).toHaveLength(0)
  })
})

describe('ImagemapEditor · ปุ่ม "ใช้"', () => {
  it('กด "ใช้" — เรียก applyImagemap ด้วยพื้นที่กดและข้อความสำรองปัจจุบัน แล้วสถานะเปลี่ยนเป็นพร้อมส่ง', async () => {
    const { applyImagemap } = draw({ initial: withImage({ actions: [area()], altText: 'ข้อความ' }) })
    fireEvent.click(screen.getByText('ใช้'))

    await waitFor(() => expect(applyImagemap).toHaveBeenCalledWith('c1', 'card-1', {
      actions: [area()], altText: 'ข้อความ',
    }))
    await waitFor(() => expect(screen.getByText(/พร้อมส่งจริง/)).toBeDefined())
  })

  it('applyImagemap ล้ม — แสดงเหตุผล ไม่เปลี่ยนสถานะเป็นพร้อมส่ง', async () => {
    const applyImagemap = vi.fn(async () => { throw new Error('สร้างภาพไม่ได้') })
    draw({ applyImagemap, initial: withImage({ ready: false }) })
    fireEvent.click(screen.getByText('ใช้'))

    await waitFor(() => expect(screen.getByText('สร้างภาพไม่ได้')).toBeDefined())
    expect(screen.getByText(/ยังไม่พร้อมส่ง/)).toBeDefined()
  })

  it('ยังไม่มีภาพฐาน — ปุ่ม "ใช้" ถูกปิดไว้', () => {
    draw({ initial: withImage({ baseImageUrl: null, baseWidth: null, baseHeight: null }) })
    expect((screen.getByText('ใช้') as HTMLButtonElement).disabled).toBe(true)
  })
})
