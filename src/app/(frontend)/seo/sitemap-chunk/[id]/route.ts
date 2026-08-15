import { notFound } from 'next/navigation'
import { planChunks, entriesFor, urlsetXml, xmlResponse } from '@/lib/sitemap'

/**
 * One sitemap chunk. Reached via a rewrite from /sitemap/{n}.xml.
 *
 * force-dynamic because the response depends entirely on the id: with ISR
 * caching enabled, every chunk was served the same cached body — chunk 0's
 * 30 editorial URLs — regardless of which one was requested.
 */
export const dynamic = 'force-dynamic'

/**
 * The people chunks are 20,000 rows each, which is well past the 10-second
 * default a serverless function gets. 60s is the ceiling on Vercel's Hobby
 * plan and comfortably enough.
 */
export const maxDuration = 60

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const index = Number(id)
  if (!Number.isInteger(index) || index < 0) notFound()

  const chunks = await planChunks()
  if (index >= chunks.length) notFound()

  return xmlResponse(urlsetXml(await entriesFor(chunks[index])))
}
