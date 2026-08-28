import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Finding 1 — zip.ts เดิม `void archive.finalize()` ทิ้ง promise ที่ archiver คืนมาไปเฉยๆ
 * ไม่มีใคร catch เลย ถ้า finalize() reject (เช่น zlib/module error ภายใน) จะกลายเป็น
 * unhandled promise rejection ที่ทำให้ process ทั้งตัวล่มได้ (Node default: unhandled
 * rejection => throw => crash) เทสต์นี้จำลอง archiver ปลอมที่ finalize() reject จริง
 * แล้วยืนยันว่า (1) ไม่มี unhandledRejection หลุดออกมา และ (2) zipToBuffer() ที่ route.ts
 * ใช้จริง reject แบบปกติ (route ดักด้วย try/catch แล้วตอบ error response ได้) แทนที่จะ
 * ทำให้อะไรพัง/ค้าง
 *
 * mock ทั้งไฟล์นี้เพราะต้อง mock module 'archiver' — แยกจาก zip.test.ts ที่ทดสอบ zip
 * จริงด้วย archiver ตัวจริง ไม่ให้ mock ปนกัน
 */
class FakeZipArchive extends Readable {
  private erroredAlready = false

  append(): this {
    return this
  }

  finalize(): Promise<void> {
    return new Promise((_resolve, reject) => {
      queueMicrotask(() => {
        const err = new Error('simulated finalize failure — internal zlib/module error')
        this.erroredAlready = true
        this.emit('error', err)
        reject(err)
      })
    })
  }

  _read(): void {
    // ไม่ push อะไรเลย — ผลลัพธ์มาถึงผ่าน 'error' event ที่ finalize() ยิงเองแทน
    void this.erroredAlready
  }
}

vi.mock('archiver', () => ({ ZipArchive: FakeZipArchive }))

const { zipFiles, zipToBuffer } = await import('./zip')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('zip.ts finalize() rejection handling', () => {
  it('does not produce an unhandled promise rejection when finalize() rejects', async () => {
    const onUnhandledRejection = vi.fn()
    process.on('unhandledRejection', onUnhandledRejection)
    try {
      const stream = zipFiles([{ path: 'a.txt', content: Buffer.from('x') }])
      const errorSeen = new Promise<Error>((resolve) => stream.on('error', resolve))
      await errorSeen
      // ให้ microtask/tick queue ที่เหลือ (ถ้ามี unhandled rejection ค้างอยู่) มีโอกาสยิงก่อนเช็ค
      await new Promise((resolve) => setImmediate(resolve))
      expect(onUnhandledRejection).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })

  it('zipToBuffer() rejects normally with the underlying error instead of crashing or hanging', async () => {
    await expect(
      zipToBuffer([{ path: 'a.txt', content: Buffer.from('x') }]),
    ).rejects.toThrow(/simulated finalize failure/)
  })
})
