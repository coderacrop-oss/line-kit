'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button, ErrorModal, Field, Note, Panel } from '@/components/ui'
import { QuizConfig } from '@/lib/quiz/schema'
import { saveTemplateCopyAction } from '../actions'

export type TemplateCopyFormProps = {
  campaignId: string
  activityId: string
  initial: QuizConfig
  canEdit: boolean
}

type Milestone = { key: string; label: string; icon?: string; triggerCount: number }

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

function toSubmittableTemplateCopy(d: DraftTemplateCopy): NonNullable<QuizConfig['templateCopy']> {
  let customFlexJson: unknown
  if (d.messages.keywordCard.customFlexJson.trim() !== '') {
    try { customFlexJson = JSON.parse(d.messages.keywordCard.customFlexJson) } catch { customFlexJson = d.messages.keywordCard.customFlexJson }
  }
  return {
    brand: { name: d.brand.name, ...(d.brand.primaryColor.trim() !== '' ? { primaryColor: d.brand.primaryColor } : {}) },
    intro: d.intro,
    friendGate: d.friendGate,
    openInLine: d.openInLine,
    ...(includeIfFilled(d.invite) ? { invite: d.invite } : {}),
    rewards: d.rewards,
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

export function TemplateCopyForm({ campaignId, activityId, initial, canEdit }: TemplateCopyFormProps) {
  const router = useRouter()
  const [config] = useState(initial)
  const [draft, setDraft] = useState<DraftTemplateCopy>(() => draftFromConfig(initial))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [savedTick, setSavedTick] = useState(0)

  const submittable: QuizConfig = { ...config, templateCopy: toSubmittableTemplateCopy(draft) }
  const validation = QuizConfig.safeParse(submittable)

  const isDuo = config.mode === 'duo'
  const isGroup = config.group?.enabled === true

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
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
        <fieldset disabled={!canEdit || busy} style={{ border: 0, margin: 0, padding: 0, display: 'contents' }}>
          <Panel style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <strong>แบรนด์</strong>
            <Field id="tc-brand-name" label="ชื่อแบรนด์">
              <Text dataField="templateCopy.brand.name" value={draft.brand.name} onChange={(v) => updateSection('brand', { ...draft.brand, name: v })} />
            </Field>
            <Field id="tc-brand-color" label="สีหลัก (hex, ไม่บังคับ)">
              <Text dataField="templateCopy.brand.primaryColor" value={draft.brand.primaryColor} onChange={(v) => updateSection('brand', { ...draft.brand, primaryColor: v })} />
            </Field>
          </Panel>

          <Panel style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <strong>จอ Intro</strong>
            <Field id="tc-intro-title" label="หัวข้อ">
              <Text dataField="templateCopy.intro.title" value={draft.intro.title} onChange={(v) => updateSection('intro', { ...draft.intro, title: v })} />
            </Field>
            <Field id="tc-intro-body" label="เนื้อหา">
              <Text multiline dataField="templateCopy.intro.body" value={draft.intro.body} onChange={(v) => updateSection('intro', { ...draft.intro, body: v })} />
            </Field>
            <Field id="tc-intro-cta" label="ข้อความปุ่ม">
              <Text dataField="templateCopy.intro.ctaLabel" value={draft.intro.ctaLabel} onChange={(v) => updateSection('intro', { ...draft.intro, ctaLabel: v })} />
            </Field>
          </Panel>

          <Panel style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <strong>จอ FriendGate (แอดเพื่อนก่อนเล่น)</strong>
            <Field id="tc-fg-title" label="หัวข้อ">
              <Text dataField="templateCopy.friendGate.title" value={draft.friendGate.title} onChange={(v) => updateSection('friendGate', { ...draft.friendGate, title: v })} />
            </Field>
            <Field id="tc-fg-body" label="เนื้อหา">
              <Text multiline dataField="templateCopy.friendGate.body" value={draft.friendGate.body} onChange={(v) => updateSection('friendGate', { ...draft.friendGate, body: v })} />
            </Field>
            <Field id="tc-fg-cta" label="ข้อความปุ่ม">
              <Text dataField="templateCopy.friendGate.ctaLabel" value={draft.friendGate.ctaLabel} onChange={(v) => updateSection('friendGate', { ...draft.friendGate, ctaLabel: v })} />
            </Field>
          </Panel>

          <Panel style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <strong>จอ Open-in-LINE</strong>
            <Field id="tc-oil-title" label="หัวข้อ">
              <Text dataField="templateCopy.openInLine.title" value={draft.openInLine.title} onChange={(v) => updateSection('openInLine', { ...draft.openInLine, title: v })} />
            </Field>
            <Field id="tc-oil-body" label="เนื้อหา">
              <Text multiline dataField="templateCopy.openInLine.body" value={draft.openInLine.body} onChange={(v) => updateSection('openInLine', { ...draft.openInLine, body: v })} />
            </Field>
          </Panel>

          <Panel style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <strong>ผลลัพธ์ (การ์ดจบควิซ) + คีย์เวิร์ด</strong>
            <Field id="tc-rc-eyebrow" label="Eyebrow ของการ์ดผลลัพธ์">
              <Text dataField="templateCopy.messages.resultCard.eyebrow" value={draft.messages.resultCard.eyebrow} onChange={(v) => updateMessage('resultCard', { ...draft.messages.resultCard, eyebrow: v })} />
            </Field>
            <Field id="tc-rc-cta" label="ข้อความปุ่มของการ์ดผลลัพธ์">
              <Text dataField="templateCopy.messages.resultCard.ctaLabel" value={draft.messages.resultCard.ctaLabel} onChange={(v) => updateMessage('resultCard', { ...draft.messages.resultCard, ctaLabel: v })} />
            </Field>
            <Field id="tc-kw-title" label="หัวข้อการ์ดคีย์เวิร์ด">
              <Text dataField="templateCopy.messages.keywordCard.title" value={draft.messages.keywordCard.title} onChange={(v) => updateMessage('keywordCard', { ...draft.messages.keywordCard, title: v })} />
            </Field>
            <Field id="tc-kw-body" label="เนื้อหาการ์ดคีย์เวิร์ด">
              <Text multiline dataField="templateCopy.messages.keywordCard.body" value={draft.messages.keywordCard.body} onChange={(v) => updateMessage('keywordCard', { ...draft.messages.keywordCard, body: v })} />
            </Field>
            <Field id="tc-kw-cta" label="ข้อความปุ่มการ์ดคีย์เวิร์ด">
              <Text dataField="templateCopy.messages.keywordCard.ctaLabel" value={draft.messages.keywordCard.ctaLabel} onChange={(v) => updateMessage('keywordCard', { ...draft.messages.keywordCard, ctaLabel: v })} />
            </Field>
            <Field id="tc-kw-custom" label="Flex JSON กำหนดเอง (ไม่บังคับ — เว้นว่าง = ใช้การ์ดทั่วไปด้านบน)">
              <Text multiline dataField="templateCopy.messages.keywordCard.customFlexJson" value={draft.messages.keywordCard.customFlexJson} onChange={(v) => updateMessage('keywordCard', { ...draft.messages.keywordCard, customFlexJson: v })} />
            </Field>
          </Panel>

          {!isDuo && (
            <Panel style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <strong>Solo — แชร์ผลของฉัน</strong>
              <Field id="tc-ss-badge" label="ป้าย (badge)">
                <Text dataField="templateCopy.messages.soloShare.badge" value={draft.messages.soloShare.badge} onChange={(v) => updateMessage('soloShare', { ...draft.messages.soloShare, badge: v })} />
              </Field>
              <Field id="tc-ss-cta" label="ปุ่มหลัก">
                <Text dataField="templateCopy.messages.soloShare.ctaLabel" value={draft.messages.soloShare.ctaLabel} onChange={(v) => updateMessage('soloShare', { ...draft.messages.soloShare, ctaLabel: v })} />
              </Field>
              <Field id="tc-ss-cta2" label="ปุ่มรอง">
                <Text dataField="templateCopy.messages.soloShare.secondaryCtaLabel" value={draft.messages.soloShare.secondaryCtaLabel} onChange={(v) => updateMessage('soloShare', { ...draft.messages.soloShare, secondaryCtaLabel: v })} />
              </Field>
            </Panel>
          )}

          {isDuo && (
            <Panel style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <strong>Duo — ชวนบัดดี้</strong>
              <Field id="tc-invite-title" label="หัวข้อแชร์">
                <Text dataField="templateCopy.invite.shareTitle" value={draft.invite.shareTitle} onChange={(v) => updateSection('invite', { ...draft.invite, shareTitle: v })} />
              </Field>
              <Field id="tc-invite-body" label="เนื้อหาแชร์ (ใช้ {axisName} แทนชื่อแกนของตัวเองได้)">
                <Text multiline dataField="templateCopy.invite.shareBodyTemplate" value={draft.invite.shareBodyTemplate} onChange={(v) => updateSection('invite', { ...draft.invite, shareBodyTemplate: v })} />
              </Field>

              <strong>Duo — การ์ดชวนบัดดี้ (ข้อความ)</strong>
              <Field id="tc-di-title" label="หัวข้อ (ใช้ {axisName} ได้)">
                <Text dataField="templateCopy.messages.duoInvite.titleTemplate" value={draft.messages.duoInvite.titleTemplate} onChange={(v) => updateMessage('duoInvite', { ...draft.messages.duoInvite, titleTemplate: v })} />
              </Field>
              <Field id="tc-di-body" label="เนื้อหา">
                <Text multiline dataField="templateCopy.messages.duoInvite.bodyTemplate" value={draft.messages.duoInvite.bodyTemplate} onChange={(v) => updateMessage('duoInvite', { ...draft.messages.duoInvite, bodyTemplate: v })} />
              </Field>
              <Field id="tc-di-cta" label="ข้อความปุ่ม">
                <Text dataField="templateCopy.messages.duoInvite.ctaLabel" value={draft.messages.duoInvite.ctaLabel} onChange={(v) => updateMessage('duoInvite', { ...draft.messages.duoInvite, ctaLabel: v })} />
              </Field>

              <strong>Duo — แจ้งเตือนคู่ตอบแล้ว</strong>
              <Field id="tc-dpa-badge" label="ป้าย (badge)">
                <Text dataField="templateCopy.messages.duoPartnerAnswered.badge" value={draft.messages.duoPartnerAnswered.badge} onChange={(v) => updateMessage('duoPartnerAnswered', { ...draft.messages.duoPartnerAnswered, badge: v })} />
              </Field>
              <Field id="tc-dpa-cta" label="ข้อความปุ่ม">
                <Text dataField="templateCopy.messages.duoPartnerAnswered.ctaLabel" value={draft.messages.duoPartnerAnswered.ctaLabel} onChange={(v) => updateMessage('duoPartnerAnswered', { ...draft.messages.duoPartnerAnswered, ctaLabel: v })} />
              </Field>

              <strong>Duo — ผลคู่เต็ม</strong>
              <Field id="tc-dpr-badge" label="ป้าย (badge)">
                <Text dataField="templateCopy.messages.duoPairResult.badge" value={draft.messages.duoPairResult.badge} onChange={(v) => updateMessage('duoPairResult', { ...draft.messages.duoPairResult, badge: v })} />
              </Field>
              <Field id="tc-dpr-rank" label="ข้อความอันดับ (ใช้ {rank} ได้)">
                <Text dataField="templateCopy.messages.duoPairResult.rankLineTemplate" value={draft.messages.duoPairResult.rankLineTemplate} onChange={(v) => updateMessage('duoPairResult', { ...draft.messages.duoPairResult, rankLineTemplate: v })} />
              </Field>
              <Field id="tc-dpr-cta" label="ข้อความปุ่ม">
                <Text dataField="templateCopy.messages.duoPairResult.ctaLabel" value={draft.messages.duoPairResult.ctaLabel} onChange={(v) => updateMessage('duoPairResult', { ...draft.messages.duoPairResult, ctaLabel: v })} />
              </Field>

              <strong>Duo — เตือนยังไม่จับคู่</strong>
              <Field id="tc-dr-badge" label="ป้าย (badge)">
                <Text dataField="templateCopy.messages.duoReminder.badge" value={draft.messages.duoReminder.badge} onChange={(v) => updateMessage('duoReminder', { ...draft.messages.duoReminder, badge: v })} />
              </Field>
              <Field id="tc-dr-headline" label="หัวข้อ (ใช้ {hours} ได้)">
                <Text dataField="templateCopy.messages.duoReminder.headlineTemplate" value={draft.messages.duoReminder.headlineTemplate} onChange={(v) => updateMessage('duoReminder', { ...draft.messages.duoReminder, headlineTemplate: v })} />
              </Field>
              <Field id="tc-dr-cta" label="ข้อความปุ่ม">
                <Text dataField="templateCopy.messages.duoReminder.ctaLabel" value={draft.messages.duoReminder.ctaLabel} onChange={(v) => updateMessage('duoReminder', { ...draft.messages.duoReminder, ctaLabel: v })} />
              </Field>
            </Panel>
          )}

          {isGroup && (
            <Panel style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <strong>Group — กลุ่มครบแล้ว</strong>
              <Field id="tc-gc-badge" label="ป้าย (badge)">
                <Text dataField="templateCopy.messages.groupComplete.badge" value={draft.messages.groupComplete.badge} onChange={(v) => updateMessage('groupComplete', { ...draft.messages.groupComplete, badge: v })} />
              </Field>
              <Field id="tc-gc-cta" label="ข้อความปุ่ม">
                <Text dataField="templateCopy.messages.groupComplete.ctaLabel" value={draft.messages.groupComplete.ctaLabel} onChange={(v) => updateMessage('groupComplete', { ...draft.messages.groupComplete, ctaLabel: v })} />
              </Field>

              <strong>Group — ปลดล็อกสัญลักษณ์ใหม่</strong>
              <Field id="tc-gu-headline" label="หัวข้อ">
                <Text dataField="templateCopy.messages.groupUnlock.headlineTemplate" value={draft.messages.groupUnlock.headlineTemplate} onChange={(v) => updateMessage('groupUnlock', { ...draft.messages.groupUnlock, headlineTemplate: v })} />
              </Field>
              <Field id="tc-gu-cta" label="ข้อความปุ่ม">
                <Text dataField="templateCopy.messages.groupUnlock.ctaLabel" value={draft.messages.groupUnlock.ctaLabel} onChange={(v) => updateMessage('groupUnlock', { ...draft.messages.groupUnlock, ctaLabel: v })} />
              </Field>

              <strong>Group — เตือนยังไม่ครบ</strong>
              <Field id="tc-gr-badge" label="ป้าย (badge)">
                <Text dataField="templateCopy.messages.groupReminder.badge" value={draft.messages.groupReminder.badge} onChange={(v) => updateMessage('groupReminder', { ...draft.messages.groupReminder, badge: v })} />
              </Field>
              <Field id="tc-gr-headline" label="หัวข้อ (ใช้ {remaining} ได้)">
                <Text dataField="templateCopy.messages.groupReminder.headlineTemplate" value={draft.messages.groupReminder.headlineTemplate} onChange={(v) => updateMessage('groupReminder', { ...draft.messages.groupReminder, headlineTemplate: v })} />
              </Field>
              <Field id="tc-gr-sub" label="ข้อความรอง">
                <Text dataField="templateCopy.messages.groupReminder.subText" value={draft.messages.groupReminder.subText} onChange={(v) => updateMessage('groupReminder', { ...draft.messages.groupReminder, subText: v })} />
              </Field>
              <Field id="tc-gr-cta" label="ข้อความปุ่ม">
                <Text dataField="templateCopy.messages.groupReminder.ctaLabel" value={draft.messages.groupReminder.ctaLabel} onChange={(v) => updateMessage('groupReminder', { ...draft.messages.groupReminder, ctaLabel: v })} />
              </Field>

              <strong>Group — ชวนคนเข้ากลุ่ม</strong>
              <Field id="tc-gi-header-complete" label="หัวข้อ (ครบแล้ว)">
                <Text dataField="templateCopy.messages.groupInvite.headerCompleteTemplate" value={draft.messages.groupInvite.headerCompleteTemplate} onChange={(v) => updateMessage('groupInvite', { ...draft.messages.groupInvite, headerCompleteTemplate: v })} />
              </Field>
              <Field id="tc-gi-header-incomplete" label="หัวข้อ (ยังไม่ครบ)">
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
            </Panel>
          )}

          <Panel style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }} data-field="templateCopy.rewards.milestones">
            <strong>ด่านรางวัล (Rewards)</strong>
            {draft.rewards.milestones.map((m, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input aria-label={`milestone-${i}-key`} placeholder="key" value={m.key} onChange={(e) => updateMilestone(i, { key: e.target.value })} />
                <input aria-label={`milestone-${i}-label`} placeholder="label" value={m.label} onChange={(e) => updateMilestone(i, { label: e.target.value })} />
                <input aria-label={`milestone-${i}-icon`} placeholder="icon" value={m.icon ?? ''} onChange={(e) => updateMilestone(i, { icon: e.target.value || undefined })} />
                <input
                  aria-label={`milestone-${i}-triggerCount`} type="number" placeholder="triggerCount" value={m.triggerCount}
                  onChange={(e) => updateMilestone(i, { triggerCount: Number(e.target.value) || 1 })}
                />
                <Button type="button" variant="ghost" onClick={() => removeMilestone(i)}>ลบ</Button>
              </div>
            ))}
            <Button type="button" onClick={addMilestone}>+ เพิ่มด่านรางวัล</Button>
          </Panel>

          {validation.success ? (
            <Note tone="ok">กรอกครบและถูกต้องตาม schema แล้ว — บันทึกได้</Note>
          ) : (
            <Note tone="warn">
              <div style={{ fontWeight: 600, marginBottom: 6 }}>ยังบันทึกไม่ได้ — มีข้อผิดพลาดดังนี้</div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {validation.error.issues.map((issue, i) => (
                  <li key={i}>{issue.path.join('.') || '(ทั้งก้อน)'}: {issue.message}</li>
                ))}
              </ul>
            </Note>
          )}

          {canEdit && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
              {savedTick > 0 && !busy && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>บันทึกล่าสุดแล้ว</span>}
              <Button type="submit" disabled={!validation.success}>บันทึกเทมเพลต</Button>
            </div>
          )}
          {busy && <p aria-live="polite">กำลังบันทึก…</p>}
        </fieldset>
      </form>

      <ErrorModal message={error} onClose={() => setError(null)} />
    </div>
  )
}
