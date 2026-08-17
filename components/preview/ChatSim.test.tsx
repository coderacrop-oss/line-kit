// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatSim, type ChatSimProps } from './ChatSim'
import type { PreviewReply } from '@/lib/preview/chat'

// vitest ไม่ได้เปิด globals ไว้ RTL จึงเก็บกวาดเองอัตโนมัติไม่ได้
afterEach(cleanup)

const emptySnapshot = { attributes: [], counters: [], entitlements: [] }

const textReply = (text: string): PreviewReply => ({
  bubble: { kind: 'text', text },
  snapshot: emptySnapshot,
})

function setup(patch: Partial<ChatSimProps> = {}) {
  const play = vi.fn(async () => textReply('ตอบแล้ว'))
  const reset = vi.fn(async () => ({ bubble: null, snapshot: emptySnapshot }))

  const props: ChatSimProps = {
    channelName: 'ตัวอย่าง · แคมเปญทดสอบ',
    menu: [{ label: 'เล่น', text: 'เล่น' }],
    canPlay: true,
    snapshot: emptySnapshot,
    play,
    reset,
    ...patch,
  }

  render(<ChatSim {...props} />)
  return { play, reset }
}

const send = (text: string) => {
  fireEvent.change(screen.getByPlaceholderText('พิมพ์ข้อความตอบ…'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'ส่ง' }))
}

const items = () => Array.from(document.querySelectorAll('[data-chat-item]'))

describe('สวิตช์โหมด', () => {
  it('เริ่มที่โหมดตรวจงาน ซึ่งเป็นโหมดที่เครื่องมือทั้งหมดเปิดอยู่', () => {
    setup()
    expect(screen.getByRole('button', { name: /ข้ามวัน/ })).toBeDefined()
    expect(screen.getByRole('button', { name: '↺ เริ่มใหม่ทั้งหมด' })).toBeDefined()
  })

  it('โหมดสาธิตลูกค้าซ่อนปุ่มข้ามวันและปุ่มเริ่มใหม่', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'สาธิตลูกค้า' }))
    expect(screen.queryByRole('button', { name: /ข้ามวัน/ })).toBe(null)
    expect(screen.queryByRole('button', { name: '↺ เริ่มใหม่ทั้งหมด' })).toBe(null)
  })

  it('กลับมาโหมดตรวจงานแล้วเครื่องมือกลับมา', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'สาธิตลูกค้า' }))
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจงาน' }))
    expect(screen.getByRole('button', { name: /ข้ามวัน/ })).toBeDefined()
  })
})

describe('พิมพ์คุยกับกติกา', () => {
  it('ส่งข้อความแล้วทั้งของเราและคำตอบขึ้นบนจอ', async () => {
    setup({ menu: [] })
    send('เล่น')
    expect(await screen.findByText('ตอบแล้ว')).toBeDefined()
    expect(screen.getByText('เล่น')).toBeDefined()
  })

  it('ข้อความของเราขึ้นก่อนคำตอบเสมอ', async () => {
    setup()
    send('เล่น')
    await screen.findByText('ตอบแล้ว')
    expect(items().map((i) => i.textContent)).toEqual(['เล่น', 'ตอบแล้ว'])
  })

  it('ส่งแล้วช่องพิมพ์ว่างเปล่า พร้อมพิมพ์ต่อ', async () => {
    setup()
    send('เล่น')
    await screen.findByText('ตอบแล้ว')
    expect((screen.getByPlaceholderText('พิมพ์ข้อความตอบ…') as HTMLInputElement).value).toBe('')
  })

  it('ช่องว่างเปล่ากดส่งแล้วไม่ยิงอะไรเลย', () => {
    const { play } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'ส่ง' }))
    expect(play).not.toHaveBeenCalled()
  })

  it('ปุ่มในเมนูจำลองส่งคีย์เวิร์ดของตัวเอง', async () => {
    const { play } = setup({ menu: [{ label: 'ดูรางวัล', text: 'รางวัล' }] })
    fireEvent.click(screen.getByRole('button', { name: 'ดูรางวัล' }))
    await screen.findByText('ตอบแล้ว')
    expect(play).toHaveBeenCalledWith({ kind: 'text', text: 'รางวัล' }, expect.anything())
  })

  it('แคมเปญที่ไม่มีคีย์เวิร์ดเลย บอกว่าเมนูจำลองยังว่าง', () => {
    setup({ menu: [] })
    expect(screen.getByText(/ยังไม่มีคีย์เวิร์ด/)).toBeDefined()
  })
})

