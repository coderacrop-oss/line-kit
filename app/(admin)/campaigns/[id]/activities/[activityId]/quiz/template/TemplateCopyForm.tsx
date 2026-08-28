'use client'

import { useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, Button, ErrorModal, Field, Note, Panel } from '@/components/ui'
import type { BadgeTone } from '@/components/ui'
import { QuizConfig } from '@/lib/quiz/schema'
import { saveTemplateCopyAction } from '../actions'

export type TemplateCopyFormProps = {
  campaignId: string
  activityId: string
  initial: QuizConfig
  canEdit: boolean
}

// triggerCount ยอมเป็น string ระหว่างพิมพ์ (รวมค่าว่างกลางทาง) โดยตั้งใจ — Finding 8 ของ
// รีวิว, ดูคอมเมนต์ normalizeTriggerCount() ด้านล่าง
type Milestone = { key: string; label: string; icon?: string; triggerCount: number | string }

/**
 * โครง templateCopy ฉบับกรอกครบทุกช่อง (รวมกลุ่มที่ optional ในสคีมา เช่น
 * messages.soloShare/duoInvite/...) — ทุก input ในจอนี้จึงเป็น controlled input เสมอ
 * ไม่ว่า activity นี้จะเคยตั้งค่าเทมเพลตมาก่อนหรือยัง ตอน submit (toSubmittableTemplateCopy)
 * ค่อยตัดกลุ่ม optional ที่ยังว่างเปล่าออกก่อนส่งเข้า QuizConfig.safeParse จริง
 */
type DraftTemplateCopy = {
  brand: { name: string; primaryColor: string }
  intro: { title: string; body: string; ctaLabel: string }
  friendGate: { title: string; body: string; ctaLabel: string }
  openInLine: { title: string; body: string }
  invite: { shareTitle: string; shareBodyTemplate: string }
  rewards: { milestones: Milestone[] }
  messages: {
    resultCard: { eyebrow: string; ctaLabel: string }
    keywordCard: { title: string; body: string; ctaLabel: string; customFlexJson: string }
    soloShare: { badge: string; ctaLabel: string; secondaryCtaLabel: string }
    duoInvite: { titleTemplate: string; bodyTemplate: string; ctaLabel: string }
    duoPartnerAnswered: { badge: string; ctaLabel: string }
    duoPairResult: { badge: string; rankLineTemplate: string; ctaLabel: string }
    duoReminder: { badge: string; headlineTemplate: string; ctaLabel: string }
    groupComplete: { badge: string; ctaLabel: string }
    groupUnlock: { headlineTemplate: string; ctaLabel: string }
    groupReminder: { badge: string; headlineTemplate: string; subText: string; ctaLabel: string }
    groupInvite: {
      headerCompleteTemplate: string; headerIncompleteTemplate: string
      body: string; ctaLabel: string; secondaryCtaLabel: string
    }
  }
}

const EMPTY: DraftTemplateCopy = {
  brand: { name: '', primaryColor: '' },
  intro: { title: '', body: '', ctaLabel: '' },
  friendGate: { title: '', body: '', ctaLabel: '' },
  openInLine: { title: '', body: '' },
  invite: { shareTitle: '', shareBodyTemplate: '' },
  rewards: { milestones: [] },
  messages: {
    resultCard: { eyebrow: '', ctaLabel: '' },
    keywordCard: { title: '', body: '', ctaLabel: '', customFlexJson: '' },
    soloShare: { badge: '', ctaLabel: '', secondaryCtaLabel: '' },
    duoInvite: { titleTemplate: '', bodyTemplate: '', ctaLabel: '' },
    duoPartnerAnswered: { badge: '', ctaLabel: '' },
    duoPairResult: { badge: '', rankLineTemplate: '', ctaLabel: '' },
    duoReminder: { badge: '', headlineTemplate: '', ctaLabel: '' },
    groupComplete: { badge: '', ctaLabel: '' },
    groupUnlock: { headlineTemplate: '', ctaLabel: '' },
    groupReminder: { badge: '', headlineTemplate: '', subText: '', ctaLabel: '' },
    groupInvite: { headerCompleteTemplate: '', headerIncompleteTemplate: '', body: '', ctaLabel: '', secondaryCtaLabel: '' },
  },
}

function draftFromConfig(cfg: QuizConfig): DraftTemplateCopy {
  const tc = cfg.templateCopy
  const m = tc?.messages
  return {
    brand: { name: tc?.brand.name ?? '', primaryColor: tc?.brand.primaryColor ?? '' },
    intro: { title: tc?.intro.title ?? '', body: tc?.intro.body ?? '', ctaLabel: tc?.intro.ctaLabel ?? '' },
    friendGate: { title: tc?.friendGate.title ?? '', body: tc?.friendGate.body ?? '', ctaLabel: tc?.friendGate.ctaLabel ?? '' },
    openInLine: { title: tc?.openInLine.title ?? '', body: tc?.openInLine.body ?? '' },
    invite: { shareTitle: tc?.invite?.shareTitle ?? '', shareBodyTemplate: tc?.invite?.shareBodyTemplate ?? '' },
    rewards: { milestones: tc?.rewards.milestones ?? [] },
    messages: {
      resultCard: { eyebrow: m?.resultCard.eyebrow ?? '', ctaLabel: m?.resultCard.ctaLabel ?? '' },
      keywordCard: {
        title: m?.keywordCard.title ?? '', body: m?.keywordCard.body ?? '', ctaLabel: m?.keywordCard.ctaLabel ?? '',
        customFlexJson: m?.keywordCard.customFlexJson !== undefined ? JSON.stringify(m.keywordCard.customFlexJson) : '',
      },
      soloShare: { badge: m?.soloShare?.badge ?? '', ctaLabel: m?.soloShare?.ctaLabel ?? '', secondaryCtaLabel: m?.soloShare?.secondaryCtaLabel ?? '' },
      duoInvite: { titleTemplate: m?.duoInvite?.titleTemplate ?? '', bodyTemplate: m?.duoInvite?.bodyTemplate ?? '', ctaLabel: m?.duoInvite?.ctaLabel ?? '' },
      duoPartnerAnswered: { badge: m?.duoPartnerAnswered?.badge ?? '', ctaLabel: m?.duoPartnerAnswered?.ctaLabel ?? '' },
      duoPairResult: { badge: m?.duoPairResult?.badge ?? '', rankLineTemplate: m?.duoPairResult?.rankLineTemplate ?? '', ctaLabel: m?.duoPairResult?.ctaLabel ?? '' },
      duoReminder: { badge: m?.duoReminder?.badge ?? '', headlineTemplate: m?.duoReminder?.headlineTemplate ?? '', ctaLabel: m?.duoReminder?.ctaLabel ?? '' },
      groupComplete: { badge: m?.groupComplete?.badge ?? '', ctaLabel: m?.groupComplete?.ctaLabel ?? '' },
      groupUnlock: { headlineTemplate: m?.groupUnlock?.headlineTemplate ?? '', ctaLabel: m?.groupUnlock?.ctaLabel ?? '' },
      groupReminder: { badge: m?.groupReminder?.badge ?? '', headlineTemplate: m?.groupReminder?.headlineTemplate ?? '', subText: m?.groupReminder?.subText ?? '', ctaLabel: m?.groupReminder?.ctaLabel ?? '' },
      groupInvite: {
        headerCompleteTemplate: m?.groupInvite?.headerCompleteTemplate ?? '', headerIncompleteTemplate: m?.groupInvite?.headerIncompleteTemplate ?? '',
        body: m?.groupInvite?.body ?? '', ctaLabel: m?.groupInvite?.ctaLabel ?? '', secondaryCtaLabel: m?.groupInvite?.secondaryCtaLabel ?? '',
      },
    },
  }
}

