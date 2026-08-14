import { getPayloadClient } from './queries'

/**
 * Sitemap generation.
 *
 * Built as route handlers rather than Next's `sitemap.ts` metadata file for two
 * reasons: posts live at the site root to preserve the old WordPress
 * permalinks, so a root `[slug]` catch-all shadows root-level metadata routes;
 * and `generateSitemaps` produces the chunks but no index pointing at them.
 *
 * The catalogue is ~75,000 URLs, past the 50,000-per-file limit, so it is split
 * into chunks with an index at /sitemap.xml.
 */

export const CHUNK = 20_000
export const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://watchlister.co'

type Collection = 'movies' | 'tv-shows' | 'people'

const PREFIX: Record<Collection, string> = {
  movies: '/movies',
  'tv-shows': '/tv-shows',
  people: '/people',
}

export type Chunk = { collection: Collection; page: number } | null

/** Chunk 0 is the editorial content; the rest are catalogue slices. */
export async function planChunks(): Promise<Chunk[]> {
  const payload = await getPayloadClient()
  const collections: Collection[] = ['movies', 'tv-shows', 'people']

  const totals = await Promise.all(
    collections.map(async (collection) => ({
      collection,
      total: (await payload.count({ collection })).totalDocs,
    })),
  )

  const chunks: Chunk[] = [null]
  for (const { collection, total } of totals) {
    const pages = Math.max(1, Math.ceil(total / CHUNK))
    for (let page = 1; page <= pages; page++) chunks.push({ collection, page })
  }
  return chunks
}

type Entry = { loc: string; lastmod?: string; changefreq?: string; priority?: number }

export async function entriesFor(chunk: Chunk): Promise<Entry[]> {
  const payload = await getPayloadClient()

  if (!chunk) {
    const [pages, posts] = await Promise.all([
      payload.find({ collection: 'pages', limit: 200, depth: 0 }),
      payload.find({
        collection: 'posts',
        where: { _status: { equals: 'published' } },
        limit: 500,
        depth: 0,
      }),
    ])

    return [
      { loc: BASE, changefreq: 'daily', priority: 1 },
      { loc: `${BASE}/movies`, changefreq: 'daily', priority: 0.9 },
      { loc: `${BASE}/tv-shows`, changefreq: 'daily', priority: 0.9 },
      { loc: `${BASE}/blog`, changefreq: 'weekly', priority: 0.8 },
      // Posts sit at the root, matching the old permalink structure.
      ...posts.docs.map((p) => ({
        loc: `${BASE}/${p.slug}`,
        lastmod: p.updatedAt ?? undefined,
        changefreq: 'monthly',
        priority: 0.7,
      })),
      ...pages.docs.map((p) => ({
        loc: `${BASE}/${p.slug}`,
        lastmod: p.updatedAt ?? undefined,
        changefreq: 'yearly',
        priority: 0.4,
      })),
    ]
  }

  const res = await payload.find({
    collection: chunk.collection,
    limit: CHUNK,
    page: chunk.page,
    depth: 0,
    sort: 'id',
  })

  return res.docs
    .filter((doc) => doc.slug)
    .map((doc) => ({
      loc: `${BASE}${PREFIX[chunk.collection]}/${doc.slug}`,
      lastmod: doc.updatedAt ?? undefined,
      changefreq: 'monthly',
      // Titles matter more than the long tail of minor cast members.
      priority: chunk.collection === 'people' ? 0.3 : 0.6,
    }))
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function urlsetXml(entries: Entry[]): string {
  const body = entries
    .map((e) => {
      const parts = [`    <loc>${escape(e.loc)}</loc>`]
      if (e.lastmod) parts.push(`    <lastmod>${new Date(e.lastmod).toISOString()}</lastmod>`)
      if (e.changefreq) parts.push(`    <changefreq>${e.changefreq}</changefreq>`)
      if (e.priority !== undefined) parts.push(`    <priority>${e.priority}</priority>`)
      return `  <url>\n${parts.join('\n')}\n  </url>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
}

export function xmlResponse(xml: string) {
  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  })
}
