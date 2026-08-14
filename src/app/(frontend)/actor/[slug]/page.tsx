import { permanentRedirect } from 'next/navigation'
import { resolveLegacy, searchFallback } from '@/lib/legacy'

/**
 * Legacy WordPress URL: /actor/{slug}
 * Permanently redirects to the record's new home, or to a search for the name
 * when the record did not survive the migration.
 */
export default async function LegacyRedirect({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const target = await resolveLegacy('actor', slug)
  permanentRedirect(target ?? searchFallback(slug))
}
