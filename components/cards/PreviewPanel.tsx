'use client'

import { useState, useTransition, type CSSProperties } from 'react'
import { Button, Note } from '@/components/ui'
import { Preview } from './Preview'
import { StateSwitcher } from './StateSwitcher'
import type { RenderableCard } from '@/lib/render/card'
import type { CardBlock } from '@/lib/render/groups'
import type { Theme } from '@/lib/render/flex'
import type { PlayerState } from '@/lib/state'

/**
 * กาวของจอตัวอย่าง M3-S02 (Task 14) — ต่อ StateSwitcher (แก้สถานะ) เข้ากับ Preview
 * (วาดผล) เข้ากับปุ่มส่งทดสอบ ตามแบบเดียวกับที่ ChatSim (Task 16) รับ `play`/`reset`
 * เป็น prop function ที่ page.tsx ผูก server action มาให้แล้ว — ไฟล์นี้จึงไม่ import
 * `sendTestCard` ตรงๆ เลย ทดสอบได้โดยไม่ต้อง mock module ใดๆ
 */

const EMPTY_STATE: PlayerState = {
  attributes: {}, counters: {}, entitlements: [], playCounts: {}, completed: [],
}

export type PreviewPanelProps = {
  blocks: CardBlock[]
  theme: Theme
  renderAs: RenderableCard['renderAs']
  rewardCodes: string[]
  activities: Array<{ code: string; name: string }>
  counterCodes: string[]
  /** null = ยังไม่ได้ตั้ง LINE user id ของตัวเอง (BR-62) */
  testLineUid: string | null
  sendTest: (state: PlayerState) => Promise<void>
}

const gap: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14 }

export function PreviewPanel({
  blocks, theme, renderAs, rewardCodes, activities, counterCodes, testLineUid, sendTest,
}: PreviewPanelProps) {
  const [state, setState] = useState<PlayerState>(EMPTY_STATE)
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  function onSend() {
    setResult(null)
    startTransition(async () => {
      try {
        await sendTest(state)
        setResult({ ok: true, text: 'ส่งการ์ดทดสอบแล้ว — เปิด LINE ของตัวเองดูได้เลย' })
      } catch (error) {
        setResult({ ok: false, text: error instanceof Error ? error.message : 'ส่งไม่สำเร็จ' })
      }
    })
  }

  return (
    <div style={gap}>
      <Preview blocks={blocks} state={state} theme={theme} renderAs={renderAs} />

      <StateSwitcher
        state={state} onChange={setState}
        rewardCodes={rewardCodes} activities={activities} counterCodes={counterCodes}
      />

      <div data-test-send style={gap}>
        {testLineUid ? (
          <>
            <Button type="button" onClick={onSend} disabled={pending}>
              {pending ? 'กำลังส่ง…' : 'ส่งการ์ดทดสอบเข้า LINE ของตัวเอง'}
            </Button>
            {result && <Note tone={result.ok ? 'ok' : 'danger'}>{result.text}</Note>}
          </>
        ) : (
          <Note tone="warn">
            ยังไม่ได้ตั้ง LINE user id ของตัวเองไว้รับการ์ดทดสอบ (BR-62) —{' '}
            <a href="/users" style={{ color: 'inherit' }}>ไปตั้งที่หน้าผู้ใช้ก่อน</a>
          </Note>
        )}
      </div>
    </div>
  )
}
