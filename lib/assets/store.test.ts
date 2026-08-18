import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type AssetStore, fileNameOf, localDiskStore, safeFileName, storagePathFor,
} from './store'

describe('safeFileName', () => {
  it('ชื่อธรรมดาผ่านมาเหมือนเดิม', () => {
    expect(safeFileName('promo-day1.png')).toBe('promo-day1.png')
  })

  it('เก็บชื่อไทยไว้ · ไม่งั้นคลังจะมีแต่แถวที่ชื่อเหมือนกันหมด', () => {
    expect(safeFileName('ภาพรางวัล.png')).toBe('ภาพรางวัล.png')
  })

  it('ตัดที่อยู่ที่ติดมากับชื่อออก เหลือแต่ชื่อไฟล์', () => {
    expect(safeFileName('/etc/passwd')).toBe('passwd')
    expect(safeFileName('C:\\Users\\x\\secret.png')).toBe('secret.png')
  })

  it('ชื่อที่พาถอยขึ้นไปข้างบน ไม่เหลือส่วนที่พาถอยขึ้นไป', () => {
    for (const attack of ['../../.env', '..\\..\\.env', '....//....//etc/hosts']) {
      const safe = safeFileName(attack)
      expect(safe, attack).not.toContain('..')
      expect(safe, attack).not.toContain('/')
      expect(safe, attack).not.toContain('\\')
    }
  })

  it('อักขระที่ทำให้ URL กลายเป็นคนละที่ ถูกแทน', () => {
    expect(safeFileName('a?b#c%d.png')).toBe('a-b-c-d.png')
    expect(safeFileName('ภาพ ที่ มี ช่องว่าง.png')).toBe('ภาพ-ที่-มี-ช่องว่าง.png')
  })

  it('ชื่อที่ขึ้นต้นด้วยจุด ไม่กลายเป็นไฟล์ซ่อน', () => {
    expect(safeFileName('.htaccess')).toBe('htaccess')
  })

  it('ชื่อที่เป็นจุดล้วน ไม่เหลือเป็นที่อยู่ที่พาถอยขึ้นไป', () => {
    expect(safeFileName('..')).toBe('upload')
    expect(safeFileName('.')).toBe('upload')
  })

  it('จุดที่อยู่กลางชื่อไม่ถูกยุบ · เป็นชื่อที่คนตั้ง ไม่ใช่ที่อยู่', () => {
    expect(safeFileName('promo..v2.png')).toBe('promo..v2.png')
  })

  it('ชื่อที่ยาวมากถูกตัด · ระบบไฟล์บางระบบรับชื่อได้ 255 ไบต์', () => {
    expect(safeFileName(`${'ก'.repeat(400)}.png`).length).toBeLessThanOrEqual(120)
  })

  it('ชื่อที่ไม่เหลืออะไรเลย ยังได้ชื่อ ไม่ใช่สตริงว่าง', () => {
    expect(safeFileName('')).toBe('upload')
    expect(safeFileName('...')).toBe('upload')
    expect(safeFileName('/')).toBe('upload')
  })
})

describe('storagePathFor', () => {
  it('อยู่ใต้ uploads และใต้ id ของแคมเปญ', () => {
    expect(storagePathFor('c1', 'a.png', 'u1')).toBe('uploads/c1/u1/a.png')
  })

  it('ไฟล์ชื่อเดียวกันสองครั้ง ได้คนละที่ · อันหลังทับอันแรกไม่ได้ (BR-25)', () => {
    const first = storagePathFor('c1', 'promo.png')
    const second = storagePathFor('c1', 'promo.png')
    expect(first).not.toBe(second)
    expect(fileNameOf(first)).toBe('promo.png')
    expect(fileNameOf(second)).toBe('promo.png')
  })

  it('คนละแคมเปญไม่ปนกัน · ภาพผูกกับแคมเปญเดียว ไม่ใช่คลังกลาง', () => {
    expect(storagePathFor('c2', 'a.png', 'u1')).toBe('uploads/c2/u1/a.png')
  })

  it('ชื่อที่พาออกนอกโฟลเดอร์ ถูกล้างก่อนกลายเป็นที่อยู่', () => {
    expect(storagePathFor('c1', '../../../etc/passwd', 'u1')).toBe('uploads/c1/u1/passwd')
  })
})

describe('fileNameOf', () => {
  it('คืนท่อนสุดท้าย ไม่ใช่ทั้งเส้น', () => {
    expect(fileNameOf('uploads/c1/u1/promo-day1.png')).toBe('promo-day1.png')
  })

  it('ที่อยู่ที่ไม่มีขีดคั่นเลย คืนตัวมันเอง', () => {
    expect(fileNameOf('promo.png')).toBe('promo.png')
  })
})

