import type { QuizQuestion } from '../../lib/schema'

export interface QuestionProps {
  question: QuizQuestion
  onAnswer: (optionId: string) => void
}

/**
 * One quiz question at a time (page.tsx walks `questions[]`, mounting this once per
 * question). `question.text`/`question.options[].label` come straight from
 * `QuizConfig.questions` — nothing hardcoded.
 */
export function Question({ question, onAnswer }: QuestionProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1>{question.text}</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {question.options.map((option) => (
          <button
            key={option.id}
            onClick={() => onAnswer(option.id)}
            style={{
              textAlign: 'left',
              border: '1px solid #ddd',
              borderRadius: 8,
              padding: '12px 16px',
              background: '#fff',
              fontSize: 16,
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
