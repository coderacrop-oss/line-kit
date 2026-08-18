// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Compositor, type CompositorImage } from './Compositor'
import type { Composition, ImageLayer, TextLayer } from '@/lib/richmenu/composition'

afterEach(cleanup)

const push = vi.fn()
beforeEach(() => { push.mockClear() })
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const canvas = { width: 2500, height: 1686 }

const image = (patch: Partial<ImageLayer> = {}): ImageLayer => ({
  id: 'img-1', type: 'image', assetId: 'asset-1', fit: 'cover', x: 100, y: 100, width: 500, height: 500, ...patch,
})

const text = (patch: Partial<TextLayer> = {}): TextLayer => ({
  id: 'txt-1', type: 'text', text: 'สวัสดี', fontSize: 60, color: '#000000', align: 'left', bold: false,
  x: 200, y: 200, width: 400, height: 100, ...patch,
})

const availableImage: CompositorImage = { id: 'asset-1', url: '/uploads/a.jpg', width: 500, height: 500 }

const draw = (over: Partial<Parameters<typeof Compositor>[0]> = {}) => {
  const saveComposition = vi.fn(
    async (_campaignId: string, _menuId: string, _composition: Composition) => {},
  )
  const applyComposition = vi.fn(
    async (_campaignId: string, _menuId: string, _composition: Composition) => ({ id: 'flattened-asset' }),
  )
  const uploadLayerImage = vi.fn(async (_campaignId: string, _formData: FormData) => (
    { id: 'new-asset', url: '/uploads/new.jpg', width: 300, height: 300 }
  ))

  const utils = render(
    <Compositor
      campaignId="c1" menuId="menu-1" canvas={canvas}
      initialComposition={null} images={[availableImage]} canEdit backHref="/campaigns/c1/richmenu"
      uploadLayerImage={uploadLayerImage} saveComposition={saveComposition} applyComposition={applyComposition}
      {...over}
    />,
  )
  return { ...utils, saveComposition, applyComposition, uploadLayerImage }
}

describe('Compositor · โครงเริ่มต้น', () => {
  it('ไม่มีชั้นเลยตอนเริ่ม — บอกว่ายังไม่มีชั้นใน LayerList', () => {
    draw()
    expect(screen.getByText('ยังไม่มีชั้นเลย — เพิ่มภาพหรือข้อความด้านล่าง')).toBeDefined()
  })

  it('พื้นที่แต่งภาพย่อขนาดตามอัตราส่วนของผืนจริง (2500×1686)', () => {
    const { container } = draw()
    const stage = container.querySelector('[data-compositor-stage]') as HTMLElement
    expect(stage.style.width).toBe('820px')
    expect(Math.round(parseFloat(stage.style.height))).toBe(Math.round(820 * (1686 / 2500)))
  })

  it('canEdit=false — ไม่มีปุ่มแก้ไขใดๆ เลย (โหมดดูอย่างเดียว)', () => {
    draw({ canEdit: false })
    expect(screen.queryByText('+ เพิ่มภาพ')).toBeNull()
    expect(screen.queryByText('+ เพิ่มข้อความ')).toBeNull()
    expect(screen.queryByText('ใช้')).toBeNull()
  })
})

