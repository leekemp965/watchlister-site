import type { Metadata, Viewport } from 'next'
import { Poppins } from 'next/font/google'
import { SiteHeader } from '@/components/SiteHeader'
import { SiteFooter } from '@/components/SiteFooter'
import { Analytics } from '@/components/Analytics'
import './globals.css'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://watchlister.co'),
  title: {
    default: 'Watchlister',
    template: '%s · Watchlister',
  },
  description:
    'If you have watched a film and then wanted to know everything about it, Watchlister is for you.',
  icons: {
    icon: [
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
}

/** themeColor belongs in the viewport export, not metadata, since Next 14. */
export const viewport: Viewport = {
  themeColor: '#030712',
}

export default function FrontendLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${poppins.variable} scroll-smooth`}>
      <body className="bg-gray-950 text-white antialiased">
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter />
        <Analytics />
      </body>
    </html>
  )
}
