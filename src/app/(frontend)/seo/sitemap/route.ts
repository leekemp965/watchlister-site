import { planChunks, BASE, xmlResponse } from '@/lib/sitemap'

/** The sitemap index. Reached via a rewrite from /sitemap.xml. */
export const revalidate = 86400

export async function GET() {
  const chunks = await planChunks()
  const now = new Date().toISOString()

  const body = chunks
    .map(
      (_, i) =>
        `  <sitemap>\n    <loc>${BASE}/sitemap/${i}.xml</loc>\n    <lastmod>${now}</lastmod>\n  </sitemap>`,
    )
    .join('\n')

  return xmlResponse(
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`,
  )
}
