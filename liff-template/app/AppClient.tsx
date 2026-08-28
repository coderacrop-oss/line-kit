'use client'

import { useEffect, useState } from 'react'
import type { QuizConfig } from '../lib/schema'
import { getProfile, isFriend, isInClient } from '../lib/liff/client'
import { ErrorScreen } from './screens/ErrorScreen'
import { FriendGate } from './screens/FriendGate'
import { Intro } from './screens/Intro'
import { Loading } from './screens/Loading'
import { OpenInLine } from './screens/OpenInLine'
import { Question } from './screens/Question'
import { Rewards } from './screens/Rewards'
import { Summary } from './screens/Summary'

type Screen = 'loading' | 'open-in-line' | 'friend-gate' | 'intro' | 'question' | 'summary' | 'rewards' | 'error'

type AnswerEntry = { questionId: string; optionId: string }

export interface AppClientProps {
  quiz: QuizConfig
}

/**
 * Screen-flow state machine (design doc §7.1) for the fully-wired **solo** path —
 * duo/group need cross-device state via lib/store/ (Store interface, design doc §8)
 * and are a follow-on once a real deployment needs them (see README). Every piece of
 * visible copy comes from `quiz.templateCopy`/`quiz.results`/`quiz.questions` — this
 * component itself renders no campaign-specific text.
 */
export function AppClient({ quiz }: AppClientProps) {
  const [screen, setScreen] = useState<Screen>('loading')
  const [questionIndex, setQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<AnswerEntry[]>([])
  const [resultCode, setResultCode] = useState<string | null>(null)
  const [error, setError] = useState<{ title: string; body: string } | null>(null)

  const tc = quiz.templateCopy

  useEffect(() => {
    let cancelled = false
    async function boot() {
      if (!isInClient()) {
        if (!cancelled) setScreen('open-in-line')
        return
      }
      await getProfile()
      const friend = await isFriend()
      if (cancelled) return
      setScreen(friend ? 'intro' : 'friend-gate')
    }
    void boot()
    return () => { cancelled = true }
  }, [])

  if (!tc) {
    // เกิดขึ้นได้เฉพาะ config ที่ export มาแบบไม่ผ่านกฎ templateCopy (ไม่ควรเกิดจริง เพราะ
    // lib/liffExport/assemble.ts ปฏิเสธ export ตั้งแต่ต้นถ้า templateCopy ไม่ครบ) — ข้อความ
    // นี้เป็น label ทางเทคนิคล้วนๆ ไม่ใช่ campaign copy ตามข้อยกเว้นที่สเปกอนุญาต
    return <ErrorScreen title="Configuration error" body="This template's config is missing templateCopy." />
  }

  if (screen === 'loading') return <Loading />
  if (screen === 'error' && error) return <ErrorScreen title={error.title} body={error.body} />
  if (screen === 'open-in-line') return <OpenInLine openInLine={tc.openInLine} />
  if (screen === 'friend-gate') {
    return <FriendGate friendGate={tc.friendGate} onContinue={() => setScreen('intro')} />
  }
  if (screen === 'intro') {
    return <Intro brand={tc.brand} intro={tc.intro} onContinue={() => setScreen('question')} />
  }
  if (screen === 'question') {
    const question = quiz.questions[questionIndex]
    return (
      <Question
        question={question}
        onAnswer={(optionId) => {
          const nextAnswers = [...answers, { questionId: question.id, optionId }]
          setAnswers(nextAnswers)
          if (questionIndex + 1 < quiz.questions.length) {
            setQuestionIndex(questionIndex + 1)
            return
          }
          void submit(nextAnswers)
        }}
      />
    )
  }
  if (screen === 'summary' && resultCode) {
    const result = quiz.results.find((r) => r.code === resultCode)
    return (
      <div>
        <Summary
          resultTitle={result?.title ?? resultCode}
          resultBody={result?.body ?? ''}
          resultImageUrl={result?.imageUrl}
          history={[]}
        />
        {tc.rewards.milestones.length > 0 && (
          <div style={{ textAlign: 'center', padding: 16 }}>
            {/* "Rewards" is generic nav chrome, not campaign copy — same exception as "Loading…" */}
            <button onClick={() => setScreen('rewards')}>Rewards</button>
          </div>
        )}
      </div>
    )
  }
  if (screen === 'rewards') {
    return <Rewards milestones={tc.rewards.milestones} claimed={[]} />
  }

  return <Loading />

  async function submit(finalAnswers: AnswerEntry[]): Promise<void> {
    setScreen('loading')
    try {
      const res = await fetch('/api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: finalAnswers }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError({ title: 'Something went wrong', body: String(body.error ?? 'Unknown error') })
        setScreen('error')
        return
      }
      setResultCode(body.resultCode)
      setScreen('summary')
    } catch {
      setError({ title: 'Something went wrong', body: 'Could not reach the server. Please try again.' })
      setScreen('error')
    }
  }
}
