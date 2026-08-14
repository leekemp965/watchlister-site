import { permanentRedirect } from 'next/navigation'
import { searchFallback } from '@/lib/legacy'

/**
 * Legacy WordPress URL: /country/{slug}
 * The new site has no page for these, so the link is kept alive by searching
 * for the name rather than 404ing.
 */
export default async function LegacyRedirect({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  permanentRedirect(searchFallback(slug))
}
