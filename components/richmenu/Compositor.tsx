'use client'

import { useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Note } from '@/components/ui'
import type { AlignDirection } from '@/lib/richmenu/align'
import { alignLayer } from '@/lib/richmenu/align'
import type { Composition, ImageLayer, Layer, TextLayer } from '@/lib/richmenu/composition'
import { emptyComposition } from '@/lib/richmenu/composition'
import type { Rect } from '@/lib/richmenu/gesture'
import {
  addLayer, deleteLayer, duplicateLayer, moveLayerInStack, updateLayerBox, updateTextLayer,
  type StackMove,
} from '@/lib/richmenu/layers'
import { AlignToolbar } from './AlignToolbar'
import { BackgroundControl } from './BackgroundControl'
import { LayerList } from './LayerList'
import { LayerNode } from './LayerNode'

/**
 * ตัวประสานงานของจอ M4-S02 — ถือ state ของงานแต่งภาพทั้งชุด (layers/background/
 * ประวัติ undo-redo) แล้วส่งฟังก์ชันแก้ไขลงไปให้ลูกๆ (LayerNode/LayerList/
 * AlignToolbar/BackgroundControl) ทุกจุดที่แก้ไข composition ไหลผ่านฟังก์ชันเดียว
 * (`applyChange`) เพื่อให้ทุกการกระทำ — ลาก ปรับขนาด จัดแนว ทำสำเนา ลบ สลับลำดับ —
 * ได้ประวัติ undo-redo และการบันทึกอัตโนมัติแบบเดียวกันหมด ไม่มีทางลัดที่ลืมทำ
 * อย่างใดอย่างหนึ่ง
 *
 * เซิร์ฟเวอร์แอ็กชันทั้งสามตัวรับมาเป็น prop ไม่ import ตรงๆ (ธรรมเนียมเดียวกับ
 * ChatSim.tsx/PreviewPanel.tsx) — คอมโพเนนต์นี้ทดสอบได้โดยไม่ต้อง mock module
 */

const STAGE_DISPLAY_WIDTH = 820
const DEFAULT_TEXT_LAYER_COLOR = '#000000'

type HistoryEntry = { layers: Layer[]; background: Composition['background'] }

export type CompositorImage = { id: string; url: string; width: number; height: number }

export type CompositorProps = {
  campaignId: string
  menuId: string
  canvas: { width: number; height: number }
  initialComposition: Composition | null
  /** ภาพทั้งหมดที่คลังของแคมเปญนี้มีอยู่แล้ว — เลือกใช้ซ้ำเป็นชั้นใหม่ได้โดยไม่ต้องอัปโหลดซ้ำ */
  images: CompositorImage[]
  canEdit: boolean
  backHref: string
  uploadLayerImage: (campaignId: string, formData: FormData) => Promise<CompositorImage>
  saveComposition: (campaignId: string, menuId: string, composition: Composition) => Promise<void>
  applyComposition: (campaignId: string, menuId: string, composition: Composition) => Promise<{ id: string }>
}

