'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { devLoginAllowed } from '@/lib/auth/devlogin'
import { resolveUser } from '@/lib/auth/session'

const COOKIE = 'fsb_email'

function setSessionCookie(email: string) {
  return cookies().then((store) =>
    store.set(COOKIE, email, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 12,
    }),
  )
}

/**
 * The test entrance. It skips Google and nothing else — the email still has to
 * be on the allowlist and still has to be active, so this cannot let anyone in
 * who could not have signed in normally.
 */
export async function devLogin(formData: FormData): Promise<void> {
  if (!devLoginAllowed({ nodeEnv: process.env.NODE_ENV })) {
    throw new Error('ทางเข้าสำหรับทดสอบถูกปิดอยู่')
  }

  const email = String(formData.get('email') ?? '').trim()
  if (!email) throw new Error('ต้องกรอกอีเมล')

  const result = await resolveUser(email)
  if (!('userId' in result)) {
    throw new Error(
      result.reason === 'revoked'
        ? 'บัญชีนี้ถูกถอนสิทธิ์แล้ว'
        : 'อีเมลนี้ยังไม่อยู่ในรายชื่อที่อนุญาต',
    )
  }

  // ไม่มี Google เป็นพยานว่าใครเข้ามา จึงต้องทิ้งร่องรอยเอง · ลง stderr ไม่ใช่
  // token_access_log เพราะตารางนั้นผูกกับ channel และ CHECK ของ purpose ไม่มี
  // ค่าไหนแปลว่า "มีคนเข้าทางลัด" — ยัดค่าที่ใกล้เคียงลงไปจะทำให้ตารางตรวจสอบ
  // เก็บเหตุผลที่ไม่จริง ซึ่งแย่กว่าไม่เก็บ
  console.warn(`[dev-login] ${result.email} เข้าระบบผ่านทางเข้าสำหรับทดสอบ`)

  await setSessionCookie(result.email)
  redirect('/campaigns')
}

export async function signOut(): Promise<void> {
  ;(await cookies()).delete(COOKIE)
  redirect('/login')
}
