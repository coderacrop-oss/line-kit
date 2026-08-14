import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // ตรรกะล้วนรันบน node · ไฟล์ที่วาดคอมโพเนนต์จริงขอ jsdom เองด้วย docblock
    // `@vitest-environment jsdom` ที่หัวไฟล์ · environmentMatchGlobs ทำแบบเดียวกัน
    // ได้แต่ถูกเลิกใช้ใน vitest 3.2 และเตือนทุกครั้งที่รัน
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', '.next/**'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  // tsconfig บอก jsx: "preserve" เพราะ Next แปลงเอง · vitest ไม่มี Next มาแปลงให้
  // จึงต้องสั่ง runtime ใหม่ตรงนี้ ไม่งั้นไฟล์ .tsx จะหา React ในขอบเขตไม่เจอ
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
})