describe('Compositor · เพิ่มชั้น', () => {
  it('เพิ่มข้อความ — ปรากฏในลำดับชั้นทันทีและถูกเลือกอยู่', async () => {
    const { container, saveComposition } = draw()
    fireEvent.click(screen.getByText('+ เพิ่มข้อความ'))

    await waitFor(() => expect(saveComposition).toHaveBeenCalled())
    // "ข้อความใหม่" ปรากฏทั้งบนพื้นที่แต่งภาพจริงและในลำดับชั้น — เช็คว่ามีอย่างน้อยหนึ่งที่
    expect(screen.getAllByText(/ข้อความใหม่/).length).toBeGreaterThan(0)
    const rows = container.querySelectorAll('[data-layer-row]')
    expect(rows).toHaveLength(1)
  })

  it('เพิ่มภาพจากคลังที่มีอยู่แล้ว (ไม่ต้องอัปโหลดใหม่) — ปรากฏในลำดับชั้น', async () => {
    const { container, saveComposition } = draw()
    fireEvent.click(screen.getByTitle('ใช้ภาพนี้เป็นชั้นใหม่'))

    await waitFor(() => expect(saveComposition).toHaveBeenCalled())
    expect(container.querySelectorAll('[data-layer-row]')).toHaveLength(1)
  })

  it('อัปโหลดภาพใหม่ — เรียก uploadLayerImage แล้วเพิ่มเป็นชั้นทันทีที่สำเร็จ', async () => {
    const { container, uploadLayerImage, saveComposition } = draw()
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => expect(uploadLayerImage).toHaveBeenCalled())
    await waitFor(() => expect(saveComposition).toHaveBeenCalled())
    expect(container.querySelectorAll('[data-layer-row]')).toHaveLength(1)
  })
})

