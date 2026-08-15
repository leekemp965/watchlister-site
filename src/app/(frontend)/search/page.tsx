import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { searchCatalogue, type SearchHit } from '@/lib/queries'
import { searchTmdb, slugify } from '@/lib/tmdb-import'
import { posterUrl, profileUrl, PLACEHOLDER } from '@/lib/tmdb'

export const metadata: Metadata = {
  title: 'Search',
  robots: { index: false },
}

// Results depend entirely on the query string, so there is nothing to revalidate.
export const dynamic = 'force-dynamic'

/**
 * Search covers all of TMDB, not just what has been imported.
 *
 * The old WordPress site queried TMDB directly and created a local page the
 * first time anyone opened a result, so every film was findable and the
 * catalogue grew from use. Searching only the local database would mean a
 * visitor looking for The Social Network gets nothing, purely because nobody
 * happened to search for it before the site went dark.
 *
 * Local records are listed first — they are the ones carrying editorial
 * content. Everything else links to a slug ending in the TMDB id, which the
 * title route imports on arrival.
 */
type Result = SearchHit & { local: boolean }

function merge(local: SearchHit[], remote: Array<{ tmdbId: number; title: string; year: string | null; imagePath: string | null; subtitle?: string | null }>): Result[] {
  const held = new Set(local.map((l) => l.tmdbId))
  return [
    ...local.map((l) => ({ ...l, local: true })),
    ...remote
      .filter((r) => !held.has(r.tmdbId))
      .map((r) => ({
        id: `tmdb-${r.tmdbId}`,
        slug: slugify(r.title, r.tmdbId),
        title: r.title,
        tmdbId: r.tmdbId,
        year: r.year,
        imagePath: r.imagePath,
        subtitle: r.subtitle ?? null,
        local: false,
      })),
  ]
}

function ResultGrid({
  title,
  items,
  basePath,
  kind,
}: {
  title: string
  items: Result[]
  basePath: string
  kind: 'poster' | 'profile'
}) {
  if (!items.length) return null

  return (
    <section className="my-8">
      <h2 className="text-vermilion mb-4 text-2xl font-semibold">
        {title} <span className="text-base font-normal opacity-50">({items.length})</span>
      </h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 md:gap-6 lg:grid-cols-6">
        {items.map((item) => {
          const img =
            kind === 'poster'
              ? posterUrl(item.imagePath, 'w342')
              : profileUrl(item.imagePath, 'w185')
          return (
            <article key={`${basePath}-${item.id}`} className="group">
              <Link href={`${basePath}/${item.slug}`} className="block">
                <Image
                  src={img ?? (kind === 'poster' ? PLACEHOLDER.poster : PLACEHOLDER.profile)}
                  alt={item.title}
                  width={342}
                  height={513}
                  className="h-auto w-full object-cover transition duration-300 group-hover:ring-2 group-hover:ring-neutral-50"
                  unoptimized={!img}
                />
                <h3 className="group-hover:text-vermilion mt-2 text-sm leading-snug font-medium transition">
                  {item.title}
                </h3>
                {item.year && <p className="text-xs opacity-50">{item.year}</p>}
                {item.subtitle && <p className="text-xs opacity-50">{item.subtitle}</p>}
              </Link>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q = '' } = await searchParams
  const query = q.trim()

  // Local and TMDB in parallel — one is a fast indexed query, the other three
  // API calls, and there is no reason to wait for them in sequence.
  const [local, remote] = query
    ? await Promise.all([
        searchCatalogue(query),
        searchTmdb(query).catch(() => ({ movies: [], shows: [], people: [] })),
      ])
    : [null, null]

  const movies = local && remote ? merge(local.movies, remote.movies) : []
  const shows = local && remote ? merge(local.shows, remote.shows) : []
  const people = local && remote ? merge(local.people, remote.people) : []
  const total = movies.length + shows.length + people.length

  return (
    <div className="container mx-auto px-8 py-8 sm:px-16 md:py-12">
      <form action="/search" method="get" className="mb-10">
        <label htmlFor="q" className="sr-only">
          Search
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={query}
          autoFocus={!query}
          placeholder="Search films, shows and people…"
          className="border-vermilion focus:ring-vermilion w-full border-b-2 bg-transparent px-2 py-4 text-2xl text-white placeholder-gray-500 focus:outline-none md:text-4xl"
        />
      </form>

      {!query && (
        <p className="text-gray-400">
          Search every film, show and person on The Movie Database. Anything not here yet is
          added the first time you open it.
        </p>
      )}

      {query && total === 0 && (
        <div className="py-8">
          <p className="mb-2 text-xl">
            Nothing found for <span className="text-vermilion">“{query}”</span>.
          </p>
          <p className="text-gray-400">
            Try fewer words, or check the spelling — partial words work, so “ville” finds
            Villeneuve.
          </p>
        </div>
      )}

      {total > 0 && (
        <>
          <p className="mb-4 text-sm text-gray-400">
            {total} result{total === 1 ? '' : 's'} for{' '}
            <span className="text-white">“{query}”</span>
          </p>
          <ResultGrid title="Films" items={movies} basePath="/movies" kind="poster" />
          <ResultGrid title="TV Shows" items={shows} basePath="/tv-shows" kind="poster" />
          <ResultGrid title="People" items={people} basePath="/people" kind="profile" />
        </>
      )}
    </div>
  )
}
