'use client'

import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Field, Note } from '@/components/ui'
import {
  IMAGEMAP_REFERENCE_WIDTH, type TapAction, type TapArea,
} from '@/lib/imagemap/regions'
import type { Rect } from '@/lib/richmenu/gesture'
import { AreaNode, areaSummary } from './AreaNode'

/**
 * ตัวแก้ไขริชเมสเสจ/ริชวิดีโอ (Rich Message/Rich Video · imagemap ภาพล้วน หรือ
 * imagemap_video มีวิดีโอเล่นทับ — คนละ cardKind แต่จอเดียวกัน) — โครงเดียวกับ
 * components/richmenu/Compositor.tsx (M4-S02): ถือ state ทั้งชุดของจอนี้ไว้เอง แล้ว
 * ส่งฟังก์ชันแก้ไขลงไปให้ลูก (AreaNode) ทุกจุดที่แก้ไขไหลผ่าน applyChange() เพื่อให้
 * ทุกการกระทำได้บันทึกอัตโนมัติแบบเดียวกันหมด
 *
 * ต่างจาก Compositor ตรงที่ไม่มีชั้นภาพหลายชั้นให้จัดเรียง — มีภาพฐานภาพเดียว
 * (อัปโหลด/แทนที่ได้) บวกพื้นที่กดหลายจุดวางทับ ไม่มีลำดับซ้อนให้สลับ
 *
 * cardKind === 'imagemap_video' เพิ่มมาสามอย่าง: อัปโหลดวิดีโอ + ภาพตัวอย่าง (สอง
 * ไฟล์คนละ input) พื้นที่เล่นวิดีโอหนึ่งกล่อง (ใช้ AreaNode/lib/richmenu/gesture.ts
 * ตัวเดียวกับพื้นที่กดตรงๆ — ไม่มีชนิดแอ็กชันให้เลือกเพราะไม่ใช่พื้นที่กด) และลิงก์
 * สองช่อง (URL + ป้ายกำกับ) ที่โชว์หลังเล่นจบ — ไม่มีขั้นตอน "กด ใช้" แยกสำหรับวิดีโอ
 * (ไม่มีการแปลงไฟล์วิดีโอในสไลซ์นี้) วิดีโอพร้อมส่งทันทีที่ครบสามอย่าง
 *
 * เซิร์ฟเวอร์แอ็กชันรับมาเป็น prop ไม่ import ตรงๆ (ธรรมเนียมเดียวกับ
 * Compositor.tsx/ChatSim.tsx) — คอมโพเนนต์นี้ทดสอบได้โดยไม่ต้อง mock module
 */

const STAGE_DISPLAY_WIDTH = 820
const DEFAULT_AREA_SIZE = { width: 260, height: 140 }
const DEFAULT_VIDEO_AREA_SIZE = { width: 400, height: 225 }
const DEFAULT_URI = 'https://example.com'
/** id ปลอมของกล่องพื้นที่เล่นวิดีโอบนเวที — ไม่มีทางชนกับ id จริงของพื้นที่กด (newId() สุ่ม UUID) */
const VIDEO_AREA_ID = '__video__'

export type VideoRect = { x: number; y: number; width: number; height: number }

export type ImagemapEditorInitial = {
  baseImageUrl: string | null
  baseWidth: number | null
  baseHeight: number | null
  altText: string
  actions: TapArea[]
  /** เคยกด "ใช้" สำเร็จแล้วอย่างน้อยหนึ่งครั้งไหม (มีภาพ 5 ขนาดจริง) */
  ready: boolean
  /** ต่อไปนี้มีความหมายเฉพาะ cardKind === 'imagemap_video' */
  videoUrl?: string | null
  videoPreviewUrl?: string | null
  videoArea?: VideoRect | null
  videoLinkUri?: string
  videoLinkLabel?: string
}

export type ImagemapDraftPayload = {
  actions: TapArea[]; altText: string
  videoArea?: VideoRect | null; videoLinkUri?: string; videoLinkLabel?: string
}

