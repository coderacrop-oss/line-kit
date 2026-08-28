import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // ตรรกะล้วนรันบน node · ไฟล์ที่วาดคอมโพเนนต์จริงขอ jsdom เองด้วย docblock
    // `@vitest-environment jsdom` ที่หัวไฟล์ · environmentMatchGlobs ทำแบบเดียวกัน
    // ได้แต่ถูกเลิกใช้ใน vitest 3.2 และเตือนทุกครั้งที่รัน
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    // .claude/worktrees เก็บสำเนารีโปเต็มของ agent ที่ทำงานขนานกัน
    // ไม่กันไว้แล้วเทสต์ของทุก worktree จะถูกกวาดมารันพร้อมกัน ยิงฐานข้อมูล
    // เดียวกัน แล้วแดงเป็นร้อยโดยที่โค้ดไม่ได้พังเลย
    // liff-template/ เป็นโปรเจกต์ของตัวเอง ไม่ npm install ในรีโปนี้ตามปกติ แต่กันไว้เผื่อ
    // ใครติดตั้งเพื่อ dev เทมเพลตนั้นตรงๆ — ไม่งั้น node_modules/.next ของมันจะถูกกวาดมาด้วย
    exclude: ['node_modules/**', '.next/**', '.claude/**', 'liff-template/node_modules/**', 'liff-template/.next/**'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  // tsconfig บอก jsx: "preserve" เพราะ Next แปลงเอง · vitest ไม่มี Next มาแปลงให้
  // จึงต้องสั่ง runtime ใหม่ตรงนี้ ไม่งั้นไฟล์ .tsx จะหา React ในขอบเขตไม่เจอ
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
})