describe('ปุ่มบนการ์ด', () => {
  const cardReply: PreviewReply = {
    bubble: {
      kind: 'card',
      altText: 'ผลของคุณ',
      card: {
        hero: null,
        parts: [{ kind: 'title', text: 'ผลของคุณ' }],
        buttons: [
          { label: 'เล่นอีกครั้ง', postback: 'c=x&a=draw&d=2026-08-17', uri: null },
          { label: 'เปิดเว็บ', postback: null, uri: 'https://example.com' },
        ],
      },
    },
    snapshot: emptySnapshot,
  }

  it('กดปุ่มบนการ์ดแล้วยิง postback ตัวเดียวกับที่การ์ดพามา', async () => {
    const play = vi.fn(async () => cardReply)
    render(
      <ChatSim
        channelName="ช่อง" menu={[]} canPlay snapshot={emptySnapshot}
        play={play} reset={async () => ({ bubble: null, snapshot: emptySnapshot })}
      />,
    )
    send('เล่น')
    fireEvent.click(await screen.findByRole('button', { name: 'เล่นอีกครั้ง' }))

    expect(play).toHaveBeenLastCalledWith(
      { kind: 'postback', data: 'c=x&a=draw&d=2026-08-17' }, expect.anything(),
    )
  })

  // ปุ่มลิงก์ของ LINE เปิดเบราว์เซอร์ ไม่ได้ส่งอะไรกลับเข้ากติกา · ถ้าจอจำลอง
  // ยิง postback ให้ คนตั้งค่าจะเชื่อว่าปุ่มลิงก์นับเป็นการเล่นหนึ่งครั้ง
  it('ปุ่มลิงก์ไม่ยิงเข้ากติกา เพราะของจริงก็ไม่ยิง', async () => {
    const play = vi.fn(async () => cardReply)
    render(
      <ChatSim
        channelName="ช่อง" menu={[]} canPlay snapshot={emptySnapshot}
        play={play} reset={async () => ({ bubble: null, snapshot: emptySnapshot })}
      />,
    )
    send('เล่น')
    await screen.findByRole('button', { name: 'เปิดเว็บ' })
    play.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'เปิดเว็บ' }))
    expect(play).not.toHaveBeenCalled()
  })
})

/**
 * ปุ่มข้ามวันต้องเปลี่ยนสิ่งที่ส่งไป ไม่ใช่แค่เปลี่ยนตัวเลขบนจอ
 *
 * A day counter that goes up while every request still says day zero is the
 * exact bug this screen exists to prevent someone shipping.
 */
describe('ปุ่มข้ามวัน', () => {
  it('ปุ่มบอกว่าจะไปวันไหน', () => {
    setup()
    expect(screen.getByRole('button', { name: '⏭ ข้ามวัน → วันที่ 2' })).toBeDefined()
  })

  it('กดแล้วป้ายวันขยับ และปุ่มชี้ไปวันถัดไป', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '⏭ ข้ามวัน → วันที่ 2' }))
    expect(screen.getByText('วันที่ 2')).toBeDefined()
    expect(screen.getByRole('button', { name: '⏭ ข้ามวัน → วันที่ 3' })).toBeDefined()
  })

  it('กดแล้วครั้งถัดไปที่เล่น ส่งวันที่ข้ามไปด้วยจริง', async () => {
    const { play } = setup()
    fireEvent.click(screen.getByRole('button', { name: /ข้ามวัน/ }))
    fireEvent.click(screen.getByRole('button', { name: /ข้ามวัน/ }))
    send('เล่น')
    await screen.findByText('ตอบแล้ว')
    expect(play).toHaveBeenCalledWith(
      { kind: 'text', text: 'เล่น' }, { dayOffset: 2, stock: 'as_configured' },
    )
  })

  it('ยังไม่ข้ามวันก็ส่งวันที่ศูนย์', async () => {
    const { play } = setup()
    send('เล่น')
    await screen.findByText('ตอบแล้ว')
    expect(play).toHaveBeenCalledWith(expect.anything(), { dayOffset: 0, stock: 'as_configured' })
  })

  it('กดข้ามวันแล้วมีบรรทัดบอกไว้ในแชท จะได้อ่านย้อนได้ว่าอะไรเกิดวันไหน', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /ข้ามวัน/ }))
    expect(items().map((i) => i.textContent)).toEqual(['⏭ ข้ามเที่ยงคืน → วันที่ 2 ของแคมเปญ'])
  })
})