describe('Compositor · จัดแนว', () => {
  it('ยังไม่ได้เลือกชั้นไหน — ปุ่มจัดแนวถูกปิดใช้งานทั้งหมด', () => {
    draw({ initialComposition: composed([image()]) })
    for (const button of screen.getAllByRole('button', { name: /ชิด|กึ่งกลาง/ })) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('เลือกชั้นแล้วกด "ชิดซ้าย" — x กลายเป็น 0 ตรงกับ alignLayer', async () => {
    const { container, saveComposition } = draw({ initialComposition: composed([image({ x: 300 })]) })
    fireEvent.pointerDown(container.querySelector('[data-layer-id="img-1"]')!)
    fireEvent.click(screen.getByRole('button', { name: '⇤ ชิดซ้าย' }))

    await waitFor(() => {
      const call = saveComposition.mock.calls.at(-1)
      expect(call?.[2].layers[0].x).toBe(0)
    })
  })

  it('คลิกที่ตัวชั้นบนพื้นที่แต่งภาพ (pointerdown+click ตามลำดับจริงของเบราว์เซอร์) — ยังเลือกอยู่ ไม่ถูกยกเลิกด้วย onClick ของพื้นหลัง', () => {
    const { container } = draw({ initialComposition: composed([image()]) })
    const node = container.querySelector('[data-layer-id="img-1"]')!
    // เบราว์เซอร์จริงยิง click ตามหลัง pointerdown/pointerup บนเป้าหมายเดียวกันเสมอ
    // และ click นั้นไหลขึ้นไปโดน onClick ของพื้นที่แต่งภาพ (ซึ่งเคลียร์ selectedId)
    // ถ้าไม่ได้ stopPropagation ไว้ที่ตัวชั้นด้วย
    fireEvent.pointerDown(node)
    fireEvent.click(node)

    for (const button of screen.getAllByRole('button', { name: /ชิด|กึ่งกลาง/ })) {
      expect((button as HTMLButtonElement).disabled).toBe(false)
    }
  })
})

describe('Compositor · ทำสำเนา/ลบ', () => {
  it('ทำสำเนาชั้น — จำนวนชั้นเพิ่มขึ้นหนึ่ง', async () => {
    const { container, saveComposition } = draw({ initialComposition: composed([image()]) })
    fireEvent.click(screen.getByLabelText('ทำสำเนา'))
    await waitFor(() => expect(saveComposition).toHaveBeenCalled())
    expect(container.querySelectorAll('[data-layer-row]')).toHaveLength(2)
  })

  it('ลบชั้น — หายไปจากลำดับชั้น', async () => {
    const { container, saveComposition } = draw({ initialComposition: composed([image(), text()]) })
    expect(container.querySelectorAll('[data-layer-row]')).toHaveLength(2)
    fireEvent.click(screen.getAllByLabelText('ลบชั้นนี้')[0])
    await waitFor(() => expect(saveComposition).toHaveBeenCalled())
    expect(container.querySelectorAll('[data-layer-row]')).toHaveLength(1)
  })
})

describe('Compositor · พื้นหลัง', () => {
  it('เปลี่ยนสีพื้นหลัง — สไตล์ของพื้นที่แต่งภาพเปลี่ยนตาม', async () => {
    const { container, saveComposition } = draw()
    const input = container.querySelector('input[type="color"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '#3366cc' } })

    await waitFor(() => expect(saveComposition).toHaveBeenCalled())
    const stage = container.querySelector('[data-compositor-stage]') as HTMLElement
    expect(stage.style.background).toBe('rgb(51, 102, 204)')
  })
})

describe('Compositor · ย้อนกลับ/ทำซ้ำ', () => {
  it('เพิ่มข้อความแล้วย้อนกลับ — ลำดับชั้นกลับไปว่างเหมือนเดิม', async () => {
    const { container, saveComposition } = draw()
    fireEvent.click(screen.getByText('+ เพิ่มข้อความ'))
    await waitFor(() => expect(saveComposition).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('↶ ย้อนกลับ'))
    await waitFor(() => expect(saveComposition).toHaveBeenCalledTimes(2))
    expect(container.querySelectorAll('[data-layer-row]')).toHaveLength(0)
  })

  it('ย้อนกลับแล้วทำซ้ำ — ชั้นกลับมาอีกครั้ง', async () => {
    const { container, saveComposition } = draw()
    fireEvent.click(screen.getByText('+ เพิ่มข้อความ'))
    await waitFor(() => expect(saveComposition).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByText('↶ ย้อนกลับ'))
    await waitFor(() => expect(saveComposition).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByText('↷ ทำซ้ำ'))
    await waitFor(() => expect(saveComposition).toHaveBeenCalledTimes(3))
    expect(container.querySelectorAll('[data-layer-row]')).toHaveLength(1)
  })

  it('ยังไม่มีอะไรให้ย้อนกลับ — ปุ่มถูกปิดใช้งาน', () => {
    draw()
    expect((screen.getByText('↶ ย้อนกลับ') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('↷ ทำซ้ำ') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('Compositor · บันทึกล้มเหลว', () => {
  it('saveComposition ล้ม — ย้อน state กลับและแสดงเหตุผล', async () => {
    const saveComposition = vi.fn(async () => { throw new Error('เครือข่ายขัดข้อง') })
    const { container } = draw({ saveComposition })
    fireEvent.click(screen.getByText('+ เพิ่มข้อความ'))

    await waitFor(() => expect(screen.getByText('เครือข่ายขัดข้อง')).toBeDefined())
    expect(container.querySelectorAll('[data-layer-row]')).toHaveLength(0)
  })
})

describe('Compositor · ปุ่ม "ใช้"', () => {
  it('กด "ใช้" — เรียก applyComposition แล้วพาไปหน้ารายการเมนู', async () => {
    const { applyComposition } = draw({ initialComposition: composed([image()]) })
    fireEvent.click(screen.getByText('ใช้'))

    await waitFor(() => expect(applyComposition).toHaveBeenCalledWith('c1', 'menu-1', expect.objectContaining({
      canvasWidth: 2500, canvasHeight: 1686,
    })))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/campaigns/c1/richmenu'))
  })

  it('applyComposition ล้ม — แสดงเหตุผล ไม่พาไปไหน', async () => {
    const applyComposition = vi.fn(async () => { throw new Error('สร้างภาพไม่ได้') })
    draw({ applyComposition, initialComposition: composed([image()]) })
    fireEvent.click(screen.getByText('ใช้'))

    await waitFor(() => expect(screen.getByText('สร้างภาพไม่ได้')).toBeDefined())
    expect(push).not.toHaveBeenCalled()
  })
})

function composed(layers: Composition['layers']): Composition {
  return { canvasWidth: canvas.width, canvasHeight: canvas.height, background: { type: 'color', color: '#FFFFFF' }, layers }
}