export type ImagemapEditorProps = {
  campaignId: string
  cardId: string
  initial: ImagemapEditorInitial
  canEdit: boolean
  backHref: string
  /** 'imagemap_video' เปิดช่องอัปโหลดวิดีโอ/ภาพตัวอย่าง/พื้นที่เล่นวิดีโอเพิ่มมา — ค่าเริ่มต้นคือ 'imagemap' (ริชเมสเสจภาพล้วน) */
  cardKind?: 'imagemap' | 'imagemap_video'
  uploadBaseImage: (
    campaignId: string, cardId: string, formData: FormData,
  ) => Promise<{ url: string; baseWidth: number; baseHeight: number }>
  saveDraft: (campaignId: string, cardId: string, payload: ImagemapDraftPayload) => Promise<void>
  applyImagemap: (campaignId: string, cardId: string, payload: ImagemapDraftPayload) => Promise<void>
  /** บังคับมีเมื่อ cardKind === 'imagemap_video' เท่านั้น */
  uploadVideo?: (campaignId: string, cardId: string, formData: FormData) => Promise<{ url: string }>
  uploadVideoPreview?: (campaignId: string, cardId: string, formData: FormData) => Promise<{ url: string }>
}

const newId = (): string =>
  (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`)

export function ImagemapEditor({
  campaignId, cardId, initial, canEdit, backHref, cardKind = 'imagemap',
  uploadBaseImage, saveDraft, applyImagemap, uploadVideo, uploadVideoPreview,
}: ImagemapEditorProps) {
  const router = useRouter()
  const isVideoKind = cardKind === 'imagemap_video'

  const [actions, setActions] = useState<TapArea[]>(initial.actions)
  const [altText, setAltText] = useState(initial.altText)
  const [altTextDraft, setAltTextDraft] = useState(initial.altText)
  const [baseImageUrl, setBaseImageUrl] = useState(initial.baseImageUrl)
  const [baseWidth, setBaseWidth] = useState(initial.baseWidth)
  const [baseHeight, setBaseHeight] = useState(initial.baseHeight)
  const [ready, setReady] = useState(initial.ready)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const [videoUrl, setVideoUrl] = useState(initial.videoUrl ?? null)
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(initial.videoPreviewUrl ?? null)
  const [videoArea, setVideoArea] = useState<VideoRect | null>(initial.videoArea ?? null)
  const [videoLinkUri, setVideoLinkUri] = useState(initial.videoLinkUri ?? '')
  const [videoLinkUriDraft, setVideoLinkUriDraft] = useState(initial.videoLinkUri ?? '')
  const [videoLinkLabel, setVideoLinkLabel] = useState(initial.videoLinkLabel ?? '')
  const [videoLinkLabelDraft, setVideoLinkLabelDraft] = useState(initial.videoLinkLabel ?? '')
  const [uploadingVideo, setUploadingVideo] = useState(false)
  const [uploadingPreview, setUploadingPreview] = useState(false)
  const videoFileInput = useRef<HTMLInputElement>(null)
  const previewFileInput = useRef<HTMLInputElement>(null)

  const scale = STAGE_DISPLAY_WIDTH / IMAGEMAP_REFERENCE_WIDTH
  const stageHeight = (baseHeight ?? 585) * scale
  const hasImage = baseImageUrl !== null && baseHeight !== null
  const hasVideoFiles = videoUrl !== null && videoPreviewUrl !== null

  /**
   * จุดผ่านเดียวของทุกการแก้ไข (เหมือน applyChange ของ Compositor.tsx) — อัปเดต
   * state ทันทีให้จอตอบสนองไว แล้วค่อยยิงบันทึกไปเซิร์ฟเวอร์ทีหลัง ถ้าบันทึกล้มให้
   * ย้อน state กลับและบอกเหตุผล — state ที่จอแสดงต้องไม่โกหกว่าบันทึกสำเร็จทั้งที่
   * ไม่จริง
   *
   * พารามิเตอร์วิดีโอสามตัวท้ายมีค่าเริ่มต้นเป็น state ปัจจุบันเสมอ (ประเมินตอนเรียก
   * จาก closure) — จุดเรียกเดิมทั้งหมด (onCommitBox/onCommitAction/onAddArea/
   * onDeleteArea/commitAltText) ที่ไม่รู้จักวิดีโอเลยยังเรียกแค่สองอาร์กิวเมนต์แรกได้
   * เหมือนเดิม โดยไม่ได้แตะพื้นที่เล่นวิดีโอ/ลิงก์โดยไม่ได้ตั้งใจ
   */
  async function applyChange(
    nextActions: TapArea[], nextAltText: string,
    nextVideoArea: VideoRect | null = videoArea,
    nextVideoLinkUri: string = videoLinkUri,
    nextVideoLinkLabel: string = videoLinkLabel,
  ): Promise<void> {
    const previousActions = actions
    const previousAltText = altText
    const previousVideoArea = videoArea
    const previousVideoLinkUri = videoLinkUri
    const previousVideoLinkLabel = videoLinkLabel
    setActions(nextActions)
    setAltText(nextAltText)
    setVideoArea(nextVideoArea)
    setVideoLinkUri(nextVideoLinkUri)
    setVideoLinkLabel(nextVideoLinkLabel)
    setError(null)

    try {
      await saveDraft(campaignId, cardId, {
        actions: nextActions, altText: nextAltText,
        videoArea: nextVideoArea, videoLinkUri: nextVideoLinkUri, videoLinkLabel: nextVideoLinkLabel,
      })
    } catch (err) {
      setActions(previousActions)
      setAltText(previousAltText)
      setVideoArea(previousVideoArea)
      setVideoLinkUri(previousVideoLinkUri)
      setVideoLinkLabel(previousVideoLinkLabel)
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ — ลองใหม่')
    }
  }

  function onCommitBox(id: string, box: Rect): void {
    void applyChange(actions.map((a) => (a.id === id ? { ...a, ...box } : a)), altText)
  }

  function onCommitAction(id: string, action: TapAction): void {
    void applyChange(actions.map((a) => (a.id === id ? { ...a, action } : a)), altText)
  }

  function onAddArea(): void {
    if (!hasImage || baseHeight === null) return
    const width = Math.min(DEFAULT_AREA_SIZE.width, IMAGEMAP_REFERENCE_WIDTH)
    const height = Math.min(DEFAULT_AREA_SIZE.height, baseHeight)
    const area: TapArea = {
      id: newId(),
      x: Math.max(0, (IMAGEMAP_REFERENCE_WIDTH - width) / 2),
      y: Math.max(0, (baseHeight - height) / 2),
      width, height,
      action: { type: 'uri', linkUri: DEFAULT_URI },
    }
    setSelectedId(area.id)
    void applyChange([...actions, area], altText)
  }

  function onDeleteArea(id: string): void {
    if (selectedId === id) setSelectedId(null)
    void applyChange(actions.filter((a) => a.id !== id), altText)
  }

  function commitAltText(): void {
    if (altTextDraft === altText) return
    void applyChange(actions, altTextDraft)
  }

  /** พื้นที่เล่นวิดีโอถูกลาก/ปรับขนาดผ่าน AreaNode ตัวเดียวกับพื้นที่กด — คณิตศาสตร์เดียวกัน กล่องเดียว ไม่มีชนิดแอ็กชันให้เลือก */
  function onCommitVideoArea(box: Rect): void {
    void applyChange(actions, altText, box)
  }

  function onAddVideoArea(): void {
    if (baseHeight === null) return
    const width = Math.min(DEFAULT_VIDEO_AREA_SIZE.width, IMAGEMAP_REFERENCE_WIDTH)
    const height = Math.min(DEFAULT_VIDEO_AREA_SIZE.height, baseHeight)
    const area: VideoRect = {
      x: Math.max(0, (IMAGEMAP_REFERENCE_WIDTH - width) / 2),
      y: Math.max(0, (baseHeight - height) / 2),
      width, height,
    }
    setSelectedId(VIDEO_AREA_ID)
    void applyChange(actions, altText, area)
  }

  function onDeleteVideoArea(): void {
    if (selectedId === VIDEO_AREA_ID) setSelectedId(null)
    void applyChange(actions, altText, null)
  }

  function commitVideoLinkUri(): void {
    if (videoLinkUriDraft === videoLinkUri) return
    void applyChange(actions, altText, videoArea, videoLinkUriDraft)
  }

  function commitVideoLinkLabel(): void {
    if (videoLinkLabelDraft === videoLinkLabel) return
    void applyChange(actions, altText, videoArea, videoLinkUri, videoLinkLabelDraft)
  }

  async function onUploadImage(file: File): Promise<void> {
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const result = await uploadBaseImage(campaignId, cardId, form)
      setBaseImageUrl(result.url)
      setBaseWidth(result.baseWidth)
      setBaseHeight(result.baseHeight)
      // เปลี่ยนภาพฐานแล้ว — ภาพ 5 ขนาดชุดเดิม (ถ้ามี) ไม่ตรงกับภาพใหม่อีกต่อไป
      // (setImagemapBaseImage ล้าง variant_assets ทิ้งฝั่งฐานข้อมูลไว้แล้ว) จอต้อง
      // แสดงสถานะ "ยังไม่พร้อมส่ง" เหมือนกันจนกว่าจะกด "ใช้" ใหม่
      setReady(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'อัปโหลดภาพไม่สำเร็จ — ลองใหม่')
    } finally {
      setUploading(false)
    }
  }

  async function onUploadVideoFile(file: File): Promise<void> {
    if (!uploadVideo) return
    setUploadingVideo(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const result = await uploadVideo(campaignId, cardId, form)
      setVideoUrl(result.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'อัปโหลดวิดีโอไม่สำเร็จ — ลองใหม่')
    } finally {
      setUploadingVideo(false)
    }
  }

  async function onUploadVideoPreviewFile(file: File): Promise<void> {
    if (!uploadVideoPreview) return
    setUploadingPreview(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const result = await uploadVideoPreview(campaignId, cardId, form)
      setVideoPreviewUrl(result.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'อัปโหลดภาพตัวอย่างไม่สำเร็จ — ลองใหม่')
    } finally {
      setUploadingPreview(false)
    }
  }

  async function onApply(): Promise<void> {
    setApplying(true)
    setError(null)
    try {
      await applyImagemap(campaignId, cardId, { actions, altText })
      setReady(true)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'สร้างภาพไม่สำเร็จ — ลองใหม่')
    } finally {
      setApplying(false)
    }
  }

  const selectedArea = actions.find((a) => a.id === selectedId) ?? null
  const videoAreaSelected = isVideoKind && selectedId === VIDEO_AREA_ID

  return (
    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 10,
        background: 'var(--ground)', padding: 12, borderRadius: 'var(--r)',
      }}
      >
        <div
          data-imagemap-stage
          onClick={() => setSelectedId(null)}
          style={{
            position: 'relative', width: STAGE_DISPLAY_WIDTH, height: stageHeight,
            background: 'var(--panel-2)', border: '1px solid var(--rule-2)', overflow: 'hidden',
            boxShadow: '0 1px 6px var(--rule-2)',
          }}
        >
          {hasImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={baseImageUrl ?? undefined} alt="" draggable={false}
              style={{ width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none' }}
            />
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%',
              color: 'var(--ink-3)', fontSize: 13,
            }}
            >
              ยังไม่มีภาพฐาน — อัปโหลดภาพก่อนจึงจะวาดพื้นที่กดได้
            </div>
          )}

          {hasImage && actions.map((area) => (
            <AreaNode
              key={area.id}
              area={area}
              label={areaSummary(area)}
              scale={scale}
              selected={area.id === selectedId}
              canEdit={canEdit}
              onSelect={() => setSelectedId(area.id)}
              onCommitBox={(box) => onCommitBox(area.id, box)}
            />
          ))}

          {/* พื้นที่เล่นวิดีโอ — กล่องเดียว ไม่มีชนิดแอ็กชัน ใช้ AreaNode ตัวเดียวกับพื้นที่กดตรงๆ (คณิตศาสตร์ลาก/ปรับขนาดเดียวกันเป๊ะ) */}
          {hasImage && isVideoKind && videoArea && (
            <AreaNode
              area={{ id: VIDEO_AREA_ID, ...videoArea }}
              label="🎬 วิดีโอ"
              scale={scale}
              selected={videoAreaSelected}
              canEdit={canEdit}
              onSelect={() => setSelectedId(VIDEO_AREA_ID)}
              onCommitBox={onCommitVideoArea}
            />
          )}
        </div>

        {canEdit && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={fileButtonStyle}>
              {uploading ? 'กำลังอัปโหลด…' : hasImage ? 'แทนที่ภาพฐาน' : '+ อัปโหลดภาพฐาน'}
              <input
                ref={fileInput}
                type="file" accept="image/png,image/jpeg" style={{ display: 'none' }}
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void onUploadImage(file)
                  event.target.value = ''
                }}
              />
            </label>
            <Button type="button" variant="ghost" disabled={!hasImage} onClick={onAddArea}>
              + เพิ่มพื้นที่กด
            </Button>

            {isVideoKind && (
              <>
                <label style={fileButtonStyle}>
                  {uploadingVideo ? 'กำลังอัปโหลด…' : videoUrl ? 'แทนที่วิดีโอ' : '+ อัปโหลดวิดีโอ'}
                  <input
                    ref={videoFileInput}
                    type="file" accept="video/mp4" style={{ display: 'none' }}
                    disabled={uploadingVideo}
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) void onUploadVideoFile(file)
                      event.target.value = ''
                    }}
                  />
                </label>
                <label style={fileButtonStyle}>
                  {uploadingPreview ? 'กำลังอัปโหลด…' : videoPreviewUrl ? 'แทนที่ภาพตัวอย่าง' : '+ อัปโหลดภาพตัวอย่าง'}
                  <input
                    ref={previewFileInput}
                    type="file" accept="image/png,image/jpeg" style={{ display: 'none' }}
                    disabled={uploadingPreview}
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) void onUploadVideoPreviewFile(file)
                      event.target.value = ''
                    }}
                  />
                </label>
                <Button type="button" variant="ghost" disabled={!hasImage || !hasVideoFiles || !!videoArea} onClick={onAddVideoArea}>
                  + วางพื้นที่เล่นวิดีโอ
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 280, flex: 1 }}>
        {error && <Note tone="danger">{error}</Note>}

        <Note tone={ready ? 'info' : 'warn'}>
          {ready
            ? 'พร้อมส่งจริง — เคยกด "ใช้" สำเร็จแล้ว มีภาพครบทั้งห้าขนาด'
            : 'ยังไม่พร้อมส่ง — กด "ใช้" ด้านล่างเพื่อปั้นภาพ 5 ขนาดจริงก่อน'}
        </Note>

        {isVideoKind && (
          <Note tone={hasVideoFiles && videoArea ? 'info' : 'warn'}>
            {hasVideoFiles && videoArea
              ? 'วิดีโอพร้อมส่งแล้ว — ไม่ต้องกด "ใช้" ซ้ำ (ไม่มีขั้นตอนแปลงไฟล์วิดีโอ)'
              : 'วิดีโอยังไม่พร้อมส่ง — ต้องอัปโหลดวิดีโอ ภาพตัวอย่าง และวางพื้นที่เล่นให้ครบทั้งสามอย่าง'}
          </Note>
        )}

        <Field label="ข้อความสำรอง (alt text)" hint="สิ่งที่ผู้เล่นเห็นในแจ้งเตือน — LINE บังคับให้มีเสมอ">
          <input
            type="text"
            value={altTextDraft}
            disabled={!canEdit}
            onChange={(event) => setAltTextDraft(event.target.value)}
            onBlur={commitAltText}
          />
        </Field>

        {canEdit && selectedArea && (
          <AreaForm area={selectedArea} onCommitAction={(action) => onCommitAction(selectedArea.id, action)} onDelete={() => onDeleteArea(selectedArea.id)} />
        )}

        {isVideoKind && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid var(--rule)', borderRadius: 'var(--r)', padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={labelStyle}>วิดีโอ</span>
              {canEdit && videoArea && (
                <button type="button" aria-label="ลบพื้นที่เล่นวิดีโอ" onClick={onDeleteVideoArea} style={iconButtonStyle}>
                  ✕ ลบพื้นที่เล่น
                </button>
              )}
            </div>

            <Field label="ลิงก์หลังเล่นจบ (ไม่บังคับ)" hint="โชว์เป็นข้อความกดได้หลังวิดีโอเล่นจบ">
              <input
                type="text"
                value={videoLinkUriDraft}
                disabled={!canEdit}
                onChange={(event) => setVideoLinkUriDraft(event.target.value)}
                onBlur={commitVideoLinkUri}
              />
            </Field>

            <Field label="ป้ายกำกับลิงก์ (ไม่บังคับ)">
              <input
                type="text"
                value={videoLinkLabelDraft}
                disabled={!canEdit}
                onChange={(event) => setVideoLinkLabelDraft(event.target.value)}
                onBlur={commitVideoLinkLabel}
              />
            </Field>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>พื้นที่กดทั้งหมด ({actions.length})</span>
          {actions.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>ยังไม่มีพื้นที่กดเลย</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {actions.map((area) => (
                <div
                  key={area.id}
                  onClick={() => setSelectedId(area.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px',
                    border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)',
                    background: area.id === selectedId ? 'var(--ground)' : 'var(--panel)',
                    fontSize: 12, cursor: 'pointer',
                  }}
                >
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {areaSummary(area)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {canEdit && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button type="button" onClick={() => router.push(backHref)} variant="ghost">← กลับ</Button>
            <Button type="button" onClick={onApply} disabled={applying || !hasImage}>
              {applying ? 'กำลังสร้างภาพ…' : 'ใช้'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function AreaForm({
  area, onCommitAction, onDelete,
}: { area: TapArea; onCommitAction: (action: TapAction) => void; onDelete: () => void }) {
  const [draft, setDraft] = useState<TapAction>(area.action)

  // ผู้ใช้เลือกพื้นที่ใหม่ — ต้องรีเซ็ตร่างให้ตรงกับพื้นที่ที่เพิ่งเลือก ไม่ใช่ค้างค่า
  // ของพื้นที่ก่อนหน้า (React ไม่รีเซ็ต local state ให้เองเมื่อ prop เปลี่ยน)
  const [trackedId, setTrackedId] = useState(area.id)
  if (trackedId !== area.id) {
    setTrackedId(area.id)
    setDraft(area.action)
  }

  const commit = (next: TapAction) => {
    setDraft(next)
    onCommitAction(next)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid var(--rule)', borderRadius: 'var(--r)', padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={labelStyle}>พื้นที่ที่เลือก</span>
        <button type="button" aria-label="ลบพื้นที่นี้" onClick={onDelete} style={iconButtonStyle}>✕ ลบ</button>
      </div>

      <Field label="ชนิดการกระทำ">
        <select
          value={draft.type}
          onChange={(event) => {
            const type = event.target.value as TapAction['type']
            commit(type === 'uri' ? { type: 'uri', linkUri: DEFAULT_URI } : { type: 'message', text: '' })
          }}
        >
          <option value="uri">เปิดลิงก์ (uri)</option>
          <option value="message">ส่งข้อความ (message)</option>
        </select>
      </Field>

      {draft.type === 'uri' ? (
        <Field label="ลิงก์ปลายทาง">
          <input
            type="text"
            value={draft.linkUri}
            onChange={(event) => setDraft({ ...draft, type: 'uri', linkUri: event.target.value })}
            onBlur={() => commit(draft)}
          />
        </Field>
      ) : (
        <Field label="ข้อความที่จะส่งกลับ">
          <input
            type="text"
            value={draft.text}
            onChange={(event) => setDraft({ ...draft, type: 'message', text: event.target.value })}
            onBlur={() => commit(draft)}
          />
        </Field>
      )}

      <Field label="ป้ายกำกับ (ไม่บังคับ)">
        <input
          type="text"
          value={draft.label ?? ''}
          onChange={(event) => setDraft({ ...draft, label: event.target.value })}
          onBlur={() => commit({ ...draft, label: draft.label?.trim() ? draft.label : undefined })}
        />
      </Field>
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

const iconButtonStyle: CSSProperties = {
  border: '1px solid var(--rule)', background: 'var(--panel)', borderRadius: 'var(--r-sm)',
  padding: '3px 8px', cursor: 'pointer', fontSize: 11, color: 'var(--danger)',
}