describe('สลับดูสถานะที่เกิดยาก (BR-83)', () => {
  it('เลือกรางวัลหมดแล้วส่งสภาพนั้นไปด้วย', async () => {
    const { play } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'รางวัลหมดทุกชิ้น' }))
    send('เล่น')
    await screen.findByText('ตอบแล้ว')
    expect(play).toHaveBeenCalledWith(expect.anything(), { dayOffset: 0, stock: 'sold_out' })
  })

  it('อธิบายว่าโหมดที่เลือกอยู่จำลองอะไร', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'รางวัลหมดทุกชิ้น' }))
    expect(screen.getByText(/โควตารางวัลทุกตัวหมดพอดี/)).toBeDefined()
  })

  it('โหมดสาธิตลูกค้าไม่ให้สลับสภาพคลัง เพราะไม่ใช่ของที่เอาให้ลูกค้าดู', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'สาธิตลูกค้า' }))
    expect(screen.queryByRole('button', { name: 'รางวัลหมดทุกชิ้น' })).toBe(null)
  })
})

describe('ปุ่มเริ่มใหม่', () => {
  it('ถามก่อนหนึ่งครั้ง ไม่ลบทันทีที่กด', () => {
    const { reset } = setup()
    fireEvent.click(screen.getByRole('button', { name: '↺ เริ่มใหม่ทั้งหมด' }))
    expect(reset).not.toHaveBeenCalled()
    expect(screen.getByText(/เริ่มใหม่จะลบผู้เล่นจำลองทั้งหมด/)).toBeDefined()
  })

  it('ยกเลิกแล้วไม่ลบอะไร', () => {
    const { reset } = setup()
    fireEvent.click(screen.getByRole('button', { name: '↺ เริ่มใหม่ทั้งหมด' }))
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }))
    expect(reset).not.toHaveBeenCalled()
    expect(screen.queryByText(/เริ่มใหม่จะลบผู้เล่นจำลองทั้งหมด/)).toBe(null)
  })

  it('ยืนยันแล้วลบจริง แชทว่าง และวันกลับไปวันที่ 1', async () => {
    const { reset } = setup()
    fireEvent.click(screen.getByRole('button', { name: /ข้ามวัน/ }))
    send('เล่น')
    await screen.findByText('ตอบแล้ว')

    fireEvent.click(screen.getByRole('button', { name: '↺ เริ่มใหม่ทั้งหมด' }))
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันเริ่มใหม่' }))

    expect(reset).toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: '⏭ ข้ามวัน → วันที่ 2' })).toBeDefined()
    expect(items()).toEqual([])
  })
})

describe('แผงสถานะผู้เล่นจำลอง', () => {
  it('ยังไม่มีอะไรก็บอกว่ายังไม่มี', () => {
    setup()
    expect(screen.getByText('ยังไม่ได้รับสิทธิ์ใด')).toBeDefined()
    expect(screen.getByText('แคมเปญนี้ไม่มีค่าสะสม')).toBeDefined()
  })

  it('ค่าสะสมขึ้นพร้อมเป้าของมัน', () => {
    setup({
      snapshot: {
        attributes: [], entitlements: [],
        counters: [{ code: 'stamp', name: 'แสตมป์', value: 3, target: 7 }],
      },
    })
    const row = screen.getByText('แสตมป์').closest('[data-state-row]') as HTMLElement
    expect(within(row).getByText('3 / 7')).toBeDefined()
  })

  it('แผงอัปเดตตามผลของการเล่น ไม่ค้างอยู่กับของตอนเปิดจอ', async () => {
    const play = vi.fn(async () => ({
      bubble: { kind: 'text' as const, text: 'ตอบแล้ว' },
      snapshot: {
        attributes: [], counters: [],
        entitlements: [{ code: 'sticker', status: 'granted' }],
      },
    }))
    render(
      <ChatSim
        channelName="ช่อง" menu={[]} canPlay snapshot={emptySnapshot}
        play={play} reset={async () => ({ bubble: null, snapshot: emptySnapshot })}
      />,
    )
    expect(screen.getByText('ยังไม่ได้รับสิทธิ์ใด')).toBeDefined()

    send('เล่น')
    expect(await screen.findByText('sticker')).toBeDefined()
  })

  it('ค่าประจำตัวที่ได้ระหว่างเล่นขึ้นในแผง', () => {
    setup({
      snapshot: {
        counters: [], entitlements: [],
        attributes: [{ key: 'ทีม', value: 'แดง' }],
      },
    })
    const row = screen.getByText('ทีม').closest('[data-state-row]') as HTMLElement
    expect(within(row).getByText('แดง')).toBeDefined()
  })
})

