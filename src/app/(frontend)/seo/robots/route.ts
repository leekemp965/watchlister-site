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

/**
 * SEO-tooling and data-resale crawlers. They bring no traffic, and following a
 * search result for a title we do not hold costs us a TMDB import and a new
 * page — see src/proxy.ts, which refuses these at the edge because the one
 * responsible for ~6,200 unwanted films read this file and ignored it.
 *
 * Kept in step with the list in proxy.ts. This states the intent; the
 * proxy enforces it.
 */
const UNWANTED = [
  'AhrefsBot',
  'SemrushBot',
  'DotBot',
  'MJ12bot',
  'BLEXBot',
  'DataForSeoBot',
  'Barkrowler',
  'serpstatbot',
  'ZoominfoBot',
  'PetalBot',
  'Bytespider',
  'ImagesiftBot',
  'magpie-crawler',
  'SeekportBot',
  'MegaIndex',
  'LinkdexBot',
  'SPBot',
]

export function GET() {
  const body = [
    ...UNWANTED.flatMap((bot) => [`User-agent: ${bot}`, 'Disallow: /', '']),

    'User-agent: *',
    'Allow: /',
    // Search results are infinite and thin — no value in having them indexed,
    // and the links to titles we do not hold yet are the expensive ones.
    'Disallow: /search',
    'Disallow: /admin',
    'Disallow: /api/',
    // The analytics beacon. Nothing to crawl, and a GET returns 204.
    'Disallow: /collect',
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
