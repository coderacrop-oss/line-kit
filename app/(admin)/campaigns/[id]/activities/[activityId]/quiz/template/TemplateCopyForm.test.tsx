// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { TemplateCopyForm } from './TemplateCopyForm'
import { QuizConfig, TemplateCopy } from '@/lib/quiz/schema'

afterEach(cleanup)

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const saveQuizConfigAction = vi.fn(
  async (_campaignId: string, _activityId: string, _formData: FormData) => ({ ok: true as const }),
)
vi.mock('../actions', () => ({
  saveQuizConfigAction: (campaignId: string, activityId: string, formData: FormData) =>
    saveQuizConfigAction(campaignId, activityId, formData),
}))

/**
 * เดิน Zod shape ของ TemplateCopy แบบ recursive หา leaf path ทุกอัน (unwrap
 * ZodOptional/ZodDefault/ZodNullable ระหว่างทาง) — ไม่ลงไปใน item schema ของ array
 * (rewards.milestones ถือเป็น leaf เดียว, ตัว editor แถวย่อยไม่ต้องมี data-field ของตัวเอง)
 *
 * ต้องเช็คด้วย instanceof เจาะจงชนิด ไม่ใช่ duck-type ด้วย `typeof x.unwrap === 'function'`
 * เฉยๆ — ใน Zod v4 ตัว ZodArray เองก็มี .unwrap() (คืน element type ของ array) ด้วย
 * เหมือนกัน ถ้าเดินแบบ duck-type จะเผลอ "แกะ" เข้าไปใน item schema ของ array กลายเป็นเดิน
 * ลึกเกินจุดที่ควรหยุด (พิสูจน์แล้วจากบั๊กจริงตอนเขียนเทสต์นี้ — ต้องหยุดที่ระดับ array)
 */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodDefault) {
    return unwrap((schema as unknown as { removeDefault: () => z.ZodTypeAny }).removeDefault())
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return unwrap((schema as unknown as { unwrap: () => z.ZodTypeAny }).unwrap())
  }
  return schema
}

function leafPaths(schema: z.ZodTypeAny, prefix: string[] = []): string[] {
  const inner = unwrap(schema)
  if (inner instanceof z.ZodObject) {
    return Object.entries(inner.shape).flatMap(([key, val]) => leafPaths(val as z.ZodTypeAny, [...prefix, key]))
  }
  return [prefix.join('.')]
}

