import type { ReactNode } from 'react'

export const metadata = {
  title: 'LINE Fortune Cookie',
  description: 'LINE OA fortune cookie game',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  )
}
