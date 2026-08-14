import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { searchCatalogue, type SearchHit } from '@/lib/queries'
import { posterUrl, profileUrl, PLACEHOLDER } from '@/lib/tmdb'

export const metadata: Metadata = {
  title: 'Search',
  robots: { index: false },
}

// Results depend entirely on the query string, so there is nothing to revalidate.
export const dynamic = 'force-dynamic'

function ResultGrid({
  title,
  items,
  basePath,
  kind,
}: {
  title: string
  items: SearchHit[]
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
  const results = query ? await searchCatalogue(query) : null

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
          Search across 5,757 films, 816 shows and 68,099 people.
        </p>
      )}

      {results && results.total === 0 && (
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

      {results && results.total > 0 && (
        <>
          <p className="mb-4 text-sm text-gray-400">
            {results.total} result{results.total === 1 ? '' : 's'} for{' '}
            <span className="text-white">“{query}”</span>
          </p>
          <ResultGrid title="Films" items={results.movies} basePath="/movies" kind="poster" />
          <ResultGrid title="TV Shows" items={results.shows} basePath="/tv-shows" kind="poster" />
          <ResultGrid title="People" items={results.people} basePath="/people" kind="profile" />
        </>
      )}
    </div>
  )
}
