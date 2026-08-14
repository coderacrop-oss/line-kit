# Flex System Builder

แพลตฟอร์มตั้งค่ากิจกรรมบน LINE Official Account **โดยไม่ต้อง deploy**
กติกาทั้งหมดอยู่ในฐานข้อมูล ไม่ได้อยู่ในโค้ด

- **ตอบกลับอัตโนมัติ · ทักทายเพื่อนใหม่ · การ์ดเมสเสจ** — สไลซ์แรก
- **เครื่องยนต์ตัดสินผล** — สุ่มรางวัลตามน้ำหนัก คิดคะแนน ตัดโควตาถูกต้องเมื่อคนกดพร้อมกัน
- **ไม่ใช้ Push API** ทุกการตอบกลับใช้ `replyToken` เท่านั้น (BR-02)

เอกสารออกแบบ `docs/superpowers/specs/2026-08-14-flex-system-builder-slice1-design.md`
แผนลงมือ `docs/superpowers/plans/2026-08-14-flex-slice1-core.md`

## เริ่มพัฒนา

```bash
npm install
npm test          # ชั้น unit — ไม่ต้องต่อเน็ต ไม่ต้องมีฐานข้อมูล
npm run typecheck
npm run dev
```

ตรรกะทั้งหมดใน `lib/engine/` และ `lib/render/` เป็น pure function
**มีเทสต์บังคับไว้ว่าสองโฟลเดอร์นี้ห้ามแตะฐานข้อมูล เน็ต หรือ framework**

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

## โครงสร้าง

```
app/api/line/webhook/route.ts   จุดรับ webhook — ตรวจลายเซ็นแล้วส่งต่อ
lib/engine/                     ตัดสินผล (pure) — entry · resolve · effects · decide
lib/render/                     วาดการ์ด (pure) — groups · vars · flex · text
lib/match/                      จับคู่คีย์เวิร์ดและถอด postback (pure)
lib/state.ts                    PlayerState + ตัวประเมินเงื่อนไข (pure)
lib/daykey.ts                   คำนวณ period_key (pure)
lib/line/verify.ts              ตรวจ x-line-signature
lib/line/client.ts              เรียก Reply API (จุดเดียวที่ออกเน็ต)
scripts/probe-line-limits.mjs   วัดข้อจำกัดจริงของ LINE — ดูหัวข้อถัดไป
```

## วัดข้อจำกัดจริงของ LINE (OI-03)

เอกสาร A&D ตั้ง OI-03 เป็น Blocker ไว้ตั้งแต่ v0.1 เพราะ **LINE ไม่ระบุอายุของ
reply token ไว้ที่ไหน** และเอกสารบอกเองว่าต้องวัดเอง · ถ้าสั้นกว่าที่เดาไว้
จะต้องเลิกใช้ serverless ซึ่งกระทบการออกแบบทั้งหมด

```bash
export LINE_CHANNEL_SECRET=...        # บัญชีทดสอบเท่านั้น
export LINE_CHANNEL_ACCESS_TOKEN=...
node scripts/probe-line-limits.mjs

# อีกหน้าต่าง — เปิดพอร์ตให้ LINE เข้าถึงได้
cloudflared tunnel --url http://localhost:8787
```

เอา URL ที่ได้ไปตั้งเป็น webhook ของ**บัญชีทดสอบ** แล้วพิมพ์คุยกับ OA:

| พิมพ์ | ได้อะไร |
|---|---|
| `help` | รายการคำสั่ง |
| `t 30` | หน่วง 30 วินาทีแล้วลองตอบ — token ยังใช้ได้ไหม |
| `flex` | ไล่หาเพดานขนาด Flex (ต้องตั้ง `PROBE_ALLOW_PUSH=1` เพราะใช้ push) |

ไล่ตามบันได `t 5` → `t 15` → `t 30` → … ทีละครั้ง เพราะ **reply token ใช้ได้
ครั้งเดียว** จึงต้องพิมพ์หนึ่งครั้งต่อหนึ่งค่า · ผลลงที่ `docs/probes/`

สคริปต์รันในเครื่องไม่ใช่บน Vercel โดยเจตนา เพราะการวัดต้องค้าง request ไว้ได้
นานถึงสองนาที ซึ่งไม่มี serverless timeout ไหนยอม