/** กลุ่ม optional ที่ยังไม่มีใครกรอกอะไรเลยสักช่อง (ทุก field ว่าง) จะไม่ถูกส่งเข้า QuizConfig เลย
 * — กันไม่ให้ QuizConfig.safeParse ล้มเหลวเพราะช่องที่ไม่เกี่ยวกับโหมด/ผลลัพธ์กลุ่มปัจจุบัน
 * ถูกส่งไปเป็น string ว่างที่ผิด .min(1) โดยไม่จำเป็น */
function includeIfFilled<T extends Record<string, unknown>>(obj: T): T | undefined {
  const hasAny = Object.values(obj).some((v) => (typeof v === 'string' ? v.trim() !== '' : v !== undefined))
  return hasAny ? obj : undefined
}

/**
 * แยกวิเคราะห์ customFlexJson ออกมาต่างหาก (แทนที่จะ parse เงียบๆ ข้างใน
 * toSubmittableTemplateCopy แล้วเก็บ string ดิบไว้เมื่อ parse ไม่ผ่านแบบเดิม — Finding 6
 * ของรีวิว) คืน { value } เมื่อเป็น JSON object ที่ valid, หรือ { error } เป็นข้อความชัดเจน
 * เมื่อ parse ไม่ผ่านหรือ parse ผ่านแต่ไม่ใช่ object (เช่น array/string/number เดี่ยวๆ) —
 * ผู้เรียก (handleSubmit) ต้องปฏิเสธการบันทึกทันทีเมื่อได้ error กลับมา ไม่ใช่เงียบๆ ปล่อยผ่าน
 */
function parseCustomFlexJson(raw: string): { value?: Record<string, unknown>; error?: string } {
  const trimmed = raw.trim()
  if (trimmed === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { error: 'Flex JSON กำหนดเองไม่ใช่ JSON ที่ถูกต้อง — ตรวจสอบวงเล็บ/เครื่องหมายคำพูด/คอมม่าอีกครั้ง' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: 'Flex JSON กำหนดเองต้องเป็น object (เช่น {"type":"flex",...}) ไม่ใช่ array/ข้อความ/ตัวเลขเดี่ยวๆ' }
  }
  return { value: parsed as Record<string, unknown> }
}

/**
 * ด่านรางวัล (triggerCount) ยอมให้พิมพ์ค่ากลางทาง (รวมค่างว่างระหว่างลบเลขเก่าเพื่อพิมพ์
 * ใหม่) ได้โดยไม่ถูกบังคับกลับเป็น 1 ทุก keystroke (Finding 8 ของรีวิว) — normalize ค่าจริง
 * ที่จะส่งเข้า schema ตรงนี้แทน ที่จุดเดียวตอนประกอบ submittable ก่อนบันทึกจริง
 */
function normalizeTriggerCount(raw: number | string): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 1
}

function toSubmittableTemplateCopy(
  d: DraftTemplateCopy, customFlexJson: Record<string, unknown> | undefined,
): NonNullable<QuizConfig['templateCopy']> {
  return {
    brand: { name: d.brand.name, ...(d.brand.primaryColor.trim() !== '' ? { primaryColor: d.brand.primaryColor } : {}) },
    intro: d.intro,
    friendGate: d.friendGate,
    openInLine: d.openInLine,
    ...(includeIfFilled(d.invite) ? { invite: d.invite } : {}),
    rewards: {
      milestones: d.rewards.milestones.map((m) => ({ ...m, triggerCount: normalizeTriggerCount(m.triggerCount) })),
    },
    messages: {
      resultCard: d.messages.resultCard,
      keywordCard: {
        title: d.messages.keywordCard.title, body: d.messages.keywordCard.body, ctaLabel: d.messages.keywordCard.ctaLabel,
        ...(customFlexJson !== undefined ? { customFlexJson } : {}),
      },
      ...(includeIfFilled(d.messages.soloShare) ? { soloShare: d.messages.soloShare } : {}),
      ...(includeIfFilled(d.messages.duoInvite) ? { duoInvite: d.messages.duoInvite } : {}),
      ...(includeIfFilled(d.messages.duoPartnerAnswered) ? { duoPartnerAnswered: d.messages.duoPartnerAnswered } : {}),
      ...(includeIfFilled(d.messages.duoPairResult) ? { duoPairResult: d.messages.duoPairResult } : {}),
      ...(includeIfFilled(d.messages.duoReminder) ? { duoReminder: d.messages.duoReminder } : {}),
      ...(includeIfFilled(d.messages.groupComplete) ? { groupComplete: d.messages.groupComplete } : {}),
      ...(includeIfFilled(d.messages.groupUnlock) ? { groupUnlock: d.messages.groupUnlock } : {}),
      ...(includeIfFilled(d.messages.groupReminder) ? { groupReminder: d.messages.groupReminder } : {}),
      ...(includeIfFilled(d.messages.groupInvite) ? { groupInvite: d.messages.groupInvite } : {}),
    },
  }
}

function Text({ dataField, value, onChange, multiline }: {
  dataField: string; value: string; onChange: (v: string) => void; multiline?: boolean
}) {
  if (multiline) {
    return <textarea data-field={dataField} value={value} onChange={(e) => onChange(e.target.value)} rows={3} />
  }
  return <input data-field={dataField} type="text" value={value} onChange={(e) => onChange(e.target.value)} />
}

// ---------------------------------------------------------------------------
// Accordion chrome + live preview — pure presentation, no data-model changes
// (docs/superpowers/specs/2026-08-28-quiz-config-ux-redesign-design.md §4.4
// pattern, reference `~/Desktop/Codera/KimLIFF`'s ReplyDesigner.tsx — read-only,
// never modify that repo). Every input keeps its exact original `data-field`/
// `aria-label`, and collapsed sections stay mounted (hidden via `display:none`,
// never unmounted) so TemplateCopyForm.test.tsx's `container.querySelector`
// leaf-field check still finds every field regardless of which card is open.
// ---------------------------------------------------------------------------

const sectionHeadStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '13px 18px',
  width: '100%', background: 'transparent', border: 0, cursor: 'pointer', textAlign: 'left',
}

const numberBadgeStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22, borderRadius: '50%', background: 'var(--ink)', color: 'var(--panel)',
  fontSize: 11, fontWeight: 700, flexShrink: 0,
}

const triggerBoxStyle: CSSProperties = {
  border: '1px solid var(--rule)', borderRadius: 'var(--r)', padding: 13,
  background: 'var(--ground)', fontSize: 12, lineHeight: 1.7, color: 'var(--ink-2)',
}

function TriggerBox({ children }: { children: ReactNode }) {
  return (
    <div style={triggerBoxStyle}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>
        Trigger
      </div>
      {children}
    </div>
  )
}

/** ทดแทน `{key}` ด้วยค่าตัวอย่าง (เฉพาะพรีวิว — ไม่กระทบค่าที่บันทึกจริง) ให้เห็นรูปจริง
 * แทนที่จะเห็น `{axisName}`/`{rank}` ค้างเป็นตัวหนังสือดิบ */
function previewInterpolate(template: string, sample: Record<string, string>): string {
  let out = template
  for (const [key, value] of Object.entries(sample)) out = out.replaceAll(`{${key}}`, value)
  return out
}

/** พรีวิวการ์ด/ข้อความจำลอง — ไม่ใช่ตัว render Flex จริง (พอสำหรับดูคร่าวๆ ว่าจะส่งอะไรออกไป
 * ก่อนบันทึก) สีหลักดึงจาก brand.primaryColor ที่กรอกไว้ ให้เห็นว่าใช้แบรนด์สีจริงแล้วหน้าตา
 * เป็นยังไง */