describe('localDiskStore · เขียนลงดิสก์จริง', () => {
  let root: string
  let store: AssetStore

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'linekit-assets-'))
    store = localDiskStore(root)
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const bytes = Uint8Array.from([1, 2, 3, 4, 5])

  it('ไฟล์ที่เขียนแล้วอ่านกลับได้ไบต์เดิมทุกไบต์', async () => {
    const path = storagePathFor('c1', 'real.png')
    const stored = await store.put(path, bytes)

    expect(stored.storagePath).toBe(path)
    const written = await readFile(join(root, path))
    expect(Uint8Array.from(written)).toEqual(bytes)
  })

  it('get อ่านไฟล์ที่ put เขียนไว้กลับมาได้ไบต์เดิมทุกไบต์ — M4-S01 ใช้ตอนอัปโหลดภาพเมนูขึ้น LINE', async () => {
    const path = storagePathFor('c1', 'get-me.png', 'g1')
    await store.put(path, bytes)

    expect(await store.get(path)).toEqual(bytes)
  })

  it('get ที่อยู่ที่พาออกไปนอกที่เก็บ ถูกปฏิเสธเหมือน put', async () => {
    await expect(store.get('../escaped.png')).rejects.toThrow('นอกที่เก็บ')
  })

  it('สร้างโฟลเดอร์ที่ยังไม่มีให้เอง', async () => {
    const path = storagePathFor('campaign-ที่-ไม่-เคย-มี', 'a.png')
    await store.put(path, bytes)
    expect((await stat(join(root, path))).isFile()).toBe(true)
  })

  it('URL ที่คืนมาเป็นที่อยู่ที่เบราว์เซอร์ขอได้ ไม่ใช่ที่อยู่บนดิสก์', async () => {
    const stored = await store.put(storagePathFor('c1', 'b.png', 'u9'), bytes)
    expect(stored.publicUrl).toBe('/uploads/c1/u9/b.png')
    expect(stored.publicUrl).not.toContain(root)
  })

  it('ไม่เขียนทับของที่มีอยู่แล้ว · ไฟล์ที่การ์ดในแชทชี้อยู่ต้องอยู่ต่อ (BR-25)', async () => {
    const path = storagePathFor('c1', 'once.png', 'fixed')
    await store.put(path, bytes)

    await expect(store.put(path, Uint8Array.from([9, 9, 9]))).rejects.toThrow('ไม่เขียนทับ')

    const still = await readFile(join(root, path))
    expect(Uint8Array.from(still)).toEqual(bytes)
  })

  it('ที่อยู่ที่พาออกไปนอกที่เก็บ ถูกปฏิเสธก่อนเขียน', async () => {
    for (const path of ['../escaped.png', 'uploads/../../escaped.png', '/etc/linekit-escaped']) {
      await expect(store.put(path, bytes), path).rejects.toThrow('นอกที่เก็บ')
    }
  })

  it('โฟลเดอร์ข้างบ้านที่ชื่อขึ้นต้นเหมือนกัน ไม่นับว่าอยู่ข้างใน', async () => {
    // /x/store-evil ขึ้นต้นด้วย /x/store ทุกตัวอักษร · การเทียบด้วยคำนำหน้าเปล่าๆ
    // จึงยอมให้เขียนลงโฟลเดอร์ที่อยู่ข้างนอกโดยไม่มีอะไรค้าน
    const neighbour = `../${basename(root)}-evil/x.png`
    await expect(store.put(neighbour, bytes)).rejects.toThrow('นอกที่เก็บ')
  })

  it('เขียนไม่ได้แล้วโยน ไม่ใช่รายงานว่าสำเร็จ · และบอกว่าที่เก็บอยู่ไหน', async () => {
    // ที่เก็บที่ชี้ไปยัง "โฟลเดอร์" ที่จริงๆ เป็นไฟล์ · สร้างโฟลเดอร์ข้างในไม่ได้
    // เป็นตัวแทนของดิสก์ที่เขียนไม่ได้ ซึ่งเป็นความล้มเหลวที่จะเจอจริงตอน deploy
    await store.put('uploads/blocker/x/file.bin', bytes)
    const blocked = localDiskStore(join(root, 'uploads', 'blocker', 'x', 'file.bin'))

    await expect(blocked.put('uploads/c/u/a.png', bytes))
      .rejects.toThrow('เขียนไฟล์ลงที่เก็บไม่ได้')
  })

  it('ที่เก็บที่เขียนไม่ได้ ไม่ทิ้งไฟล์ครึ่งใบไว้ให้ใครไปเจอ', async () => {
    const blocked = localDiskStore(join(root, 'uploads', 'blocker', 'x', 'file.bin'))
    await expect(blocked.put('uploads/c/u/a.png', bytes)).rejects.toThrow()
    await expect(stat(join(root, 'uploads', 'blocker', 'x', 'file.bin', 'uploads')))
      .rejects.toThrow()
  })

  it('บอกได้ว่าไฟล์ไปอยู่ไหน · จอไม่ต้องเดาเองว่าเบื้องหลังเป็นอะไร', () => {
    expect(store.describe).toContain('uploads')
    expect(store.describe).toContain('บนเครื่องที่รันระบบ')
  })

  it('ประโยคที่ขึ้นจอไม่มีที่อยู่เต็มบนดิสก์ · โครงของเครื่องไม่ใช่ของที่จอบอกใคร', () => {
    expect(store.describe).not.toContain(root)
  })

  it('ข้อความตอนเขียนไม่ได้ ยังบอกที่อยู่เต็ม เพราะคนที่ต้องไปแก้คืออีกคน', async () => {
    await store.put('uploads/blocker2/x/file.bin', bytes)
    const blocked = localDiskStore(join(root, 'uploads', 'blocker2', 'x', 'file.bin'))
    await expect(blocked.put('uploads/c/u/a.png', bytes)).rejects.toThrow(root)
  })
})
