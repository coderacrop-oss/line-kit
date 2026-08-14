// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Badge, Button, Empty, Field, PageHead, Panel, Rows } from './index'
import { STATUS_TONES } from './tokens'

// vitest ไม่ได้เปิด globals ไว้ RTL จึงเก็บกวาดเองอัตโนมัติไม่ได้
// ถ้าไม่เรียก cleanup เอง จอของเทสต์ก่อนหน้าจะค้างและ getBy* จะเจอสองตัว
afterEach(cleanup)

const css = readFileSync('app/globals.css', 'utf8')

// jsdom เขียนสีกลับมาเป็น rgb() เสมอ · ส่ง token ผ่านตัวแปลตัวเดียวกันก่อนเทียบ
// จะได้เทียบกับค่าใน STATUS_TONES ได้ตรงๆ แทนที่จะพิมพ์ rgb() ซ้ำไว้ในเทสต์
const asCss = (color: string): string => {
  const probe = document.createElement('span')
  probe.style.color = color
  return probe.style.color
}

describe('PageHead', () => {
  it('แสดงรหัสจอและหัวข้อ', () => {
    render(<PageHead code="M1-S01 · Campaigns" title="แคมเปญ" />)
    expect(screen.getByText('M1-S01 · Campaigns')).toBeDefined()
    expect(screen.getByText('แคมเปญ')).toBeDefined()
  })

  it('หัวข้อเป็นหัวเรื่องระดับหนึ่ง ไม่ใช่ div ที่ตัวโตกว่าเพื่อน', () => {
    render(<PageHead code="M6-S01 · LINE Channels" title="บัญชี LINE" />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('บัญชี LINE')
  })

  it('รหัสจอไม่ถูกอ่านซ้ำเป็นส่วนหนึ่งของหัวข้อ', () => {
    render(<PageHead code="M7-S01 · Activities" title="กิจกรรม" />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toContain('M7-S01')
  })

  it('ปุ่มของหน้าอยู่ในหัวเดียวกัน ไม่ต้องให้แต่ละจอวางเอง', () => {
    render(<PageHead code="M1-S01 · Campaigns" title="แคมเปญ" actions={<Button>สร้าง</Button>} />)
    expect(screen.getByRole('button', { name: 'สร้าง' })).toBeDefined()
  })

  it('ไม่มี actions ก็ไม่มีกล่องเปล่าค้างไว้', () => {
    const { container } = render(<PageHead code="M9-S01 · Assets" title="คลังภาพ" />)
    expect(container.querySelectorAll('button').length).toBe(0)
  })
})

describe('Button', () => {
  it('ปุ่มหลักใช้พื้นเข้ม ปุ่มรองใช้พื้นขาว', () => {
    const { container } = render(<><Button>หลัก</Button><Button variant="ghost">รอง</Button></>)
    const [primary, ghost] = Array.from(container.querySelectorAll('button'))
    expect(primary!.style.background).toContain('--ink')
    expect(ghost!.style.background).toContain('--panel')
  })

  it('ปิดปุ่มแล้วกดไม่ได้และมองออกว่าปิด', () => {
    const { container } = render(<Button disabled>รอ</Button>)
    const button = container.querySelector('button')!
    expect(button.disabled).toBe(true)
    expect(Number(button.style.opacity)).toBeLessThan(1)
  })

  it('ปุ่มที่ปิดอยู่ไม่ยิง onClick แม้จะมีคนกด', () => {
    const onClick = vi.fn()
    render(<Button disabled onClick={onClick}>ลบ</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'ลบ' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('ปุ่มอันตรายใช้สีตัวอักษรของ danger ไม่ใช่สีเน้นซึ่งเป็นสีเดียวกับเส้นขอบ', () => {
    const { container } = render(<Button variant="danger">ลบถาวร</Button>)
    const style = container.querySelector('button')!.style
    expect(style.color).toBe(asCss(STATUS_TONES.danger.fg))
    expect(style.color).not.toBe(asCss(STATUS_TONES.danger.border))
  })

  it('ทุกแบบใช้รัศมีเดียวกันจาก token', () => {
    const { container } = render(
      <><Button>ก</Button><Button variant="ghost">ข</Button><Button variant="danger">ค</Button></>,
    )
    for (const button of Array.from(container.querySelectorAll('button'))) {
      expect(button.style.borderRadius).toBe('var(--r)')
    }
  })

  it('ค่าเริ่มต้นคือ type="button" — ปุ่มในฟอร์มต้องขอ submit เอง', () => {
    render(<><Button>ยกเลิก</Button><Button type="submit">บันทึก</Button></>)
    expect(screen.getByRole('button', { name: 'ยกเลิก' }).getAttribute('type')).toBe('button')
    expect(screen.getByRole('button', { name: 'บันทึก' }).getAttribute('type')).toBe('submit')
  })

  it('ส่งต่อ prop ของปุ่มจริง เช่น name กับ title', () => {
    render(<Button name="action" value="publish" title="ส่งขึ้น LINE">ส่ง</Button>)
    const button = screen.getByRole('button', { name: 'ส่ง' }) as HTMLButtonElement
    expect(button.name).toBe('action')
    expect(button.value).toBe('publish')
    expect(button.title).toBe('ส่งขึ้น LINE')
  })
})

describe('Field', () => {
  it('ป้ายผูกกับ input ด้วย id เดียวกัน', () => {
    render(<Field label="ชื่อแคมเปญ"><input /></Field>)
    const input = screen.getByLabelText('ชื่อแคมเปญ')
    expect(input).toBeDefined()
  })

  it('มี error แล้วบอกด้วย aria-invalid ไม่ใช่แค่เปลี่ยนสี', () => {
    render(<Field label="รหัส" error="ใช้ได้แค่ a-z"><input /></Field>)
    expect(screen.getByLabelText('รหัส').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('ใช้ได้แค่ a-z')).toBeDefined()
  })

  it('ไม่มี error ก็ไม่ประกาศว่าผิด', () => {
    render(<Field label="รหัส"><input /></Field>)
    expect(screen.getByLabelText('รหัส').getAttribute('aria-invalid')).toBeNull()
  })

  it('ข้อความ error ถูกโยงเข้ากับช่องด้วย aria-describedby ไม่ใช่แค่วางไว้ข้างๆ', () => {
    render(<Field label="รหัส" error="ใช้ได้แค่ a-z"><input /></Field>)
    const input = screen.getByLabelText('รหัส')
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
    const described = ids.map((id) => document.getElementById(id)?.textContent)
    expect(described).toContain('ใช้ได้แค่ a-z')
  })

  it('คำอธิบายก็ถูกโยงด้วย และอยู่ร่วมกับ error ได้ทั้งคู่', () => {
    render(<Field label="รหัส" hint="แนบไปกับปุ่มของการ์ด" error="ห้ามเว้นว่าง"><input /></Field>)
    const input = screen.getByLabelText('รหัส')
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
    const described = ids.map((id) => document.getElementById(id)?.textContent)
    expect(described).toContain('แนบไปกับปุ่มของการ์ด')
    expect(described).toContain('ห้ามเว้นว่าง')
  })

  it('ช่องที่ผิดเปลี่ยนเส้นขอบเป็นสี danger ด้วย ไม่ได้พึ่ง aria อย่างเดียว', () => {
    render(<Field label="รหัส" error="ห้ามเว้นว่าง"><input /></Field>)
    expect((screen.getByLabelText('รหัส') as HTMLInputElement).style.border).toContain('--danger')
  })

  it('สองช่องในหน้าเดียวกันไม่ใช้ id ชนกัน', () => {
    render(<><Field label="ชื่อ"><input /></Field><Field label="รหัส"><input /></Field></>)
    const a = screen.getByLabelText('ชื่อ')
    const b = screen.getByLabelText('รหัส')
    expect(a.id).not.toBe('')
    expect(a.id).not.toBe(b.id)
  })

  it('ป้ายซ้ำกันได้ถ้าใส่ id เอง — id ที่ให้มาชนะตัวที่คิดจากป้าย', () => {
    render(
      <>
        <Field label="ชื่อ" id="th"><input /></Field>
        <Field label="ชื่อ" id="en"><input /></Field>
      </>,
    )
    expect(screen.getAllByLabelText('ชื่อ').map((el) => el.id)).toEqual(['th', 'en'])
  })

  it('ไม่กลืน prop ของช่องที่ส่งเข้ามา', () => {
    render(<Field label="ชื่อ"><input name="name" defaultValue="ครบเจ็ด" required /></Field>)
    const input = screen.getByLabelText('ชื่อ') as HTMLInputElement
    expect(input.name).toBe('name')
    expect(input.value).toBe('ครบเจ็ด')
    expect(input.required).toBe(true)
  })

  it('ครอบ select และ textarea ได้ ไม่ใช่แค่ input', () => {
    render(
      <>
        <Field label="เขตเวลา"><select><option value="th">ไทย</option></select></Field>
        <Field label="ข้อความ"><textarea /></Field>
      </>,
    )
    expect(screen.getByLabelText('เขตเวลา').tagName).toBe('SELECT')
    expect(screen.getByLabelText('ข้อความ').tagName).toBe('TEXTAREA')
  })
})

describe('Badge', () => {
  it('แต่ละโทนมีสีตัวอักษรของตัวเอง', () => {
    const { container } = render(<><Badge tone="ok">เปิด</Badge><Badge tone="danger">พัง</Badge></>)
    const [ok, danger] = Array.from(container.querySelectorAll('span'))
    expect(ok!.style.color).not.toBe(danger!.style.color)
  })

  it('ทั้งสี่โทนใช้สีจาก STATUS_TONES ไม่ใช่สีที่พิมพ์ไว้ในคอมโพเนนต์', () => {
    for (const tone of ['ok', 'warn', 'danger', 'info'] as const) {
      cleanup()
      const { container } = render(<Badge tone={tone}>ป้าย</Badge>)
      const style = container.querySelector('span')!.style
      expect(style.color, tone).toBe(asCss(STATUS_TONES[tone].fg))
      expect(style.borderColor, tone).toBe(asCss(STATUS_TONES[tone].border))
    }
  })

  it('โทน mute เป็นเส้นประ จึงแยกออกจากสถานะจริงได้แม้มองไม่เห็นสี', () => {
    const { container } = render(<Badge tone="mute">ดูอย่างเดียว</Badge>)
    const style = container.querySelector('span')!.style
    expect(style.borderStyle).toBe('dashed')
    expect(style.color).toBe('var(--ink-3)')
  })

  it('สถานะจริงไม่ใช้เส้นประ ไม่งั้นจะสับสนกับ mute', () => {
    const { container } = render(<Badge tone="ok">เปิดอยู่</Badge>)
    expect(container.querySelector('span')!.style.borderStyle).toBe('solid')
  })

  it('ป้ายเป็น span เดี่ยว วางในบรรทัดเดียวกับข้อความอื่นได้', () => {
    const { container } = render(<Badge tone="info">ร่าง</Badge>)
    expect(container.querySelectorAll('span').length).toBe(1)
    expect(container.querySelector('span')!.textContent).toBe('ร่าง')
  })
})

describe('Panel', () => {
  it('ใช้รัศมีของแผงและเส้นขอบจาก token', () => {
    const { container } = render(<Panel><Panel.Row>แถว</Panel.Row></Panel>)
    const panel = container.firstElementChild as HTMLElement
    expect(panel.style.borderRadius).toBe('var(--r-lg)')
    expect(panel.style.border).toContain('--rule')
    expect(panel.style.background).toBe('var(--panel)')
  })

  it('ตัดมุมให้แถวแรกและแถวสุดท้ายไม่ล้นออกนอกแผง', () => {
    const { container } = render(<Panel><Panel.Row>แถว</Panel.Row></Panel>)
    expect((container.firstElementChild as HTMLElement).style.overflow).toBe('hidden')
  })

  it('เส้นคั่นของแถวมาจาก stylesheet และแถวสุดท้ายถูกยกเว้น', () => {
    const { container } = render(<Panel><Panel.Row>ก</Panel.Row><Panel.Row>ข</Panel.Row></Panel>)
    for (const row of Array.from(container.querySelectorAll('.panel-row'))) {
      expect(row.className).toContain('panel-row')
    }
    // jsdom ไม่ได้โหลด globals.css จึงตรวจที่ตัวกฎว่ายังอยู่
    // ถ้ากฎนี้หาย แผงจะมีเส้นขอบล่างซ้อนกับขอบของแผงเอง
    expect(css).toMatch(/\.panel-row:last-child\s*\{[^}]*border-bottom:\s*0/)
  })

  it('ส่งต่อ prop ของ div ให้แถว เช่น onClick กับ data-*', () => {
    const onClick = vi.fn()
    const { container } = render(<Panel><Panel.Row onClick={onClick} data-row="1">ก</Panel.Row></Panel>)
    const row = container.querySelector('[data-row="1"]')!
    fireEvent.click(row)
    expect(onClick).toHaveBeenCalledOnce()
  })
})

describe('Rows', () => {
  it('กำลังโหลดแสดง skeleton ตามจำนวนที่บอก', () => {
    const { container } = render(<Rows items={[]} loading={3} renderRow={() => null} />)
    expect(container.querySelectorAll('[data-skeleton]').length).toBe(3)
  })

  it('ไม่มีข้อมูลแสดงกล่องว่าง ไม่ใช่แผงเปล่า', () => {
    render(<Rows items={[]} renderRow={() => null} empty={<Empty title="ยังไม่มีแคมเปญ" />} />)
    expect(screen.getByText('ยังไม่มีแคมเปญ')).toBeDefined()
  })

  it('มีข้อมูลแล้ววาดทุกแถว', () => {
    render(<Rows items={['a', 'b']} renderRow={(x) => <div key={x}>{x}</div>} />)
    expect(screen.getByText('a')).toBeDefined()
    expect(screen.getByText('b')).toBeDefined()
  })

  it('กำลังโหลดต้องไม่โผล่กล่องว่างแวบหนึ่งก่อน', () => {
    render(<Rows items={[]} loading={4} renderRow={() => null} empty={<Empty title="ยังไม่มีแคมเปญ" />} />)
    expect(screen.queryByText('ยังไม่มีแคมเปญ')).toBeNull()
  })

  it('กำลังโหลดประกาศด้วย aria-busy ไม่ใช่แค่แถบเทา', () => {
    const { container } = render(<Rows items={[]} loading={2} renderRow={() => null} />)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('โครงร่างระหว่างโหลดไม่ถูกอ่านออกเสียง', () => {
    const { container } = render(<Rows items={[]} loading={2} renderRow={() => null} />)
    for (const skeleton of Array.from(container.querySelectorAll('[data-skeleton]'))) {
      expect(skeleton.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('loading เป็นศูนย์ไม่ใช่กำลังโหลด', () => {
    render(<Rows items={[]} loading={0} renderRow={() => null} empty={<Empty title="ยังไม่มีแคมเปญ" />} />)
    expect(screen.getByText('ยังไม่มีแคมเปญ')).toBeDefined()
  })

  it('มีข้อมูลแล้วไม่แสดงกล่องว่างค้างไว้', () => {
    render(<Rows items={['a']} renderRow={(x) => <div key={x}>{x}</div>} empty={<Empty title="ยังไม่มีแคมเปญ" />} />)
    expect(screen.queryByText('ยังไม่มีแคมเปญ')).toBeNull()
  })

  it('ไม่มีข้อมูลและไม่ได้บอกว่าจะแสดงอะไร ก็ไม่วาดแผงเปล่า', () => {
    const { container } = render(<Rows items={[]} renderRow={() => null} />)
    expect(container.innerHTML).toBe('')
  })

  it('บอกลำดับของแถวให้ renderRow ใช้ได้', () => {
    render(<Rows items={['ก', 'ข']} renderRow={(x, i) => <div key={x}>{`${i}:${x}`}</div>} />)
    expect(screen.getByText('0:ก')).toBeDefined()
    expect(screen.getByText('1:ข')).toBeDefined()
  })
})

describe('Empty', () => {
  it('แสดงหัวข้อ คำอธิบาย และปุ่มที่ให้มา', () => {
    render(<Empty title="ยังไม่มีการ์ด" note="สร้างใบแรกได้เลย" action={<Button>สร้างการ์ด</Button>} />)
    expect(screen.getByText('ยังไม่มีการ์ด')).toBeDefined()
    expect(screen.getByText('สร้างใบแรกได้เลย')).toBeDefined()
    expect(screen.getByRole('button', { name: 'สร้างการ์ด' })).toBeDefined()
  })

  it('มีแค่หัวข้อก็ได้ ไม่บังคับให้ต้องคิดคำอธิบาย', () => {
    const { container } = render(<Empty title="ยังไม่มีการ์ด" />)
    expect(container.textContent).toBe('ยังไม่มีการ์ด')
  })

  it('เป็นกล่องเส้นประ จึงต่างจากแผงที่มีของอยู่จริง', () => {
    const { container } = render(<Empty title="ยังไม่มีการ์ด" />)
    const box = container.firstElementChild as HTMLElement
    expect(box.style.borderStyle).toBe('dashed')
    expect(box.style.borderRadius).toBe('var(--r-lg)')
  })
})

describe('ทุกคอมโพเนนต์ไม่มีค่าสีเขียนตรงในไฟล์', () => {
  // สีเดียวที่อนุญาตให้เป็นตัวเลขคือใน tokens.ts ซึ่งเป็นที่ที่มันควรอยู่
  it('ไม่มี hex ในไฟล์คอมโพเนนต์', () => {
    for (const file of ['Badge', 'Button', 'Empty', 'Field', 'PageHead', 'Panel', 'Rows']) {
      const source = readFileSync(`components/ui/${file}.tsx`, 'utf8')
      expect(source.match(/#[0-9A-Fa-f]{3,8}\b/g), file).toBeNull()
    }
  })
})
