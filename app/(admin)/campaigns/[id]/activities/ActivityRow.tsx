import type { CSSProperties } from 'react'
import { Badge, Button } from '@/components/ui'
import type { ActivityView } from '@/lib/db/activities'
import { deleteActivity, setActivityEnabled } from './actions'

const codeChipStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-3)',
  background: 'var(--ground)', border: '1px solid var(--rule)',
  borderRadius: 'var(--r-sm)', padding: '2px 8px',
}

const linkChipStyle: CSSProperties = {
  fontSize: 11, border: '1px solid var(--rule)', background: 'var(--ground)',
  borderRadius: 'var(--r-pill)', padding: '2px 10px',
}

const railLabelStyle: CSSProperties = {
  fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.05em',
  textTransform: 'uppercase', color: 'var(--ink-3)',
}

/** แถวของทางเดินหนึ่งเส้น · "เข้าจาก →" หรือ "พาไป →" */
function Rail({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
      <span style={railLabelStyle}>{label}</span>
      {items.map((item) => <span key={item} style={linkChipStyle}>{item}</span>)}
    </div>
  )
}

/**
 * แถวหนึ่งของกิจกรรมในจอ M7-S01
 *
 * The three badges are not decoration. "ไม่มีทางเข้าถึง" means no keyword, no
 * button and no follow trigger points here, so the activity will never run no
 * matter how correct the rest of it is — and nothing else in the system says
 * so. "ตั้งค่าไม่ครบ" counts the things a player would hit. Both are computed in
 * lib/db/activities.ts, where they have tests of their own.
 *
 * The switch says what the activity is now — เปิดอยู่ / ปิดอยู่ — rather than
 * what pressing it would do. A row of buttons reading "ปิด" beside enabled
 * activities and "เปิด" beside disabled ones is a list that has to be read
 * backwards to learn the state, which is the state people actually scan for.
 */
export function ActivityRow({ campaignId, activity, canEdit }: {
  campaignId: string
  activity: ActivityView
  canEdit: boolean
}) {
  // ควิซบุคลิกภาพไม่มีจอ M7-S02 ให้ตั้งค่า (resolve_method เป็น NULL ทำให้จอนั้น throw
  // — ดูคอมเมนต์ของ fieldsForActivity ใน lib/db/activities.ts) จึงพาไปจอควิซของ
  // Task 11 แทนทั้งชื่อและปุ่ม "ตั้งค่า →"
  const setupHref = activity.inputType === 'personality_quiz'
    ? `/campaigns/${campaignId}/activities/${activity.id}/quiz`
    : `/campaigns/${campaignId}/activities/${activity.id}`

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      {canEdit && (
        <form action={setActivityEnabled.bind(null, campaignId, activity.id, !activity.isEnabled)}>
          <Button
            type="submit"
            variant="ghost"
            style={{ padding: '5px 12px', fontSize: 11 }}
            title={activity.isEnabled ? 'กดเพื่อปิดกิจกรรมนี้' : 'กดเพื่อเปิดกิจกรรมนี้'}
          >
            {activity.isEnabled ? 'เปิดอยู่' : 'ปิดอยู่'}
          </Button>
        </form>
      )}

      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <a href={setupHref} style={{ fontSize: 14, fontWeight: 600 }}>{activity.name}</a>
          <span style={codeChipStyle}>{activity.code}</span>
          <Badge tone="mute">{activity.inputName}</Badge>
          {/* personality_quiz มี resolve_method เป็น NULL เสมอ (0014_quiz_engine.sql) —
              resolveMethodName(null) ไม่ใช่ key จริงของ RESOLVE_METHOD_NAME จึงคืน undefined
              และแถวนี้เคยขึ้นเป็น badge ว่างเปล่าให้ทุกกิจกรรมควิซ (Minor finding ของรีวิว
              รอบสุดท้าย) — inputName ข้างบนโชว์ "ควิซบุคลิกภาพ" อยู่แล้ว ป้ายที่สองนี้จึง
              ไม่มีอะไรเพิ่มให้ควิซ ไม่โชว์เลยดีกว่าโชว์ป้ายว่าง */}
          {activity.inputType !== 'personality_quiz' && (
            <Badge tone="mute">{activity.resolveName}</Badge>
          )}
          {activity.isFollowEntry && <Badge tone="info">⌂ เข้าจากเมนูหลัก</Badge>}
          {activity.isUnreachable && <Badge tone="danger">ไม่มีทางเข้าถึง</Badge>}
          {activity.isIncomplete && <Badge tone="warn">ตั้งค่าไม่ครบ</Badge>}
        </div>

        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>
          {activity.conditionText}
        </div>

        <Rail label="เข้าจาก →" items={activity.reachedBy} />
        <Rail label="พาไป →" items={activity.links} />
      </div>

      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        {canEdit && (
          <form action={deleteActivity.bind(null, campaignId, activity.id)}>
            <Button
              type="submit"
              variant="ghost"
              title="ลบกิจกรรมนี้"
              style={{ padding: '8px 12px', fontSize: 12 }}
            >
              ✕
            </Button>
          </form>
        )}
        <a href={setupHref}>
          <Button variant="ghost" style={{ padding: '8px 14px', fontSize: 12 }}>ตั้งค่า →</Button>
        </a>
      </div>
    </div>
  )
}
