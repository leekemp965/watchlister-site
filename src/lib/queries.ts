import { getPayload } from 'payload'
import config from '@payload-config'
import { cache } from 'react'

/**
 * Server-side data access.
 *
 * Uses Payload's local API rather than HTTP, so these run in-process against
 * Postgres with no network hop. Wrapped in React's `cache` so a page that needs
 * the same record in both `generateMetadata` and the component only queries once.
 */

export const getPayloadClient = cache(async () => getPayload({ config }))

export type CreditRole = 'actor' | 'director' | 'writer' | 'composer' | 'creator'

export const getMovieBySlug = cache(async (slug: string) => {
  const payload = await getPayloadClient()
  const res = await payload.find({
    collection: 'movies',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 2, // resolves genres, companies, and article images
  })
  return res.docs[0] ?? null
})

export const getShowBySlug = cache(async (slug: string) => {
  const payload = await getPayloadClient()
  const res = await payload.find({
    collection: 'tv-shows',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 2,
  })
  return res.docs[0] ?? null
})

export const getPersonBySlug = cache(async (slug: string) => {
  const payload = await getPayloadClient()
  const res = await payload.find({
    collection: 'people',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 2,
  })
  return res.docs[0] ?? null
})

/**
 * Credits for one title, grouped by role.
 *
 * One query rather than one per role: the whole point of the credits table is
 * that this is a single indexed lookup, where the old site did dozens of
 * postmeta reads per page.
 */
export const getCreditsForTitle = cache(
  async (key: 'movie' | 'tvShow', id: number | string) => {
    const payload = await getPayloadClient()
    const res = await payload.find({
      collection: 'credits',
      where: { [key]: { equals: id } },
      limit: 200,
      sort: 'order',
      depth: 1, // resolves the person
    })

    const grouped: Record<CreditRole, typeof res.docs> = {
      actor: [],
      director: [],
      writer: [],
      composer: [],
      creator: [],
    }
    for (const credit of res.docs) {
      const role = credit.role as CreditRole
      if (grouped[role]) grouped[role].push(credit)
    }
    return grouped
  },
)

/** Everything a person was involved in, newest first, grouped by role. */
export const getCreditsForPerson = cache(async (id: number | string) => {
  const payload = await getPayloadClient()
  const res = await payload.find({
    collection: 'credits',
    where: { person: { equals: id } },
    limit: 500,
    depth: 1, // resolves the film or show
  })
  return res.docs
})

/** Popular titles for the home page and listings. */
export const getPopularMovies = cache(async (limit = 12, page = 1) => {
  const payload = await getPayloadClient()
  return payload.find({
    collection: 'movies',
    sort: '-popularity',
    limit,
    page,
    depth: 0,
  })
})

export const getPopularShows = cache(async (limit = 12, page = 1) => {
  const payload = await getPayloadClient()
  return payload.find({
    collection: 'tv-shows',
    sort: '-popularity',
    limit,
    page,
    depth: 0,
  })
})

/** The editorial posts. */
export const getRecentPosts = cache(async (limit = 6) => {
  const payload = await getPayloadClient()
  return payload.find({
    collection: 'posts',
    where: { _status: { equals: 'published' } },
    sort: '-publishedAt',
    limit,
    depth: 1,
  })
})

export const getPostBySlug = cache(async (slug: string) => {
  const payload = await getPayloadClient()
  const res = await payload.find({
    collection: 'posts',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 2,
  })
  return res.docs[0] ?? null
})

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

export type SearchHit = {
  id: number | string
  slug: string
  title: string
  year: string | null
  imagePath: string | null
  subtitle?: string | null
}

/**
 * Catalogue search across films, shows and people.
 *
 * Runs as raw SQL rather than through Payload's query builder for one reason:
 * people need ranking by credit count. Searching "smith" against 68,099 people
 * alphabetically is useless — the version that puts the most-credited first is
 * the difference between a working search and a list of strangers.
 *
 * Backed by the pg_trgm GIN indexes from scripts/create-search-indexes.mjs.
 */
export const searchCatalogue = cache(async (query: string, limit = 24) => {
  const q = query.trim()
  if (q.length < 2) return { movies: [], shows: [], people: [], total: 0 }

  const payload = await getPayloadClient()
  // The postgres adapter exposes its node-postgres pool.
  const pool = (payload.db as unknown as { pool: { query: Function } }).pool

  /**
   * Every word must appear, but not necessarily together.
   *
   * A single `ILIKE '%murder she wrote%'` needs one contiguous run, so it
   * misses "Murder, She Wrote" — the comma breaks it. Matching each word
   * separately survives punctuation and word order, and still uses the
   * trigram index for each term.
   */
  const words = q.split(/\s+/).filter(Boolean).slice(0, 6)
  const clause = (column: string) =>
    words.map((_, i) => `${column} ilike $${i + 1}`).join(' and ')
  const wordParams = words.map((w) => `%${w}%`)
  const n = words.length

  // $n+1 = exact match, $n+2 = prefix match, $n+3 = limit
  const rank = (column: string) =>
    `(lower(${column}) = lower($${n + 1})) desc, (lower(${column}) like lower($${n + 2})) desc`
  const params = [...wordParams, q, `${q}%`, limit]
  const limitParam = `$${n + 3}`

  const [movies, shows, people] = await Promise.all([
    pool.query(
      `select id, slug, title, poster_path, release_date
         from movies
        where ${clause('title')}
        order by ${rank('title')}, popularity desc nulls last
        limit ${limitParam}`,
      params,
    ),
    pool.query(
      `select id, slug, title, poster_path, first_air_date
         from tv_shows
        where ${clause('title')}
        order by ${rank('title')}, popularity desc nulls last
        limit ${limitParam}`,
      params,
    ),
    pool.query(
      `select p.id, p.slug, p.name, p.profile_image_path, p.known_for_department,
              count(c.id)::int as credit_count
         from people p
         left join credits c on c.person_id = p.id
        where ${clause('p.name')}
        group by p.id
        order by ${rank('p.name')}, credit_count desc
        limit ${limitParam}`,
      params,
    ),
  ])

  const yearOf = (d: unknown) => (d ? String(new Date(d as string).getFullYear()) : null)

  return {
    movies: movies.rows.map(
      (r: Record<string, unknown>): SearchHit => ({
        id: r.id as number,
        slug: String(r.slug),
        title: String(r.title),
        year: yearOf(r.release_date),
        imagePath: (r.poster_path as string) ?? null,
      }),
    ),
    shows: shows.rows.map(
      (r: Record<string, unknown>): SearchHit => ({
        id: r.id as number,
        slug: String(r.slug),
        title: String(r.title),
        year: yearOf(r.first_air_date),
        imagePath: (r.poster_path as string) ?? null,
      }),
    ),
    people: people.rows.map(
      (r: Record<string, unknown>): SearchHit => ({
        id: r.id as number,
        slug: String(r.slug),
        title: String(r.name),
        year: null,
        imagePath: (r.profile_image_path as string) ?? null,
        subtitle:
          (r.known_for_department as string) ??
          (Number(r.credit_count) ? `${r.credit_count} credits` : null),
      }),
    ),
    total: movies.rows.length + shows.rows.length + people.rows.length,
  }
})

export const getPageBySlug = cache(async (slug: string) => {
  const payload = await getPayloadClient()
  const res = await payload.find({
    collection: 'pages',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 2,
  })
  return res.docs[0] ?? null
})