describe('สิทธิ์ผู้ดูรายงาน', () => {
  it('ไม่มีปุ่มเล่น ปุ่มข้ามวัน และปุ่มเริ่มใหม่', () => {
    setup({ canPlay: false })
    expect(screen.queryByRole('button', { name: 'ส่ง' })).toBe(null)
    expect(screen.queryByRole('button', { name: /ข้ามวัน/ })).toBe(null)
    expect(screen.queryByRole('button', { name: '↺ เริ่มใหม่ทั้งหมด' })).toBe(null)
  })

  it('บอกออกมาว่าทำไมถึงกดไม่ได้ ไม่ใช่ปุ่มหายไปเฉยๆ', () => {
    setup({ canPlay: false })
    expect(screen.getByText(/ดูได้อย่างเดียว/)).toBeDefined()
  })

  it('ปุ่มในเมนูจำลองกดไม่ลง และกดแล้วไม่ยิงอะไร', () => {
    const { play } = setup({ canPlay: false, menu: [{ label: 'เล่น', text: 'เล่น' }] })
    const button = screen.getByRole('button', { name: 'เล่น' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(play).not.toHaveBeenCalled()
  })
})

/**
 * กดสองครั้งก่อนคำตอบแรกจะกลับมา
 *
 * This is the one thing the browser can get wrong that the server cannot see:
 * two taps in flight put the player's second message above the reply to their
 * first, and the transcript stops being a record of what happened in order.
 */
describe('กันการกดซ้ำระหว่างรอคำตอบ', () => {
  const withButton: PreviewReply = {
    bubble: {
      kind: 'card',
      altText: 'ผลของคุณ',
      card: {
        hero: null,
        parts: [{ kind: 'title', text: 'ผลของคุณ' }],
        buttons: [{ label: 'เล่นอีกครั้ง', postback: 'c=x&a=draw', uri: null }],
      },
    },
    snapshot: emptySnapshot,
  }

  // ปุ่มบนการ์ดไม่ได้ถูกปิดตอนรอ เพราะการ์ดของ LINE จริงก็ไม่ปิด · ตัวที่กัน
  // การยิงซ้ำจึงเป็นด่านใน run() ไม่ใช่ attribute ของปุ่ม
  it('กดปุ่มบนการ์ดรัวๆ ระหว่างรอคำตอบ ยิงแค่ครั้งเดียว', async () => {
    let release: (() => void) | undefined
    const play = vi.fn()
      .mockResolvedValueOnce(withButton)
      .mockImplementation(() => new Promise<PreviewReply>((resolve) => {
        release = () => resolve(textReply('ตอบแล้ว'))
      }))

    render(
      <ChatSim
        channelName="ช่อง" menu={[]} canPlay snapshot={emptySnapshot}
        play={play} reset={async () => ({ bubble: null, snapshot: emptySnapshot })}
      />,
    )

    send('เล่น')
    const button = await screen.findByRole('button', { name: 'เล่นอีกครั้ง' })

    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(button)
    expect(play).toHaveBeenCalledTimes(2)

    release?.()
    expect(await screen.findByText('ตอบแล้ว')).toBeDefined()
  })

  it('คำตอบกลับมาแล้วกดต่อได้', async () => {
    const play = vi.fn(async () => withButton)
    render(
      <ChatSim
        channelName="ช่อง" menu={[]} canPlay snapshot={emptySnapshot}
        play={play} reset={async () => ({ bubble: null, snapshot: emptySnapshot })}
      />,
    )

    send('เล่น')
    fireEvent.click(await screen.findByRole('button', { name: 'เล่นอีกครั้ง' }))
    await screen.findAllByRole('button', { name: 'เล่นอีกครั้ง' })
    expect(play).toHaveBeenCalledTimes(2)
  })
})

describe('สิ่งที่จอบอกออกมาตรงๆ', () => {
  it('บอกว่ากำลังทำงานกับช่องไหนอยู่ (BR-19)', () => {
    setup({ channelName: 'ตัวอย่าง · แคมเปญปีใหม่' })
    expect(screen.getByText(/ตัวอย่าง · แคมเปญปีใหม่/)).toBeDefined()
  })

  it('กติกาไม่ตอบอะไรเลย ก็บอกว่าไม่ตอบ ไม่ใช่เงียบเหมือนไม่ได้กด', async () => {
    const play = vi.fn(async () => ({ bubble: null, snapshot: emptySnapshot }))
    render(
      <ChatSim
        channelName="ช่อง" menu={[]} canPlay snapshot={emptySnapshot}
        play={play} reset={async () => ({ bubble: null, snapshot: emptySnapshot })}
      />,
    )
    send('สวัสดี')
    expect(await screen.findByText(/\(ไม่มีการตอบกลับ\)/)).toBeDefined()
  })

  it('action ล้มแล้วบอกเหตุผลบนจอ ไม่ใช่กลืนหายไป', async () => {
    const play = vi.fn(async () => { throw new Error('แคมเปญนี้ยังไม่มีกิจกรรม') })
    render(
      <ChatSim
        channelName="ช่อง" menu={[]} canPlay snapshot={emptySnapshot}
        play={play} reset={async () => ({ bubble: null, snapshot: emptySnapshot })}
      />,
    )
    send('เล่น')
    expect(await screen.findByText(/แคมเปญนี้ยังไม่มีกิจกรรม/)).toBeDefined()
  })

  it('เขียนไว้ว่าอะไรจำลองไม่ได้ ต้องไปตรวจบนบัญชีทดสอบเอง', () => {
    setup()
    expect(screen.getByText(/เปิดหน้า LIFF ไม่ได้/)).toBeDefined()
  })
})

describe('การ์ดที่วาดในแชท', () => {
  it('หัวข้อ เนื้อ และภาพ ขึ้นครบตามที่ renderer ส่งมา', async () => {
    const play = vi.fn(async () => ({
      bubble: {
        kind: 'card' as const,
        altText: 'ยินดีด้วย',
        card: {
          hero: 'https://example.com/a.png',
          parts: [
            { kind: 'title' as const, text: 'ยินดีด้วย' },
            { kind: 'text' as const, text: 'คุณได้รางวัล' },
            { kind: 'progress' as const, percent: 40 },
          ],
          buttons: [],
        },
      },
      snapshot: emptySnapshot,
    }))
    render(
      <ChatSim
        channelName="ช่อง" menu={[]} canPlay snapshot={emptySnapshot}
        play={play} reset={async () => ({ bubble: null, snapshot: emptySnapshot })}
      />,
    )
    send('เล่น')

    expect(await screen.findByText('ยินดีด้วย')).toBeDefined()
    expect(screen.getByText('คุณได้รางวัล')).toBeDefined()
    expect(screen.getByRole('img')).toBeDefined()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40')
  })

  it('การ์ดหลายใบวาดครบทุกใบ', async () => {
    const play = vi.fn(async () => ({
      bubble: {
        kind: 'carousel' as const,
        altText: 'สามใบ',
        cards: [
          { hero: null, parts: [{ kind: 'title' as const, text: 'ใบแรก' }], buttons: [] },
          { hero: null, parts: [{ kind: 'title' as const, text: 'ใบสอง' }], buttons: [] },
        ],
      },
      snapshot: emptySnapshot,
    }))
    render(
      <ChatSim
        channelName="ช่อง" menu={[]} canPlay snapshot={emptySnapshot}
        play={play} reset={async () => ({ bubble: null, snapshot: emptySnapshot })}
      />,
    )
    send('เล่น')
    expect(await screen.findByText('ใบแรก')).toBeDefined()
    expect(screen.getByText('ใบสอง')).toBeDefined()
  })

  it('บล็อกที่ยังวาดไม่ได้ถูกบอกชื่อไว้ ไม่ใช่หายไปเงียบๆ', async () => {
    const play = vi.fn(async () => ({
      bubble: {
        kind: 'card' as const,
        altText: 'x',
        card: {
          hero: null,
          parts: [{ kind: 'unknown' as const, name: 'video' }],
          buttons: [],
        },
      },
      snapshot: emptySnapshot,
    }))
    render(
      <ChatSim
        channelName="ช่อง" menu={[]} canPlay snapshot={emptySnapshot}
        play={play} reset={async () => ({ bubble: null, snapshot: emptySnapshot })}
      />,
    )
    send('เล่น')
    expect(await screen.findByText(/video/)).toBeDefined()
  })
})