function MessagePreview({ accentColor, kind, badge, title, body, ctaLabel, secondaryCtaLabel }: {
  accentColor: string
  kind: 'text' | 'flex'
  badge?: string
  title: string
  body: string
  ctaLabel?: string
  secondaryCtaLabel?: string
}) {
  const accent = accentColor.trim() || 'var(--ink)'
  const empty = !title.trim() && !body.trim() && !badge?.trim()

  if (empty) {
    return (
      <div style={{
        border: '1px dashed var(--rule)', borderRadius: 'var(--r-lg)', padding: 20,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center',
      }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>ยังไม่ได้กรอก</span>
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>พิมพ์ด้านซ้ายเพื่อดูตัวอย่างตรงนี้</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--ink-3)' }}>
        <span style={{ width: 18, height: 18, borderRadius: '50%', background: accent, display: 'inline-block', flexShrink: 0 }} />
        <span>OA</span>
      </div>
      {kind === 'text' ? (
        <div style={{
          border: '1px solid var(--rule)', borderRadius: '4px 14px 14px 14px', background: 'var(--panel)',
          padding: '10px 12px', fontSize: 12.5, lineHeight: 1.55, whiteSpace: 'pre-wrap', maxWidth: '92%',
        }}>
          {title.trim() && <div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div>}
          {body}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--rule)', borderRadius: 'var(--r-lg)', overflow: 'hidden', background: 'var(--panel)' }}>
          <div style={{ height: 10, background: accent }} />
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {badge?.trim() && (
              <span style={{
                alignSelf: 'flex-start', fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '.06em',
                textTransform: 'uppercase', color: accent, border: `1px solid ${accent}`, borderRadius: 5, padding: '2px 7px',
              }}>
                {badge}
              </span>
            )}
            {title.trim() && <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35 }}>{title}</div>}
            {body.trim() && <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>{body}</div>}
            {ctaLabel?.trim() && (
              <div style={{ marginTop: 4, padding: '9px 10px', borderRadius: 7, background: accent, color: 'var(--panel)', textAlign: 'center', fontSize: 12, fontWeight: 600 }}>
                {ctaLabel}
              </div>
            )}
            {secondaryCtaLabel?.trim() && (
              <div style={{ padding: '9px 10px', borderRadius: 7, border: `1px solid ${accent}`, color: accent, textAlign: 'center', fontSize: 12, fontWeight: 600 }}>
                {secondaryCtaLabel}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** พรีวิวหน้าจอ LIFF ล้วนๆ (friendGate/openInLine) — ไม่ใช่ข้อความ LINE เลย ไม่มี "OA" ส่งอะไร
 * จึงแยกหน้าตาจาก MessagePreview ให้ชัดว่านี่คือหน้าจอในแอป ไม่ใช่แชท */
function ScreenPreview({ accentColor, title, body, ctaLabel }: {
  accentColor: string; title: string; body: string; ctaLabel?: string
}) {
  const accent = accentColor.trim() || 'var(--ink)'
  return (
    <div style={{ border: '1px solid var(--rule)', borderRadius: 'var(--r-lg)', overflow: 'hidden', background: 'var(--panel)' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--rule)', fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
        หน้าจอในแอป LIFF
      </div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', textAlign: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{title.trim() || '(ยังไม่ได้กรอกหัวข้อ)'}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>{body.trim() || '(ยังไม่ได้กรอกเนื้อหา)'}</div>
        {ctaLabel?.trim() && (
          <div style={{ marginTop: 4, padding: '9px 16px', borderRadius: 7, background: accent, color: 'var(--panel)', fontSize: 12, fontWeight: 600 }}>
            {ctaLabel}
          </div>
        )}
      </div>
    </div>
  )
}

type SectionTone = BadgeTone
const PILL: Record<'reply' | 'push' | 'share' | 'screen' | 'settings', { label: string; tone: SectionTone }> = {
  reply: { label: 'Reply · ฟรี', tone: 'ok' },
  push: { label: 'Push · เสียโควตา', tone: 'warn' },
  share: { label: 'ShareTargetPicker · ฟรี', tone: 'info' },
  screen: { label: 'จอ LIFF · ไม่ส่งข้อความ', tone: 'mute' },
  settings: { label: 'ตั้งค่าทั่วไป', tone: 'mute' },
}

function Section({ n, title, pill, trigger, preview, isOpen, onToggle, children }: {
  n: number
  title: string
  pill: { label: string; tone: SectionTone }
  trigger: ReactNode
  preview: ReactNode
  isOpen: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <Panel>
      <button type="button" onClick={onToggle} aria-expanded={isOpen} style={sectionHeadStyle}>
        <span style={numberBadgeStyle}>{n}</span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        <Badge tone={pill.tone}>{pill.label}</Badge>
        <span style={{ flex: 1 }} />
        <span aria-hidden="true" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{isOpen ? '▾' : '▸'}</span>
      </button>
      <div style={{
        display: isOpen ? 'grid' : 'none',
        gridTemplateColumns: 'minmax(0, 1fr) 240px', gap: 20, alignItems: 'start',
        padding: 18, borderTop: '1px solid var(--rule)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <TriggerBox>{trigger}</TriggerBox>
          {children}
        </div>
        <div style={{ minWidth: 0 }}>{preview}</div>
      </div>
    </Panel>
  )
}

export function TemplateCopyForm({ campaignId, activityId, initial, canEdit }: TemplateCopyFormProps) {
  const router = useRouter()
  const [config] = useState(initial)
  const [draft, setDraft] = useState<DraftTemplateCopy>(() => draftFromConfig(initial))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [savedTick, setSavedTick] = useState(0)
  const [openSection, setOpenSection] = useState<string>('brand')

  const { value: customFlexJson, error: customFlexJsonError } =
    parseCustomFlexJson(draft.messages.keywordCard.customFlexJson)

  const submittable: QuizConfig = { ...config, templateCopy: toSubmittableTemplateCopy(draft, customFlexJson) }
  const validation = QuizConfig.safeParse(submittable)

  const isDuo = config.mode === 'duo'
  const isGroup = config.group?.enabled === true
  const accent = draft.brand.primaryColor

  function updateSection<K extends keyof DraftTemplateCopy>(key: K, value: DraftTemplateCopy[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }
  function updateMessage<K extends keyof DraftTemplateCopy['messages']>(key: K, value: DraftTemplateCopy['messages'][K]) {
    setDraft((d) => ({ ...d, messages: { ...d.messages, [key]: value } }))
  }

  function addMilestone() {
    setDraft((d) => ({ ...d, rewards: { milestones: [...d.rewards.milestones, { key: '', label: '', triggerCount: 1 }] } }))
  }
  function removeMilestone(index: number) {
    setDraft((d) => ({ ...d, rewards: { milestones: d.rewards.milestones.filter((_, i) => i !== index) } }))
  }
  function updateMilestone(index: number, patch: Partial<Milestone>) {
    setDraft((d) => ({
      ...d,
      rewards: { milestones: d.rewards.milestones.map((m, i) => (i === index ? { ...m, ...patch } : m)) },
    }))
  }

  function toggle(id: string) {
    setOpenSection((cur) => (cur === id ? '' : id))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    // Finding 6 — customFlexJson ที่ JSON.parse ไม่ผ่าน (หรือ parse ผ่านแต่ไม่ใช่ object) ต้อง
    // ปฏิเสธการบันทึกทันทีด้วยข้อความชัดเจน ไม่ใช่เงียบๆ เก็บ string ดิบที่ผิดไว้แล้วไปพังตอน
    // render/ส่งจริงทีหลัง (renderKeywordCustom)
    if (customFlexJsonError) {
      setError(customFlexJsonError)
      return
    }
    setBusy(true)
    const formData = new FormData()
    formData.set('config', JSON.stringify(submittable))
    try {
      const result = await saveTemplateCopyAction(campaignId, activityId, formData)
      if (result.ok) {
        setSavedTick((n) => n + 1)
        router.refresh()
        setBusy(false)
      } else {
        setError(result.message)
        setBusy(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ — ลองใหม่')
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <form onSubmit={(event) => void handleSubmit(event)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <fieldset disabled={!canEdit || busy} style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>

          <Section
            n={1} title="แบรนด์" pill={PILL.settings} isOpen={openSection === 'brand'} onToggle={() => toggle('brand')}
            trigger={<span>ไม่ใช่ข้อความที่ส่งออกไป — ชื่อแบรนด์และสีหลักใช้เป็นสีเน้นในทุกการ์ด/พรีวิวของจอนี้</span>}
            preview={
              <div style={{ border: '1px solid var(--rule)', borderRadius: 'var(--r-lg)', padding: 14, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', textAlign: 'center' }}>
                <span style={{ width: 32, height: 32, borderRadius: '50%', background: accent || 'var(--ink)', display: 'block' }} />
                <span style={{ fontSize: 13, fontWeight: 700 }}>{draft.brand.name.trim() || '(ยังไม่ได้ตั้งชื่อแบรนด์)'}</span>
              </div>
            }
          >
            <Field id="tc-brand-name" label="ชื่อแบรนด์">
              <Text dataField="templateCopy.brand.name" value={draft.brand.name} onChange={(v) => updateSection('brand', { ...draft.brand, name: v })} />
            </Field>
            <Field id="tc-brand-color" label="สีหลัก (hex, ไม่บังคับ)">
              <Text dataField="templateCopy.brand.primaryColor" value={draft.brand.primaryColor} onChange={(v) => updateSection('brand', { ...draft.brand, primaryColor: v })} />
            </Field>
          </Section>

          <Section
            n={2} title="จอ Intro" pill={PILL.reply} isOpen={openSection === 'intro'} onToggle={() => toggle('intro')}
            trigger={<span>ใช้สองที่พร้อมกัน: (1) ข้อความต้อนรับที่ส่งฟรีทันทีตอนมีคนกด "เพิ่มเพื่อน" กับ OA (follow event) และ (2) หัวข้อ/เนื้อหาของหน้าจอแรกที่เห็นตอนเปิด LIFF</span>}
            preview={<MessagePreview accentColor={accent} kind="flex" title={draft.intro.title} body={draft.intro.body} ctaLabel={draft.intro.ctaLabel} />}
          >
            <Field id="tc-intro-title" label="หัวข้อ">
              <Text dataField="templateCopy.intro.title" value={draft.intro.title} onChange={(v) => updateSection('intro', { ...draft.intro, title: v })} />
            </Field>
            <Field id="tc-intro-body" label="เนื้อหา">
              <Text multiline dataField="templateCopy.intro.body" value={draft.intro.body} onChange={(v) => updateSection('intro', { ...draft.intro, body: v })} />
            </Field>
            <Field id="tc-intro-cta" label="ข้อความปุ่ม">
              <Text dataField="templateCopy.intro.ctaLabel" value={draft.intro.ctaLabel} onChange={(v) => updateSection('intro', { ...draft.intro, ctaLabel: v })} />
            </Field>
          </Section>

          <Section
            n={3} title="จอ FriendGate (แอดเพื่อนก่อนเล่น)" pill={PILL.screen} isOpen={openSection === 'friendGate'} onToggle={() => toggle('friendGate')}
            trigger={<span>แสดงในแอป LIFF เองตอนเปิดเข้ามาแล้วยังไม่ได้แอดเพื่อน OA นี้ — ไม่ใช่ข้อความ LINE ไม่กินโควตา ไม่มีใครได้รับอะไร</span>}
            preview={<ScreenPreview accentColor={accent} title={draft.friendGate.title} body={draft.friendGate.body} ctaLabel={draft.friendGate.ctaLabel} />}
          >
            <Field id="tc-fg-title" label="หัวข้อ">
              <Text dataField="templateCopy.friendGate.title" value={draft.friendGate.title} onChange={(v) => updateSection('friendGate', { ...draft.friendGate, title: v })} />
            </Field>
            <Field id="tc-fg-body" label="เนื้อหา">
              <Text multiline dataField="templateCopy.friendGate.body" value={draft.friendGate.body} onChange={(v) => updateSection('friendGate', { ...draft.friendGate, body: v })} />
            </Field>
            <Field id="tc-fg-cta" label="ข้อความปุ่ม">
              <Text dataField="templateCopy.friendGate.ctaLabel" value={draft.friendGate.ctaLabel} onChange={(v) => updateSection('friendGate', { ...draft.friendGate, ctaLabel: v })} />
            </Field>
          </Section>

          <Section
            n={4} title="จอ Open-in-LINE" pill={PILL.screen} isOpen={openSection === 'openInLine'} onToggle={() => toggle('openInLine')}
            trigger={<span>แสดงเมื่อมีคนเปิดลิงก์นี้จากนอกแอป LINE (เช่นเบราว์เซอร์ธรรมดา) — บอกให้เปิดใน LINE แทน ไม่ใช่ข้อความ LINE</span>}
            preview={<ScreenPreview accentColor={accent} title={draft.openInLine.title} body={draft.openInLine.body} />}
          >
            <Field id="tc-oil-title" label="หัวข้อ">
              <Text dataField="templateCopy.openInLine.title" value={draft.openInLine.title} onChange={(v) => updateSection('openInLine', { ...draft.openInLine, title: v })} />
            </Field>
            <Field id="tc-oil-body" label="เนื้อหา">
              <Text multiline dataField="templateCopy.openInLine.body" value={draft.openInLine.body} onChange={(v) => updateSection('openInLine', { ...draft.openInLine, body: v })} />
            </Field>
          </Section>

          <Section
            n={5} title="การ์ดผลลัพธ์" pill={PILL.reply} isOpen={openSection === 'resultCard'} onToggle={() => toggle('resultCard')}
            trigger={<span>ส่งเข้าแชท OA แบบฟรีทันทีที่ตอบครบ — LIFF ส่งข้อความมาร์กเกอร์แทนผู้เล่นเอง แล้ว webhook จับได้ค่อยตอบกลับการ์ดนี้ (ค้างอยู่ในแชทถาวร)</span>}
            preview={<MessagePreview accentColor={accent} kind="flex" badge={draft.messages.resultCard.eyebrow} title="(ชื่อผลลัพธ์ของผู้เล่น)" body="" ctaLabel={draft.messages.resultCard.ctaLabel} />}
          >
            <Field id="tc-rc-eyebrow" label="Eyebrow ของการ์ดผลลัพธ์">
              <Text dataField="templateCopy.messages.resultCard.eyebrow" value={draft.messages.resultCard.eyebrow} onChange={(v) => updateMessage('resultCard', { ...draft.messages.resultCard, eyebrow: v })} />
            </Field>
            <Field id="tc-rc-cta" label="ข้อความปุ่มของการ์ดผลลัพธ์">
              <Text dataField="templateCopy.messages.resultCard.ctaLabel" value={draft.messages.resultCard.ctaLabel} onChange={(v) => updateMessage('resultCard', { ...draft.messages.resultCard, ctaLabel: v })} />
            </Field>
          </Section>

          <Section
            n={6} title="การ์ดคีย์เวิร์ด" pill={PILL.reply} isOpen={openSection === 'keywordCard'} onToggle={() => toggle('keywordCard')}
            trigger={<span>ตอบกลับแบบฟรีทันทีที่มีคนพิมพ์คำที่ตั้งไว้เข้าแชท OA — ทางเข้าหลักจากโปสเตอร์/QR/ปากต่อปาก</span>}
            preview={<MessagePreview accentColor={accent} kind="flex" title={draft.messages.keywordCard.title} body={draft.messages.keywordCard.body} ctaLabel={draft.messages.keywordCard.ctaLabel} />}
          >
            <Field id="tc-kw-title" label="หัวข้อการ์ดคีย์เวิร์ด">
              <Text dataField="templateCopy.messages.keywordCard.title" value={draft.messages.keywordCard.title} onChange={(v) => updateMessage('keywordCard', { ...draft.messages.keywordCard, title: v })} />
            </Field>
            <Field id="tc-kw-body" label="เนื้อหาการ์ดคีย์เวิร์ด">
              <Text multiline dataField="templateCopy.messages.keywordCard.body" value={draft.messages.keywordCard.body} onChange={(v) => updateMessage('keywordCard', { ...draft.messages.keywordCard, body: v })} />
            </Field>
            <Field id="tc-kw-cta" label="ข้อความปุ่มการ์ดคีย์เวิร์ด">
              <Text dataField="templateCopy.messages.keywordCard.ctaLabel" value={draft.messages.keywordCard.ctaLabel} onChange={(v) => updateMessage('keywordCard', { ...draft.messages.keywordCard, ctaLabel: v })} />
            </Field>
            <Field
              id="tc-kw-custom"
              label="Flex JSON กำหนดเอง (ไม่บังคับ — เว้นว่าง = ใช้การ์ดทั่วไปด้านบน)"
              error={customFlexJsonError}
            >
              <Text multiline dataField="templateCopy.messages.keywordCard.customFlexJson" value={draft.messages.keywordCard.customFlexJson} onChange={(v) => updateMessage('keywordCard', { ...draft.messages.keywordCard, customFlexJson: v })} />
            </Field>
          </Section>

          {!isDuo && (
            <Section
              n={7} title="Solo — แชร์ผลของฉัน" pill={PILL.share} isOpen={openSection === 'soloShare'} onToggle={() => toggle('soloShare')}
              trigger={<span>ส่งตอนผู้เล่นกด "แชร์ผลลัพธ์" — ผ่าน shareTargetPicker ของ LIFF (ส่งในนามผู้เล่นเอง ฟรีไม่จำกัด) ไปโผล่ในแชทของเพื่อนที่เลือก</span>}
              preview={<MessagePreview accentColor={accent} kind="flex" badge={draft.messages.soloShare.badge} title="(ชื่อผลลัพธ์ของผู้เล่น)" body="" ctaLabel={draft.messages.soloShare.ctaLabel} secondaryCtaLabel={draft.messages.soloShare.secondaryCtaLabel} />}
            >
              <Field id="tc-ss-badge" label="ป้าย (badge)">
                <Text dataField="templateCopy.messages.soloShare.badge" value={draft.messages.soloShare.badge} onChange={(v) => updateMessage('soloShare', { ...draft.messages.soloShare, badge: v })} />
              </Field>
              <Field id="tc-ss-cta" label="ปุ่มหลัก">
                <Text dataField="templateCopy.messages.soloShare.ctaLabel" value={draft.messages.soloShare.ctaLabel} onChange={(v) => updateMessage('soloShare', { ...draft.messages.soloShare, ctaLabel: v })} />
              </Field>
              <Field id="tc-ss-cta2" label="ปุ่มรอง">
                <Text dataField="templateCopy.messages.soloShare.secondaryCtaLabel" value={draft.messages.soloShare.secondaryCtaLabel} onChange={(v) => updateMessage('soloShare', { ...draft.messages.soloShare, secondaryCtaLabel: v })} />
              </Field>
            </Section>
          )}

          {isDuo && (
            <Section
              n={7} title="Duo — ชวนบัดดี้" pill={PILL.share} isOpen={openSection === 'duoInvite'} onToggle={() => toggle('duoInvite')}
              trigger={<span>ส่งตอนผู้เล่นกด "ชวนเพื่อนตอบคู่กัน" — ผ่าน shareTargetPicker ของ LIFF (ฟรี ส่งในนามผู้เล่นเอง) ใช้ {'{axisName}'} แทนชื่อแกนเด่นของตัวเองได้</span>}
              preview={<MessagePreview accentColor={accent} kind="flex" title={previewInterpolate(draft.messages.duoInvite.titleTemplate, { axisName: 'E/I' })} body={previewInterpolate(draft.messages.duoInvite.bodyTemplate, { axisName: 'E/I' })} ctaLabel={draft.messages.duoInvite.ctaLabel} />}
            >
              <Field id="tc-invite-title" label="หัวข้อแชร์ (ในรายการแชท)">
                <Text dataField="templateCopy.invite.shareTitle" value={draft.invite.shareTitle} onChange={(v) => updateSection('invite', { ...draft.invite, shareTitle: v })} />
              </Field>
              <Field id="tc-invite-body" label="เนื้อหาแชร์ (ใช้ {axisName} แทนชื่อแกนของตัวเองได้)">
                <Text multiline dataField="templateCopy.invite.shareBodyTemplate" value={draft.invite.shareBodyTemplate} onChange={(v) => updateSection('invite', { ...draft.invite, shareBodyTemplate: v })} />
              </Field>
              <Field id="tc-di-title" label="หัวข้อการ์ด (ใช้ {axisName} ได้)">
                <Text dataField="templateCopy.messages.duoInvite.titleTemplate" value={draft.messages.duoInvite.titleTemplate} onChange={(v) => updateMessage('duoInvite', { ...draft.messages.duoInvite, titleTemplate: v })} />
              </Field>
              <Field id="tc-di-body" label="เนื้อหาการ์ด">
                <Text multiline dataField="templateCopy.messages.duoInvite.bodyTemplate" value={draft.messages.duoInvite.bodyTemplate} onChange={(v) => updateMessage('duoInvite', { ...draft.messages.duoInvite, bodyTemplate: v })} />
              </Field>
              <Field id="tc-di-cta" label="ข้อความปุ่ม">
                <Text dataField="templateCopy.messages.duoInvite.ctaLabel" value={draft.messages.duoInvite.ctaLabel} onChange={(v) => updateMessage('duoInvite', { ...draft.messages.duoInvite, ctaLabel: v })} />
              </Field>
            </Section>
          )}

          {isDuo && (
            <Section
              n={8} title="Duo — แจ้งเตือนคู่ตอบแล้ว" pill={PILL.push} isOpen={openSection === 'duoPartnerAnswered'} onToggle={() => toggle('duoPartnerAnswered')}
              trigger={<span>คู่ของคุณตอบครบและจับคู่สำเร็จ → ระบบ push แจ้งเตือนทันที (กินโควตา เพราะคนละฝ่ายอาจปิดแอปไปแล้ว)</span>}
              preview={<MessagePreview accentColor={accent} kind="flex" badge={draft.messages.duoPartnerAnswered.badge} title="(ชื่อคู่ + แกนของคู่)" body="" ctaLabel={draft.messages.duoPartnerAnswered.ctaLabel} />}
            >
              <Field id="tc-dpa-badge" label="ป้าย (badge)">
                <Text dataField="templateCopy.messages.duoPartnerAnswered.badge" value={draft.messages.duoPartnerAnswered.badge} onChange={(v) => updateMessage('duoPartnerAnswered', { ...draft.messages.duoPartnerAnswered, badge: v })} />
              </Field>
              <Field id="tc-dpa-cta" label="ข้อความปุ่ม">
                <Text dataField="templateCopy.messages.duoPartnerAnswered.ctaLabel" value={draft.messages.duoPartnerAnswered.ctaLabel} onChange={(v) => updateMessage('duoPartnerAnswered', { ...draft.messages.duoPartnerAnswered, ctaLabel: v })} />
              </Field>
            </Section>
          )}

          {isDuo && (
            <Section
              n={9} title="Duo — ผลคู่เต็ม" pill={PILL.reply} isOpen={openSection === 'duoPairResult'} onToggle={() => toggle('duoPairResult')}
              trigger={<span>ส่งฟรีเข้าแชท OA ตอนทั้งคู่ได้ผลลัพธ์ครบแล้ว (เหมือนการ์ดผลลัพธ์เดี่ยว แต่เป็นผลของคู่) ใช้ {'{rank}'} แทนอันดับของคู่นี้ได้</span>}
              preview={<MessagePreview accentColor={accent} kind="flex" badge={draft.messages.duoPairResult.badge} title="(ชื่อผลลัพธ์คู่)" body={previewInterpolate(draft.messages.duoPairResult.rankLineTemplate, { rank: '1' })} ctaLabel={draft.messages.duoPairResult.ctaLabel} />}
            >
              <Field id="tc-dpr-badge" label="ป้าย (badge)">
                <Text dataField="templateCopy.messages.duoPairResult.badge" value={draft.messages.duoPairResult.badge} onChange={(v) => updateMessage('duoPairResult', { ...draft.messages.duoPairResult, badge: v })} />
              </Field>
              <Field id="tc-dpr-rank" label="ข้อความอันดับ (ใช้ {rank} ได้)">
                <Text dataField="templateCopy.messages.duoPairResult.rankLineTemplate" value={draft.messages.duoPairResult.rankLineTemplate} onChange={(v) => updateMessage('duoPairResult', { ...draft.messages.duoPairResult, rankLineTemplate: v })} />
              </Field>
              <Field id="tc-dpr-cta" label="ข้อความปุ่ม">
                <Text dataField="templateCopy.messages.duoPairResult.ctaLabel" value={draft.messages.duoPairResult.ctaLabel} onChange={(v) => updateMessage('duoPairResult', { ...draft.messages.duoPairResult, ctaLabel: v })} />
              </Field>
            </Section>
          )}

          {isDuo && (
            <Section
              n={10} title="Duo — เตือนยังไม่จับคู่" pill={PILL.push} isOpen={openSection === 'duoReminder'} onToggle={() => toggle('duoReminder')}
              trigger={<span>ตั้งเวลาไว้แล้วยังไม่มีคู่มาจับ → ระบบ push เตือนตามรอบเวลา (กินโควตา) ใช้ {'{hours}'} แทนจำนวนชั่วโมงที่ผ่านไปได้</span>}
              preview={<MessagePreview accentColor={accent} kind="flex" badge={draft.messages.duoReminder.badge} title={previewInterpolate(draft.messages.duoReminder.headlineTemplate, { hours: '24' })} body="" ctaLabel={draft.messages.duoReminder.ctaLabel} />}
            >
              <Field id="tc-dr-badge" label="ป้าย (badge)">
                <Text dataField="templateCopy.messages.duoReminder.badge" value={draft.messages.duoReminder.badge} onChange={(v) => updateMessage('duoReminder', { ...draft.messages.duoReminder, badge: v })} />
              </Field>
              <Field id="tc-dr-headline" label="หัวข้อ (ใช้ {hours} ได้)">
                <Text dataField="templateCopy.messages.duoReminder.headlineTemplate" value={draft.messages.duoReminder.headlineTemplate} onChange={(v) => updateMessage('duoReminder', { ...draft.messages.duoReminder, headlineTemplate: v })} />
              </Field>
              <Field id="tc-dr-cta" label="ข้อความปุ่ม">
                <Text dataField="templateCopy.messages.duoReminder.ctaLabel" value={draft.messages.duoReminder.ctaLabel} onChange={(v) => updateMessage('duoReminder', { ...draft.messages.duoReminder, ctaLabel: v })} />
              </Field>
            </Section>
          )}

          {isGroup && (
            <Section
              n={11} title="Group — กลุ่มครบแล้ว" pill={PILL.push} isOpen={openSection === 'groupComplete'} onToggle={() => toggle('groupComplete')}
              trigger={<span>กลุ่มมีสมาชิกครบตามที่ตั้งขั้นต่ำไว้และคำนวณผลลัพธ์ได้แล้ว → push แจ้งทุกคนในกลุ่ม (กินโควตา)</span>}
              preview={<MessagePreview accentColor={accent} kind="flex" badge={draft.messages.groupComplete.badge} title="(ชื่อ archetype ของกลุ่ม)" body="" ctaLabel={draft.messages.groupComplete.ctaLabel} />}
            >
              <Field id="tc-gc-badge" label="ป้าย (badge)">
                <Text dataField="templateCopy.messages.groupComplete.badge" value={draft.messages.groupComplete.badge} onChange={(v) => updateMessage('groupComplete', { ...draft.messages.groupComplete, badge: v })} />
              </Field>
              <Field id="tc-gc-cta" label="ข้อความปุ่ม">
                <Text dataField="templateCopy.messages.groupComplete.ctaLabel" value={draft.messages.groupComplete.ctaLabel} onChange={(v) => updateMessage('groupComplete', { ...draft.messages.groupComplete, ctaLabel: v })} />
              </Field>
            </Section>
          )}

          {isGroup && (
            <Section
              n={12} title="Group — ปลดล็อกสัญลักษณ์ใหม่" pill={PILL.push} isOpen={openSection === 'groupUnlock'} onToggle={() => toggle('groupUnlock')}
              trigger={<span>มีสมาชิกเข้ากลุ่มเพิ่มจนผลลัพธ์เปลี่ยนไปเป็น archetype ระดับใหม่ → push แจ้งทุกคน ใช้ {'{archetype}'} แทนชื่อ archetype ใหม่ได้</span>}
              preview={<MessagePreview accentColor={accent} kind="flex" title={previewInterpolate(draft.messages.groupUnlock.headlineTemplate, { archetype: 'ตัวอย่างกลุ่ม' })} body="" ctaLabel={draft.messages.groupUnlock.ctaLabel} />}
            >
              <Field id="tc-gu-headline" label="หัวข้อ (ใช้ {archetype} ได้)">
                <Text dataField="templateCopy.messages.groupUnlock.headlineTemplate" value={draft.messages.groupUnlock.headlineTemplate} onChange={(v) => updateMessage('groupUnlock', { ...draft.messages.groupUnlock, headlineTemplate: v })} />
              </Field>
              <Field id="tc-gu-cta" label="ข้อความปุ่ม">
                <Text dataField="templateCopy.messages.groupUnlock.ctaLabel" value={draft.messages.groupUnlock.ctaLabel} onChange={(v) => updateMessage('groupUnlock', { ...draft.messages.groupUnlock, ctaLabel: v })} />
              </Field>
            </Section>
          )}

          {isGroup && (
            <Section
              n={13} title="Group — เตือนยังไม่ครบ" pill={PILL.push} isOpen={openSection === 'groupReminder'} onToggle={() => toggle('groupReminder')}
              trigger={<span>ตั้งเวลาไว้แล้วกลุ่มยังไม่ถึงจำนวนขั้นต่ำ → push เตือนตามรอบเวลา (กินโควตา) ใช้ {'{current}'}/{'{remaining}'} แทนจำนวนปัจจุบัน/ที่ขาดได้</span>}
              preview={<MessagePreview accentColor={accent} kind="flex" badge={draft.messages.groupReminder.badge} title={previewInterpolate(draft.messages.groupReminder.headlineTemplate, { current: '3', remaining: '2' })} body={draft.messages.groupReminder.subText} ctaLabel={draft.messages.groupReminder.ctaLabel} />}
            >
              <Field id="tc-gr-badge" label="ป้าย (badge)">
                <Text dataField="templateCopy.messages.groupReminder.badge" value={draft.messages.groupReminder.badge} onChange={(v) => updateMessage('groupReminder', { ...draft.messages.groupReminder, badge: v })} />
              </Field>
              <Field id="tc-gr-headline" label="หัวข้อ (ใช้ {current}/{remaining} ได้)">
                <Text dataField="templateCopy.messages.groupReminder.headlineTemplate" value={draft.messages.groupReminder.headlineTemplate} onChange={(v) => updateMessage('groupReminder', { ...draft.messages.groupReminder, headlineTemplate: v })} />
              </Field>
              <Field id="tc-gr-sub" label="ข้อความรอง">
                <Text dataField="templateCopy.messages.groupReminder.subText" value={draft.messages.groupReminder.subText} onChange={(v) => updateMessage('groupReminder', { ...draft.messages.groupReminder, subText: v })} />
              </Field>
              <Field id="tc-gr-cta" label="ข้อความปุ่ม">
                <Text dataField="templateCopy.messages.groupReminder.ctaLabel" value={draft.messages.groupReminder.ctaLabel} onChange={(v) => updateMessage('groupReminder', { ...draft.messages.groupReminder, ctaLabel: v })} />
              </Field>
            </Section>
          )}

          {isGroup && (
            <Section
              n={14} title="Group — ชวนคนเข้ากลุ่ม" pill={PILL.share} isOpen={openSection === 'groupInvite'} onToggle={() => toggle('groupInvite')}
              trigger={<span>ส่งตอนสมาชิกกลุ่มกด "ชวนเพื่อนเข้ากลุ่ม" — ผ่าน shareTargetPicker ของ LIFF (ฟรี) หัวข้อเปลี่ยนไปตามว่ากลุ่มครบหรือยัง</span>}
              preview={<MessagePreview accentColor={accent} kind="flex" title={previewInterpolate(draft.messages.groupInvite.headerIncompleteTemplate, { current: '3', max: '6' })} body={draft.messages.groupInvite.body} ctaLabel={draft.messages.groupInvite.ctaLabel} secondaryCtaLabel={draft.messages.groupInvite.secondaryCtaLabel} />}
            >
              <Field id="tc-gi-header-complete" label="หัวข้อ (ครบแล้ว — ใช้ {archetype} ได้)">
                <Text dataField="templateCopy.messages.groupInvite.headerCompleteTemplate" value={draft.messages.groupInvite.headerCompleteTemplate} onChange={(v) => updateMessage('groupInvite', { ...draft.messages.groupInvite, headerCompleteTemplate: v })} />
              </Field>
              <Field id="tc-gi-header-incomplete" label="หัวข้อ (ยังไม่ครบ — ใช้ {current}/{max} ได้)">
                <Text dataField="templateCopy.messages.groupInvite.headerIncompleteTemplate" value={draft.messages.groupInvite.headerIncompleteTemplate} onChange={(v) => updateMessage('groupInvite', { ...draft.messages.groupInvite, headerIncompleteTemplate: v })} />
              </Field>
              <Field id="tc-gi-body" label="เนื้อหา">
                <Text multiline dataField="templateCopy.messages.groupInvite.body" value={draft.messages.groupInvite.body} onChange={(v) => updateMessage('groupInvite', { ...draft.messages.groupInvite, body: v })} />
              </Field>
              <Field id="tc-gi-cta" label="ปุ่มหลัก">
                <Text dataField="templateCopy.messages.groupInvite.ctaLabel" value={draft.messages.groupInvite.ctaLabel} onChange={(v) => updateMessage('groupInvite', { ...draft.messages.groupInvite, ctaLabel: v })} />
              </Field>
              <Field id="tc-gi-cta2" label="ปุ่มรอง">
                <Text dataField="templateCopy.messages.groupInvite.secondaryCtaLabel" value={draft.messages.groupInvite.secondaryCtaLabel} onChange={(v) => updateMessage('groupInvite', { ...draft.messages.groupInvite, secondaryCtaLabel: v })} />
              </Field>
            </Section>
          )}

          <Section
            n={15} title="ด่านรางวัล (Rewards)" pill={PILL.settings} isOpen={openSection === 'rewards'} onToggle={() => toggle('rewards')}
            trigger={<span>ไม่ใช่ข้อความที่ส่งออกไปตรงๆ — เป็นด่านสะสม (milestone) ที่ผู้เล่นปลดล็อกได้ตามจำนวนครั้งที่ตั้งไว้</span>}
            preview={
              draft.rewards.milestones.length === 0 ? (
                <div style={{ border: '1px dashed var(--rule)', borderRadius: 'var(--r-lg)', padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--ink-3)' }}>
                  ยังไม่มีด่านรางวัล
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {draft.rewards.milestones.map((m, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--rule)', borderRadius: 'var(--r)', padding: '7px 10px', fontSize: 12 }}>
                      <span aria-hidden="true">{m.icon || '🏅'}</span>
                      <span style={{ fontWeight: 600 }}>{m.label.trim() || '(ยังไม่ได้ตั้งชื่อ)'}</span>
                      <span style={{ marginLeft: 'auto', color: 'var(--ink-3)', fontFamily: 'var(--mono)', fontSize: 10 }}>×{normalizeTriggerCount(m.triggerCount)}</span>
                    </div>
                  ))}
                </div>
              )
            }
          >
            <div data-field="templateCopy.rewards.milestones" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {draft.rewards.milestones.map((m, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input aria-label={`milestone-${i}-key`} placeholder="key" value={m.key} onChange={(e) => updateMilestone(i, { key: e.target.value })} />
                  <input aria-label={`milestone-${i}-label`} placeholder="label" value={m.label} onChange={(e) => updateMilestone(i, { label: e.target.value })} />
                  <input aria-label={`milestone-${i}-icon`} placeholder="icon" value={m.icon ?? ''} onChange={(e) => updateMilestone(i, { icon: e.target.value || undefined })} />
                  <input
                    aria-label={`milestone-${i}-triggerCount`} type="number" placeholder="triggerCount" value={m.triggerCount}
                    // ไม่ coerce/default ทุก keystroke (Finding 8) — ปล่อยให้ค่ากลางทาง (รวมค่าว่าง
                    // ระหว่างลบเลขเก่าเพื่อพิมพ์ใหม่) ค้างอยู่ในช่องได้ก่อน ค่อย normalize จริง
                    // ตอน blur (ด้านล่าง) หรือก่อนบันทึกจริง (toSubmittableTemplateCopy)
                    onChange={(e) => updateMilestone(i, { triggerCount: e.target.value })}
                    onBlur={() => updateMilestone(i, { triggerCount: normalizeTriggerCount(m.triggerCount) })}
                  />
                  <Button type="button" variant="ghost" onClick={() => removeMilestone(i)}>ลบ</Button>
                </div>
              ))}
              <Button type="button" onClick={addMilestone}>+ เพิ่มด่านรางวัล</Button>
            </div>
          </Section>

          {validation.success && !customFlexJsonError ? (
            <Note tone="ok">กรอกครบและถูกต้องตาม schema แล้ว — บันทึกได้</Note>
          ) : (
            <Note tone="warn">
              <div style={{ fontWeight: 600, marginBottom: 6 }}>ยังบันทึกไม่ได้ — มีข้อผิดพลาดดังนี้</div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {!validation.success && validation.error.issues.map((issue, i) => (
                  <li key={i}>{issue.path.join('.') || '(ทั้งก้อน)'}: {issue.message}</li>
                ))}
              </ul>
            </Note>
          )}

          {canEdit && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
              {savedTick > 0 && !busy && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>บันทึกล่าสุดแล้ว</span>}
              <Button type="submit" disabled={!validation.success || Boolean(customFlexJsonError)}>บันทึกเทมเพลต</Button>
            </div>
          )}
          {busy && <p aria-live="polite">กำลังบันทึก…</p>}
        </fieldset>
      </form>

      <ErrorModal message={error} onClose={() => setError(null)} />
    </div>
  )
}
