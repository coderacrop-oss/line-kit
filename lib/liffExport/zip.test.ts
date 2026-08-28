import { describe, expect, it } from 'vitest'
import { zipFiles } from './zip'

// อ่าน Readable stream ทั้งก้อนเป็น Buffer เดียว — ใช้ยืนยันผล zipFiles ในเทสต์นี้เท่านั้น
async function collectStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

describe('zipFiles', () => {
  it('produces a valid zip stream starting with the PK magic bytes', async () => {
    const files = [
      { path: 'hello.txt', content: Buffer.from('hello world') },
      { path: 'nested/dir/file.json', content: Buffer.from(JSON.stringify({ a: 1 })) },
    ]

    const stream = zipFiles(files)
    const buf = await collectStream(stream)

    // PK\x03\x04 — local file header signature ของ zip format
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    expect(buf.length).toBeGreaterThan(files.reduce((sum, f) => sum + f.content.length, 0))
  })
})
