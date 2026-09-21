import type { Metadata } from 'next'
import { Montserrat, Sora, Source_Sans_3 } from 'next/font/google'

import { resolveSiteOrigin } from '@/lib/seo'

import './globals.css'

const sora = Sora({
  subsets: ['latin'],
  variable: '--font-sora',
  weight: ['100', '200', '300', '400', '500', '600', '700', '800'],
})

const montserrat = Montserrat({
  subsets: ['latin'],
  variable: '--font-montserrat',
  weight: ['400', '500', '600', '700', '800'],
})

const sourceSans3 = Source_Sans_3({
  subsets: ['latin'],
  variable: '--font-source-sans-3',
  weight: ['400', '500', '600', '700'],
})

export const metadata: Metadata = {
  metadataBase: new URL(resolveSiteOrigin()),
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon-32x32.png',
    apple: '/apple-touch-icon.png',
  },
  /**
   * Crawl defaults for every page on the site.
   *
   * Nested routes override this by declaring their own `robots`, which is how the MBTI
   * test and result pages stay `noindex` - metadata merges outward-in, so a page-level
   * value wins.
   *
   * The googleBot block is the part that actually changes what a searcher sees.
   * `max-image-preview: 'large'` is what permits a full-width thumbnail in results and in
   * Discover; without it Google renders a small one or none, which for pages whose share
   * card is a designed 1200x630 image is a real loss. `max-snippet: -1` removes the
   * default snippet length cap, letting a description run as long as Google finds useful
   * rather than being clipped at its conservative default.
   */
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  formatDetection: {
    // Stops iOS Safari wrapping bare numbers in the CV and the MBTI copy as tel: links,
    // which turns "60 câu" into a phone number.
    telephone: false,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body
        className={`${sora.variable} ${montserrat.variable} ${sourceSans3.variable} min-h-screen antialiased`}
      >
        {children}
      </body>
    </html>
  )
}