const duoConfig: QuizConfig = {
  mode: 'duo',
  axes: [{ id: 'ei', label: 'E/I', poles: ['E', 'I'] }, { id: 'sn', label: 'S/N', poles: ['S', 'N'] }],
  questions: [
    { id: 'q1', text: 'q1', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
    { id: 'q2', text: 'q2', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
    { id: 'q3', text: 'q3', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] },
  ],
  results: [{ code: 'E', title: 't', body: 'b' }, { code: 'I', title: 't', body: 'b' }],
  fallbackResultCode: 'E',
  group: {
    enabled: true, minMembers: 2, maxMembers: 10, resultLocksAt: 0,
    archetypes: [{ code: 'fb', title: 't', body: 'b', minGroupSize: 2, fallback: true }],
    fallbackArchetype: 'fb',
  },
}

const fullTemplateCopy = {
  brand: { name: 'Test brand', primaryColor: '#112233' },
  intro: { title: 'intro title', body: 'intro body', ctaLabel: 'intro cta' },
  friendGate: { title: 'fg title', body: 'fg body', ctaLabel: 'fg cta' },
  openInLine: { title: 'oil title', body: 'oil body' },
  invite: { shareTitle: 'invite title', shareBodyTemplate: 'invite body {axisName}' },
  rewards: { milestones: [{ key: 'm1', label: 'milestone 1', triggerCount: 1 }] },
  messages: {
    resultCard: { eyebrow: 'eyebrow', ctaLabel: 'result cta' },
    keywordCard: { title: 'kw title', body: 'kw body', ctaLabel: 'kw cta' },
    soloShare: { badge: 'solo badge', ctaLabel: 'solo cta', secondaryCtaLabel: 'solo cta2' },
    duoInvite: { titleTemplate: 'duo invite title', bodyTemplate: 'duo invite body', ctaLabel: 'duo invite cta' },
    duoPartnerAnswered: { badge: 'partner badge', ctaLabel: 'partner cta' },
    duoPairResult: { badge: 'pair badge', rankLineTemplate: 'rank {rank}', ctaLabel: 'pair cta' },
    duoReminder: { badge: 'reminder badge', headlineTemplate: 'headline', ctaLabel: 'reminder cta' },
    groupComplete: { badge: 'group complete badge', ctaLabel: 'group complete cta' },
    groupUnlock: { headlineTemplate: 'unlock headline', ctaLabel: 'unlock cta' },
    groupReminder: { badge: 'group reminder badge', headlineTemplate: 'gr headline', subText: 'gr sub', ctaLabel: 'gr cta' },
    groupInvite: {
      headerCompleteTemplate: 'complete header', headerIncompleteTemplate: 'incomplete header',
      body: 'group invite body', ctaLabel: 'gi cta', secondaryCtaLabel: 'gi cta2',
    },
  },
}

const fullConfig: QuizConfig = { ...duoConfig, templateCopy: fullTemplateCopy }

describe('TemplateCopyForm', () => {
  it('every leaf field in TemplateCopy has a corresponding data-field input in this form', () => {
    // messages.soloShare.* only ever renders when mode==='solo', while invite/duoInvite/.../
    // group*.* only render for mode==='duo' (+ group.enabled) — mode is mutually exclusive
    // per activity, so no single config render can show every leaf at once. Check the
    // duo+group render for everything except the solo-only branch, then check a solo render
    // for that branch specifically — together this still proves every real leaf has *some*
    // corresponding input somewhere in this form, which is the actual guarantee this test
    // exists for (no field silently has no UI at all, see design doc §10).
    const allPaths = leafPaths(TemplateCopy).filter((p) => p !== 'messages.keywordCard.customFlexJson')
    const soloOnlyPaths = allPaths.filter((p) => p.startsWith('messages.soloShare.'))
    const otherPaths = allPaths.filter((p) => !p.startsWith('messages.soloShare.'))

    const { container: duoContainer } = render(
      <TemplateCopyForm campaignId="c1" activityId="a1" initial={fullConfig} canEdit />,
    )
    for (const path of otherPaths) {
      const el = duoContainer.querySelector(`[data-field="templateCopy.${path}"]`)
      expect(el, `missing input for templateCopy.${path}`).not.toBeNull()
    }
    expect(duoContainer.querySelector('[data-field="templateCopy.messages.keywordCard.customFlexJson"]')).not.toBeNull()
    cleanup()

    const soloConfig: QuizConfig = { ...fullConfig, mode: 'solo', group: undefined }
    const { container: soloContainer } = render(
      <TemplateCopyForm campaignId="c1" activityId="a1" initial={soloConfig} canEdit />,
    )
    for (const path of soloOnlyPaths) {
      const el = soloContainer.querySelector(`[data-field="templateCopy.${path}"]`)
      expect(el, `missing input for templateCopy.${path}`).not.toBeNull()
    }
  })

  it('shows current values when editing an existing templateCopy', () => {
    render(<TemplateCopyForm campaignId="c1" activityId="a1" initial={fullConfig} canEdit />)
    expect(screen.getByDisplayValue('Test brand')).toBeDefined()
    expect(screen.getByDisplayValue('intro title')).toBeDefined()
    expect(screen.getByDisplayValue('milestone 1')).toBeDefined()
  })

  it('duo-only fields are shown when mode is duo, hidden when mode is solo', () => {
    // แต่ละจอโหลดใหม่ทุกครั้งด้วย initial ก้อนเดียวจาก server component (ดู template/page.tsx)
    // ไม่ใช่ rerender component เดิมด้วย prop ใหม่ — ทดสอบด้วยการ render สองรอบแยกกัน
    // ให้ตรงกับการใช้งานจริง (useState(initial) ตั้งค่าครั้งเดียวตอน mount โดยเจตนา
    // เหมือน RepliesForm.tsx เดิม)
    const { unmount } = render(<TemplateCopyForm campaignId="c1" activityId="a1" initial={fullConfig} canEdit />)
    expect(screen.getByDisplayValue('invite title')).toBeDefined()
    expect(screen.getByDisplayValue('duo invite title')).toBeDefined()
    unmount()

    const soloConfig: QuizConfig = { ...fullConfig, mode: 'solo', group: undefined }
    render(<TemplateCopyForm campaignId="c1" activityId="a1" initial={soloConfig} canEdit />)
    expect(screen.queryByDisplayValue('invite title')).toBeNull()
    expect(screen.queryByDisplayValue('duo invite title')).toBeNull()
  })

  it('group-only fields are shown only when group.enabled is true', () => {
    const noGroupConfig: QuizConfig = { ...fullConfig, group: { ...fullConfig.group!, enabled: false } }
    render(<TemplateCopyForm campaignId="c1" activityId="a1" initial={noGroupConfig} canEdit />)
    expect(screen.queryByDisplayValue('group complete badge')).toBeNull()
  })

  it('submits the whole QuizConfig via saveQuizConfigAction with templateCopy carried through', async () => {
    render(<TemplateCopyForm campaignId="c1" activityId="a1" initial={fullConfig} canEdit />)
    fireEvent.click(screen.getByText('บันทึกเทมเพลต'))
    await waitFor(() => expect(saveQuizConfigAction).toHaveBeenCalledTimes(1))
    const [savedCampaignId, savedActivityId, formData] = saveQuizConfigAction.mock.calls[0]
    expect(savedCampaignId).toBe('c1')
    expect(savedActivityId).toBe('a1')
    const saved = JSON.parse(String(formData.get('config')))
    expect(saved.mode).toBe('duo')
    expect(saved.axes).toEqual(fullConfig.axes)
    expect(saved.templateCopy.brand.name).toBe('Test brand')
  })

  it('shows validation errors from QuizConfig.safeParse inline', () => {
    const invalidConfig: QuizConfig = {
      ...fullConfig,
      templateCopy: { ...fullTemplateCopy, brand: { name: '' } },
    }
    render(<TemplateCopyForm campaignId="c1" activityId="a1" initial={invalidConfig} canEdit />)
    expect(screen.getByText(/ยังบันทึกไม่ได้/)).toBeDefined()
  })
})
