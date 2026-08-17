import { describe, expect, it } from 'vitest'
import { periodKey } from '../daykey'
import {
  PREVIEW_LINE_UID, STOCK_MODES, dayLabel, isPreviewLineChannelId,
  previewChannelName, previewLineChannelId, previewNow,
} from './sim'

const BASE = new Date('2026-08-17T05:00:00Z')

describe('รหัสช่องของชั้นตัวอย่าง', () => {
  it('แคมเปญคนละตัวได้คนละรหัส', () => {
    expect(previewLineChannelId('c1')).not.toBe(previewLineChannelId('c2'))
  })

  it('แคมเปญเดิมได้รหัสเดิมทุกครั้ง — ไม่งั้นเปิดจอใหม่ทีก็ได้ผู้เล่นจำลองคนใหม่ที', () => {
    expect(previewLineChannelId('c1')).toBe(previewLineChannelId('c1'))
  })

  // คอลัมน์ line_channel_id เป็น UNIQUE ทั้งตาราง (BR-68) · รหัสของชั้นตัวอย่าง
  // จึงต้องเป็นรูปที่บัญชี LINE จริงเป็นไปไม่ได้ ไม่งั้นวันหนึ่งจะไปชนของจริง
  it('ไม่ใช่รูปของรหัสบัญชี LINE จริง ซึ่งเป็นตัวเลขล้วน', () => {
    expect(/^\d+$/.test(previewLineChannelId('c1'))).toBe(false)
  })

  it('บอกได้ว่ารหัสไหนเป็นของชั้นตัวอย่าง', () => {
    expect(isPreviewLineChannelId(previewLineChannelId('c1'))).toBe(true)
    expect(isPreviewLineChannelId('1234567890')).toBe(false)
  })

  it('ผู้เล่นจำลองมีรหัสเดียวคงที่ จะได้เล่นต่อจากเดิมเมื่อกลับมาเปิดจอ', () => {
    expect(PREVIEW_LINE_UID.length).toBeGreaterThan(0)
  })

  // จอบอกชื่อช่องก่อนที่แถวของช่องจะถูกสร้าง (สร้างตอนกดครั้งแรก) · ถ้าชื่อ
  // มาจากคนละที่กัน สองที่นั้นจะเริ่มไม่ตรงกันวันที่ชื่อแคมเปญถูกแก้
  it('ชื่อช่องบอกได้ว่าเป็นของแคมเปญไหนและเป็นชั้นตัวอย่าง', () => {
    expect(previewChannelName('ปีใหม่')).toContain('ปีใหม่')
    expect(previewChannelName('ปีใหม่')).toContain('ตัวอย่าง')
  })
})

describe('นาฬิกาจำลอง · ปุ่มข้ามวัน', () => {
  it('ไม่ข้ามวันคือเวลาปัจจุบัน', () => {
    expect(previewNow(BASE, 0, 86_400).getTime()).toBe(BASE.getTime())
  })

  it('ข้ามหนึ่งวันแล้ว periodKey เปลี่ยน — นี่คือสิ่งที่ทำให้ "เล่นได้อีกครั้ง" ทดสอบได้', () => {
    const before = periodKey(previewNow(BASE, 0, 86_400), 'Asia/Bangkok', 86_400)
    const after = periodKey(previewNow(BASE, 1, 86_400), 'Asia/Bangkok', 86_400)
    expect(after).not.toBe(before)
  })

  it('ข้ามเจ็ดวันได้เจ็ดคาบต่างกัน — การสะสมเจ็ดวันจึงไม่ต้องรอเจ็ดวันจริง', () => {
    const keys = new Set(
      [0, 1, 2, 3, 4, 5, 6].map((d) =>
        periodKey(previewNow(BASE, d, 86_400), 'Asia/Bangkok', 86_400)),
    )
    expect(keys.size).toBe(7)
  })

  it('แคมเปญที่ย่อวันให้สั้นลง ข้ามหนึ่งวันก็เดินแค่ความยาววันของมันเอง', () => {
    expect(previewNow(BASE, 1, 60).getTime() - BASE.getTime()).toBe(60_000)
  })

  // day_length_sec = 0 แปลว่าทั้งแคมเปญคือคาบเดียว (periodKey คืน 'ALL')
  // ข้ามวันจึงเปลี่ยนคาบไม่ได้ แต่ยังต้องเดินนาฬิกาจริงให้เงื่อนไขช่วงเวลาเห็น
  it('แคมเปญที่นับทั้งแคมเปญเป็นคาบเดียว ยังเดินนาฬิกาไปวันละ 24 ชั่วโมง', () => {
    expect(previewNow(BASE, 1, 0).getTime() - BASE.getTime()).toBe(86_400_000)
  })

  it('ย้อนเวลาไม่ได้ — คาบที่เล่นไปแล้วอยู่ในอนาคตของเวลาที่ย้อนกลับไป', () => {
    expect(previewNow(BASE, -3, 86_400).getTime()).toBe(BASE.getTime())
  })
})

describe('ป้ายบอกวันของผู้เล่นจำลอง', () => {
  it('ยังไม่ข้ามวันคือวันที่ 1 ไม่ใช่วันที่ 0', () => {
    expect(dayLabel(0)).toBe('วันที่ 1')
  })

  it('ข้ามไปหกครั้งคือวันที่ 7', () => {
    expect(dayLabel(6)).toBe('วันที่ 7')
  })
})

describe('สถานะที่เกิดยาก (BR-83)', () => {
  it('มีทั้งตามที่ตั้งไว้และรางวัลหมด', () => {
    expect(STOCK_MODES.map((m) => m.value)).toEqual(['as_configured', 'sold_out'])
  })

  it('ทุกโหมดมีทั้งชื่อและคำอธิบายว่ามันจำลองอะไร', () => {
    for (const mode of STOCK_MODES) {
      expect(mode.label.length, mode.value).toBeGreaterThan(0)
      expect(mode.note.length, mode.value).toBeGreaterThan(20)
    }
  })
})
