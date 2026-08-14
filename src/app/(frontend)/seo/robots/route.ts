import { BASE } from '@/lib/sitemap'

/**
 * Reached via a rewrite from /robots.txt (see next.config.ts).
 *
 * It cannot live at /robots.txt directly: posts sit at the site root to
 * preserve the old WordPress permalinks, so there is a `[slug]` catch-all
 * there, and it swallows single-segment routes — including Next's own
 * `robots.ts` metadata file, which 404s silently. Rewrites run before routing,
 * so the catch-all never sees these paths.
 */

export const dynamic = 'force-static'
export const revalidate = 86400

export function GET() {
  const body = [
    'User-agent: *',
    'Allow: /',
    // Search results are infinite and thin — no value in having them indexed.
    'Disallow: /search',
    'Disallow: /admin',
    'Disallow: /api/',
    '',
    `Sitemap: ${BASE}/sitemap.xml`,
    '',
  ].join('\n')

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  })
}
