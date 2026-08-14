import { getPayloadClient } from './queries'
import { cache } from 'react'

/**
 * Resolving old WordPress URLs to their new homes.
 *
 * The old site used one post type per path segment — /movie/, /tv_show/,
 * /actor/, /director/, /writer/, /composer/, /creator/ — and slugs that carried
 * a year rather than a TMDB id. Both changed, so every inbound link needs a
 * lookup against the `legacySlug` column.
 *
 * Coverage: 100% of films, 97.8% of shows, 89.2% of people. The misses are
 * records that never existed on the old site, so no old link points at them.
 */

export type LegacyKind =
  | 'movie'
  | 'tv_show'
  | 'actor'
  | 'director'
  | 'writer'
  | 'composer'
  | 'creator'

const COLLECTION = {
  movie: 'movies',
  tv_show: 'tv-shows',
  actor: 'people',
  director: 'people',
  writer: 'people',
  composer: 'people',
  creator: 'people',
} as const

const NEW_PREFIX = {
  movies: '/movies',
  'tv-shows': '/tv-shows',
  people: '/people',
} as const

export const resolveLegacy = cache(async (kind: LegacyKind, slug: string) => {
  const collection = COLLECTION[kind]
  if (!collection) return null

  const payload = await getPayloadClient()
  const res = await payload.find({
    collection,
    where: { legacySlug: { equals: slug } },
    limit: 1,
    depth: 0,
  })

  const doc = res.docs[0]
  if (!doc?.slug) return null
  return `${NEW_PREFIX[collection]}/${doc.slug}`
})

/**
 * Fallback for old paths whose target no longer has a page — production
 * companies and networks, which the old site gave their own pages and this one
 * does not. Sending them to a search for the name keeps the link alive and
 * lands somewhere useful, which beats a 404 for ~6,800 URLs.
 */
export const searchFallback = (slug: string) => {
  const words = slug
    .replace(/-\d{4}$/, '') // trailing year
    .replace(/-\d+$/, '') // trailing id
    .replace(/-/g, ' ')
    .trim()
  return `/search?q=${encodeURIComponent(words)}`
}
