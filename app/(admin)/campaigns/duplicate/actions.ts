'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/require'
import { duplicateCampaign } from '@/lib/campaign/duplicate'
import { db } from '@/lib/db/client'

const trimmed = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim()

/**
 * ก๊อปแคมเปญหนึ่งตัว · ผู้ตั้งค่าแคมเปญเท่านั้น
 *
 * The screen shows this form only to a configurator, and the screen is not the
 * door. Duplicating reads every configuration row of the source campaign and
 * writes a new campaign owned by whoever asked — which is a copy of somebody
 * else's work handed to the caller, so the check belongs here.
 *
 * What is refused is not decided by this function and cannot be argued with
 * from the form: `lib/campaign/duplicate.ts` copies the tables on its list and
 * there is no parameter that adds to it (BR-24). A form field asking for the
 * channel to be copied would be a field with nothing on the other end.
 */
export async function duplicate(formData: FormData): Promise<void> {
  const session = await requireRole('configurator')

  const result = await duplicateCampaign(db(), {
    sourceId: trimmed(formData, 'source_id'),
    name: trimmed(formData, 'name'),
    code: trimmed(formData, 'code'),
    startAt: trimmed(formData, 'start_at'),
    endAt: trimmed(formData, 'end_at'),
    actorId: session.userId,
  })

  revalidatePath('/campaigns')
  // ไปที่ตัวใหม่ ไม่ใช่กลับไปรายการ · สิ่งที่คนกดก๊อปจะทำต่อคือแก้ของในตัวใหม่
  redirect(`/campaigns/${result.id}`)
}
