import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * ที่ที่ไฟล์ไปอยู่จริง
 *
 * There is no object storage bound to this project and no Supabase Storage
 * client in it, so this slice ships one implementation: files land on the disk
 * of whatever is running the app, under `public/uploads`, and Next serves them
 * as static files from there.
 *
 * It is behind an interface with two methods because the day a bucket appears is
 * the day this becomes the wrong place — and because the alternative, a call to
 * `writeFile` in the middle of a Server Action, is a call nothing can substitute
 * in a test without also faking the database next to it.
 *
 * What it is not is a stub that reports success. A write that fails throws, the
 * asset row is never inserted, and the screen says the upload did not happen.
 * The failure that matters is a read-only filesystem — a container image or a
 * serverless deploy — and it has to be loud there rather than six weeks later
 * when a card renders a URL with nothing behind it.
 */
export type StoredFile = { storagePath: string; publicUrl: string }

export type AssetStore = {
  /** ประโยคที่จอเอาไปบอกคนว่าไฟล์ไปอยู่ไหน · จอไม่ควรเดาเองว่าเบื้องหลังเป็นอะไร */
  readonly describe: string
  put(storagePath: string, data: Uint8Array): Promise<StoredFile>
}

/** โฟลเดอร์ที่ Next เสิร์ฟเป็นไฟล์นิ่ง · ต่อท้าย root ที่ตั้งไว้ */
export const PUBLIC_PREFIX = 'uploads'

/** อักขระควบคุม ช่องว่าง และตัวคั่นของ URL · ทุกช่วงเขียนแยกไว้ ไม่ให้เกิดช่วงโดยบังเอิญ */
const UNSAFE_IN_PATH = /[\u0000-\u001f\u007f\s?#%&"'<>:|*\\]+/g

/**
 * ชื่อไฟล์ที่ปลอดภัยพอจะเป็นทั้งชื่อบนดิสก์และท่อนหนึ่งของ URL
 *
 * The name arrives from the person's computer, which means it can contain a
 * path. `../../.env` as a filename is not a hypothetical — it is the first thing
 * anyone tries. Separators and dot-runs are removed rather than escaped, because
 * a name that still contains them is a name someone downstream will join onto a
 * root and get a file outside it.
 *
 * Thai letters are kept. The library lists what was uploaded, and a screen that
 * shows every Thai filename as a row of dashes has thrown away the only thing
 * telling two files apart.
 */
export function safeFileName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? ''
  const cleaned = base
    // ตัวคั่นของ URL และอักขระควบคุม ทำให้ที่อยู่ของไฟล์กลายเป็นคนละที่
    .replace(UNSAFE_IN_PATH, '-')
    // จุดนำหน้าถูกตัด · ".." และ "..." จึงไม่เหลืออะไรและได้ชื่อสำรองแทน
    // ส่วนจุดที่อยู่กลางชื่อไม่ถูกยุบ เพราะมันเป็นชื่อที่คนตั้งมา ไม่ใช่ที่อยู่
    .replace(/^[.-]+/, '')
    .slice(0, 120)
  return cleaned === '' ? 'upload' : cleaned
}

/**
 * ที่อยู่ของไฟล์หนึ่งไฟล์ · โฟลเดอร์ใหม่ทุกครั้ง ไม่ใช่ชื่อใหม่
 *
 * Every upload gets its own directory, so the stored name is the name the person
 * uploaded and the library can show it back without unpicking a prefix. It is
 * also what makes storage_path unique without the column having to arbitrate:
 * uploading the same filename twice is BR-25's whole subject, and the second one
 * must not be able to land on the first.
 */
export function storagePathFor(
  campaignId: string, fileName: string, unique: string = randomUUID(),
): string {
  return `${PUBLIC_PREFIX}/${campaignId}/${unique}/${safeFileName(fileName)}`
}

/** ชื่อไฟล์อย่างที่คนเห็นในคลัง · ท่อนสุดท้ายของที่อยู่ */
export function fileNameOf(storagePath: string): string {
  return storagePath.slice(storagePath.lastIndexOf('/') + 1)
}

/**
 * เก็บลงดิสก์ของเครื่องที่รันแอป · Next เสิร์ฟจาก public/ ให้เอง
 *
 * The write refuses to replace a file that is already there ('wx'). Nothing here
 * ever needs to, and a store that can overwrite is a store that can destroy the
 * file a card already sent into a chat is pointing at — the exact thing BR-25
 * exists to prevent.
 */
export function localDiskStore(root: string): AssetStore {
  return {
    // ประโยคนี้ขึ้นจอ · ที่อยู่เต็มบนดิสก์อยู่ในข้อความ error เท่านั้น เพราะโครง
    // ของเครื่องที่รันระบบไม่ใช่ของที่จอต้องบอกใคร
    describe: `เก็บเป็นไฟล์จริงบนเครื่องที่รันระบบ ใต้โฟลเดอร์ ${PUBLIC_PREFIX}/`,

    async put(storagePath, data) {
      const target = resolve(root, storagePath)
      // กันที่อยู่ที่พาออกไปนอก root · safeFileName กันชื่อไฟล์แล้ว แต่ที่อยู่
      // ทั้งเส้นประกอบขึ้นจากหลายท่อน และด่านสุดท้ายควรอยู่ตรงที่เขียนจริง
      if (target !== resolve(root) && !target.startsWith(resolve(root) + sep)) {
        throw new Error('ที่อยู่ของไฟล์พาออกไปนอกที่เก็บ — ไม่เขียน')
      }

      try {
        // mkdir อยู่ในนี้ด้วย · ดิสก์ที่เขียนไม่ได้ล้มตั้งแต่ตอนสร้างโฟลเดอร์
        // ไม่ใช่ตอนเขียนไฟล์ และถ้าปล่อยให้หลุดออกไปดิบๆ จอจะได้ ENOTDIR ไปแสดง
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, data, { flag: 'wx' })
      } catch (error) {
        const code = (error as { code?: string }).code
        if (code === 'EEXIST') throw new Error('มีไฟล์อยู่ที่เดิมแล้ว — ไม่เขียนทับ')
        throw new Error(
          `เขียนไฟล์ลงที่เก็บไม่ได้ (${code ?? 'unknown'}) — ${
            join(root, PUBLIC_PREFIX)} เขียนไม่ได้ ระบบจึงไม่บันทึกภาพนี้ลงคลัง`,
        )
      }

      return { storagePath, publicUrl: `/${storagePath}` }
    },
  }
}

/**
 * ที่เก็บที่ระบบใช้จริงวันนี้
 *
 * ASSET_STORAGE_ROOT exists so a test can point this somewhere disposable. The
 * default is the project's `public` directory because that is the one place Next
 * serves files from without a route handler, and this slice adds no routes.
 */
export function assetStore(): AssetStore {
  return localDiskStore(process.env.ASSET_STORAGE_ROOT ?? join(process.cwd(), 'public'))
}
