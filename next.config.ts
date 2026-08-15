import type { NextConfig } from 'next'
import { withPayload } from '@payloadcms/next/withPayload'
import legacyRedirects from './data/legacy-redirects.json'

/**
 * Redirects fall into three groups:
 *
 *  1. The 324 rules the old site accumulated in its Redirection plugin —
 *     mostly dated permalinks (/2023/10/28/some-post/) from before it moved to
 *     a flat structure. Real inbound links, extracted from the dump.
 *  2. Archive paths whose name changed (/tv_shows → /tv-shows).
 *  3. Per-record redirects (/movie/dune-2021 → /movies/dune-438631), which
 *     cannot live here because they need a database lookup — those are route
 *     handlers under src/app/(frontend)/movie/[slug] and friends.
 */
const nextConfig: NextConfig = {
  images: {
    // TMDB artwork is served from their CDN rather than copied locally — this
    // is what replaces the old site's 1.1 GB uploads directory.
    remotePatterns: [{ protocol: 'https', hostname: 'image.tmdb.org', pathname: '/t/p/**' }],
  },

  /**
   * robots.txt and the sitemaps are served by route handlers under /seo, and
   * reached through these rewrites.
   *
   * Why not just use Next's `robots.ts` / `sitemap.ts` metadata files: posts
   * live at the site root to preserve the old WordPress permalinks, so a
   * `[slug]` catch-all owns every single-segment path. With the metadata files
   * at the app root, requests for /robots.txt were observed resolving into that
   * catch-all and 404ing. Rewrites are resolved before routing, so the
   * catch-all never sees these URLs.
   *
   * Caveat worth knowing if you revisit this: some of the debugging behind that
   * conclusion was done against a stale `next-server` process, so the plain
   * metadata-file approach may in fact work. This setup is verified working;
   * the simpler one is untested. Do not remove without re-testing
   * /robots.txt, /sitemap.xml and /sitemap/1.xml against a freshly started
   * server.
   */
  /**
   * Security headers. Vercel sets HSTS; everything else was missing.
   *
   * No Content-Security-Policy yet: the site loads YouTube and Vimeo iframes,
   * TMDB images, R2 media and Google Tag Manager, and GTM in particular is
   * hostile to a strict policy because its whole purpose is injecting scripts
   * decided elsewhere. A policy loose enough to accommodate it buys little, and
   * a tight one would break analytics silently. Worth revisiting if GTM ever
   * goes.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Stop the site being framed — clickjacking.
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // Stop browsers second-guessing declared content types.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Send the origin to other sites, the full path only to our own.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Nothing here needs these.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ]
  },

  async rewrites() {
    return [
      { source: '/robots.txt', destination: '/seo/robots' },
      { source: '/sitemap.xml', destination: '/seo/sitemap' },
      { source: '/sitemap/:id.xml', destination: '/seo/sitemap-chunk/:id' },
    ]
  },

  async redirects() {
    const archives = [
      // The old CPT archive slugs used underscores; the new routes use hyphens.
      { source: '/tv_shows', destination: '/tv-shows', permanent: true },
      // No dedicated index for these on the new site, so send them somewhere useful.
      { source: '/actors', destination: '/search', permanent: true },
      { source: '/directors', destination: '/search', permanent: true },
      { source: '/writers', destination: '/search', permanent: true },
      { source: '/composers', destination: '/search', permanent: true },
      { source: '/creators', destination: '/search', permanent: true },
      { source: '/production_companies', destination: '/search', permanent: true },
      { source: '/networks', destination: '/search', permanent: true },
      // WordPress leftovers that should never have been public.
      { source: '/wp-admin/:path*', destination: '/', permanent: true },
      { source: '/wp-login.php', destination: '/admin', permanent: true },
      { source: '/feed', destination: '/blog', permanent: true },
      { source: '/sitemap_index.xml', destination: '/sitemap.xml', permanent: true },
    ]

    const fromOldSite = (legacyRedirects as Array<{
      source: string
      destination: string
      permanent: boolean
    }>).map(({ source, destination, permanent }) => ({ source, destination, permanent }))

    // Archive rules win where both define the same source.
    const claimed = new Set(archives.map((r) => r.source))
    return [...archives, ...fromOldSite.filter((r) => !claimed.has(r.source))]
  },
}

export default withPayload(nextConfig)