const newId = (): string => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`)

export function Compositor({
  campaignId, menuId, canvas, initialComposition, images, canEdit, backHref,
  uploadLayerImage, saveComposition, applyComposition,
}: CompositorProps) {
  const router = useRouter()
  const start = initialComposition ?? emptyComposition(canvas)

  const [layers, setLayers] = useState<Layer[]>(start.layers)
  const [background, setBackground] = useState(start.background)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [imagesById, setImagesById] = useState<Map<string, CompositorImage>>(
    () => new Map(images.map((image) => [image.id, image])),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const history = useRef<{ past: HistoryEntry[]; future: HistoryEntry[] }>({ past: [], future: [] })
  const scale = STAGE_DISPLAY_WIDTH / canvas.width
  const stageHeight = canvas.height * scale

  const composition = (): Composition => ({ canvasWidth: canvas.width, canvasHeight: canvas.height, background, layers })

  /**
   * จุดผ่านเดียวของทุกการแก้ไข — เก็บสถานะก่อนหน้าไว้ undo ได้ อัปเดต state ทันที
   * (ให้จอตอบสนองไว) แล้วค่อยยิงบันทึกไปเซิร์ฟเวอร์ทีหลัง ถ้าบันทึกล้มให้ย้อน state
   * กลับและบอกเหตุผล — state ที่จอแสดงต้องไม่โกหกว่าบันทึกสำเร็จทั้งที่ไม่จริง
   */
  async function applyChange(next: HistoryEntry, pushToHistory = true): Promise<void> {
    const previous: HistoryEntry = { layers, background }
    if (pushToHistory) {
      history.current.past.push(previous)
      history.current.future = []
    }
    setLayers(next.layers)
    setBackground(next.background)
    setError(null)

    try {
      await saveComposition(campaignId, menuId, {
        canvasWidth: canvas.width, canvasHeight: canvas.height, background: next.background, layers: next.layers,
      })
    } catch (err) {
      setLayers(previous.layers)
      setBackground(previous.background)
      if (pushToHistory) history.current.past.pop()
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ — ลองใหม่')
    }
  }

  function undo(): void {
    const entry = history.current.past.pop()
    if (!entry) return
    history.current.future.push({ layers, background })
    void applyChange(entry, false)
  }

  function redo(): void {
    const entry = history.current.future.pop()
    if (!entry) return
    history.current.past.push({ layers, background })
    void applyChange(entry, false)
  }

  function onCommitBox(id: string, box: Rect): void {
    void applyChange({ layers: updateLayerBox(layers, id, box), background })
  }

  function onCommitText(id: string, text: string): void {
    void applyChange({ layers: updateTextLayer(layers, id, { text }), background })
  }

  function onAlign(direction: AlignDirection): void {
    if (!selectedId) return
    const next = layers.map((layer) => (layer.id === selectedId ? { ...layer, ...alignLayer(layer, canvas, direction) } : layer))
    void applyChange({ layers: next, background })
  }

  function onMove(id: string, move: StackMove): void {
    void applyChange({ layers: moveLayerInStack(layers, id, move), background })
  }

  function onReorder(nextOrder: string[]): void {
    const byId = new Map(layers.map((l) => [l.id, l]))
    const next = nextOrder.map((id) => byId.get(id)).filter((l): l is Layer => l !== undefined)
    void applyChange({ layers: next, background })
  }

  function onDuplicate(id: string): void {
    const copyId = newId()
    void applyChange({ layers: duplicateLayer(layers, id, copyId), background })
    setSelectedId(copyId)
  }

  function onDelete(id: string): void {
    void applyChange({ layers: deleteLayer(layers, id), background })
    if (selectedId === id) setSelectedId(null)
  }

  function onBackgroundChange(color: string): void {
    void applyChange({ layers, background: { type: 'color', color } })
  }

  function addImageLayerFromAsset(image: CompositorImage): void {
    const boxWidth = Math.min(canvas.width * 0.4, image.width)
    const boxHeight = boxWidth * (image.height / image.width)
    const layer: ImageLayer = {
      id: newId(), type: 'image', assetId: image.id, fit: 'cover',
      x: (canvas.width - boxWidth) / 2, y: (canvas.height - boxHeight) / 2, width: boxWidth, height: boxHeight,
    }
    setImagesById((prev) => new Map(prev).set(image.id, image))
    void applyChange({ layers: addLayer(layers, layer), background })
    setSelectedId(layer.id)
  }

  async function onUploadImage(file: File): Promise<void> {
    const form = new FormData()
    form.append('file', file)
    try {
      const image = await uploadLayerImage(campaignId, form)
      addImageLayerFromAsset(image)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'อัปโหลดภาพไม่สำเร็จ — ลองใหม่')
    }
  }

  function onAddText(): void {
    const width = canvas.width * 0.5
    const height = canvas.width * 0.08
    const layer: TextLayer = {
      id: newId(), type: 'text', text: 'ข้อความใหม่', fontSize: Math.round(canvas.width * 0.05),
      color: DEFAULT_TEXT_LAYER_COLOR, align: 'left', bold: false,
      x: (canvas.width - width) / 2, y: (canvas.height - height) / 2, width, height,
    }
    void applyChange({ layers: addLayer(layers, layer), background })
    setSelectedId(layer.id)
  }

  async function onApply(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await applyComposition(campaignId, menuId, composition())
      router.push(backHref)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'สร้างภาพไม่สำเร็จ — ลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  const selectedLayer = layers.find((l) => l.id === selectedId) ?? null

  return (
    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 10,
        background: 'var(--ground)', padding: 12, borderRadius: 'var(--r)',
      }}>
        <div
          data-compositor-stage
          onClick={() => setSelectedId(null)}
          style={{
            position: 'relative', width: STAGE_DISPLAY_WIDTH, height: stageHeight,
            background: background.color, border: '1px solid var(--rule-2)', overflow: 'hidden',
            boxShadow: '0 1px 6px var(--rule-2)',
          }}
        >
          {layers.map((layer) => (
            <LayerNode
              key={layer.id}
              layer={layer}
              scale={scale}
              imageUrl={layer.type === 'image' ? imagesById.get(layer.assetId)?.url : undefined}
              selected={layer.id === selectedId}
              canEdit={canEdit}
              onSelect={() => setSelectedId(layer.id)}
              onCommitBox={(box) => onCommitBox(layer.id, box)}
              onCommitText={(text) => onCommitText(layer.id, text)}
            />
          ))}
        </div>

        {canEdit && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button type="button" variant="ghost" disabled={history.current.past.length === 0} onClick={undo}>↶ ย้อนกลับ</Button>
            <Button type="button" variant="ghost" disabled={history.current.future.length === 0} onClick={redo}>↷ ทำซ้ำ</Button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 260, flex: 1 }}>
        {error && <Note tone="danger">{error}</Note>}

        {canEdit && (
          <>
            <BackgroundControl color={background.color} canEdit={canEdit} onChange={onBackgroundChange} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labelStyle}>จัดแนวชั้นที่เลือก</span>
              <AlignToolbar disabled={!selectedLayer} onAlign={onAlign} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={labelStyle}>เพิ่มชั้นใหม่</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <label style={fileButtonStyle}>
                  + เพิ่มภาพ
                  <input
                    type="file" accept="image/png,image/jpeg" style={{ display: 'none' }}
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) void onUploadImage(file)
                      event.target.value = ''
                    }}
                  />
                </label>
                <Button type="button" variant="ghost" onClick={onAddText}>+ เพิ่มข้อความ</Button>
              </div>
              {images.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {images.map((image) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={image.id} src={image.url} alt="" title="ใช้ภาพนี้เป็นชั้นใหม่"
                      onClick={() => addImageLayerFromAsset(image)}
                      style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--rule)', cursor: 'pointer' }}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>ลำดับชั้น ({layers.length})</span>
          <LayerList
            layers={layers} selectedId={selectedId} canEdit={canEdit}
            onSelect={setSelectedId} onReorder={onReorder} onMove={onMove}
            onDuplicate={onDuplicate} onDelete={onDelete}
          />
        </div>

        {canEdit && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button type="button" onClick={onApply} disabled={busy}>
              {busy ? 'กำลังสร้างภาพ…' : 'ใช้'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

const labelStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-3)',
}

const fileButtonStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', border: '1px solid var(--rule)', borderRadius: 'var(--r)',
  padding: '7px 13px', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'var(--panel)',
}
