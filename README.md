# 🥠 LINE Fortune Cookie

เกมคุกกี้เสี่ยงทายใน LINE Official Account เล่นจบในหน้าแชท
ผู้ใช้ได้ตารางคุกกี้ 3×3 แตะเลือก 1 ชิ้น แล้วได้คำทำนายที่ผูกกับชิ้นนั้น

- **ไม่มี database** — คำทำนายทั้ง 9 ใบถูกฝัง id ไว้ในปุ่มตอนสร้างการ์ด
- **ฟรีทั้งหมด** — Vercel Hobby + LINE reply message (ซึ่ง LINE ไม่คิดเงิน)
- **ไม่ใช้ Push API** ทุกการตอบกลับใช้ `replyToken` เท่านั้น

## เริ่มพัฒนา

```bash
npm install
npm test          # รันเทสต์ทั้งหมด ไม่ต้องต่อเน็ต ไม่ต้องมี LINE account
npm run typecheck
npm run dev       # เปิด http://localhost:3000
```

ตรรกะเกมทั้งหมดเป็น pure function เทสต์ครอบคลุมโดยไม่ต้องยิง LINE จริง
ดังนั้นแก้คำทำนายหรือหน้าตาการ์ดแล้วรัน `npm test` ได้ทันที

## ตั้งค่า LINE OA ตั้งแต่ต้น

1. สร้าง **LINE Official Account** ที่ [LINE Official Account Manager](https://manager.line.biz/) (ฟรี)
2. ไปที่ [LINE Developers Console](https://developers.line.biz/console/)
   สร้าง provider แล้วสร้าง **Messaging API channel** เชื่อมกับ OA ที่เพิ่งสร้าง
3. เก็บค่าสองตัวนี้ไว้
   - **Channel secret** — แท็บ *Basic settings*
   - **Channel access token** (long-lived) — แท็บ *Messaging API* กด Issue
4. ในแท็บ *Messaging API* — **ปิด** "Auto-reply messages" และ "Greeting messages"
   ถ้าไม่ปิด บอทอัตโนมัติของ LINE จะตอบทับข้อความของเกม
5. ใส่ค่าลง `.env.local` (ดูรูปแบบใน `.env.example`) — ไฟล์นี้ถูก gitignore ไว้แล้ว
   **ห้าม commit ค่าจริงลง repo** ใครได้ token ไปก็ส่งข้อความในนาม OA ของคุณได้

## Deploy ขึ้น Vercel

1. Import repo นี้เข้า [Vercel](https://vercel.com/new) เลือกแผน **Hobby** (ฟรี)
2. ใส่ environment variable สองตัว: `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`
3. Deploy แล้วเปิด `https://<app>.vercel.app/` ให้เห็นหน้า "Bot is running" ก่อน
   ถ้าหน้านี้ยังไม่ขึ้น ปัญหาอยู่ที่ deploy ไม่ใช่ที่ webhook
4. กลับไปที่ LINE Developers Console แท็บ *Messaging API*
   - ตั้ง **Webhook URL** เป็น `https://<app>.vercel.app/api/line/webhook`
   - กด **Verify** ต้องขึ้น Success
   - เปิดสวิตช์ **Use webhook**
5. แอด OA เป็นเพื่อนจาก QR code ในแท็บ *Messaging API* แล้วพิมพ์ว่า `เสี่ยงทาย`

ตอนพัฒนา ใช้ **preview deployment** ของ Vercel เป็น webhook URL ได้เลย (ฟรี อยู่ในบัญชีเดียวกัน)
ไม่ต้องพึ่ง ngrok ซึ่งแผนฟรีมีข้อจำกัด

## วิธีเล่น

| ผู้ใช้ทำอะไร | บอทตอบอะไร |
|---|---|
| แอดเป็นเพื่อน | การ์ดต้อนรับ + ปุ่มเริ่มเล่น |
| พิมพ์ `เสี่ยงทาย` `เสี่ยงโชค` `คุกกี้` `ดวง` `เล่น` `fortune` | ตารางคุกกี้ 3×3 |
| แตะคุกกี้ 1 ชิ้น | คำทำนายของชิ้นนั้น + ปุ่มเสี่ยงใหม่ |
| พิมพ์อย่างอื่น | การ์ดใบ้วิธีเล่น + ปุ่มเริ่มเล่น |

การ์ดตารางเก่าที่ค้างอยู่ในแชทยังกดได้เสมอ เพราะระบบไม่มีสถานะให้หมดอายุ

## แก้คำทำนาย

แก้ที่ `lib/game/fortunes.ts` — **`id` ที่ปล่อยไปแล้วห้ามเปลี่ยนหรือนำกลับมาใช้ซ้ำ**
เพราะการ์ดตารางที่ส่งไปหาผู้ใช้แล้วอ้างอิง id เดิมอยู่ ถ้าเปลี่ยน คุกกี้ใบเดิมจะเปลี่ยนคำทำนาย
เพิ่มใบใหม่ให้ใช้ id ถัดจากตัวที่มากที่สุด และรัน `npm test` เพื่อยืนยันว่ายังครบโทนละ 20 ใบ

## โครงสร้าง

```
app/api/line/webhook/route.ts   จุดรับ webhook — ตรวจลายเซ็นแล้วส่งต่อ
lib/game/fortunes.ts            คลังคำทำนาย 60 ใบ
lib/game/draw.ts                สุ่ม 9 ใบ โทนละ 3
lib/game/postback.ts            เข้ารหัส/ถอดรหัส postback
lib/game/handler.ts             event → ข้อความที่จะตอบ (pure)
lib/flex/                       ตัวสร้างการ์ด Flex ทั้งหมด (pure)
lib/line/verify.ts              ตรวจ x-line-signature
lib/line/client.ts              เรียก Reply API (จุดเดียวที่ออกเน็ต)
```

เอกสารออกแบบอยู่ที่ `docs/superpowers/specs/2026-08-07-line-fortune-cookie-design.md`
