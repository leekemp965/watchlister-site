import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getGenreBySlug, getTitlesByGenre } from '@/lib/queries'
import { TitleGrid } from '@/components/TitleGrid'
import { Pagination } from '@/components/Pagination'

/**
 * A genre archive.
 *
 * Every title page links its genres through CreditsTable, and until now there
 * was nothing at the other end: `/genres/drama-movie` and the rest returned 404
 * on all ~24,000 title pages. The links were carried over from the WordPress
 * theme, where the genre taxonomy had archives; the route was simply never
 * rebuilt.
 *
 * Note this is a real archive rather than the treatment the other taxonomies
 * get. /country, /language, /network and /production_company are legacy
 * redirect shims that bounce an old inbound link to a search, which is fine for
 * URLs nothing links to any more — but genres are linked from every title page,
 * and sending a reader who clicked "Science Fiction" to a text search for the
 * words "science fiction" would find titles *named* that rather than titles *in*
 * it. Networks and production companies render as plain text in CreditsTable
 * for the same reason; genres are the one taxonomy that is linked.
 */

/**
 * This route renders on demand, not from a static cache, and `revalidate` below
 * has no effect on it — reading `searchParams` for the page number opts the
 * route out of static rendering entirely. That is the same trap that made the
 * title pages uncacheable until `generateStaticParams` was added to them, so it
 * is worth stating rather than discovering again: a `revalidate` export is not
 * evidence that anything is being cached.
 *
 * Kept this way deliberately, to match /movies and /tv-shows, which page the
 * same way and are also dynamic. These are browse pages rather than the hot
 * path, and splitting page 1 into its own static route to win a cache would put
 * this route out of step with its siblings for little gain. The query behind it
 * is a single indexed relationship lookup.
 */
export const revalidate = 86400

const PER_PAGE = 48

type Props = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ page?: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const genre = await getGenreBySlug(slug)
  if (!genre) return { title: 'Not found' }

  const kind = genre.medium === 'tv' ? 'TV shows' : 'films'
  return {
    title: `${genre.name} ${kind}`,
    description: `Browse ${genre.name} ${kind} on Watchlister.`,
    alternates: { canonical: `/genres/${slug}` },
  }
}

export default async function GenrePage({ params, searchParams }: Props) {
  const { slug } = await params
  const { page: pageParam } = await searchParams
  const page = Math.max(1, Number(pageParam) || 1)

  const genre = await getGenreBySlug(slug)
  if (!genre) notFound()

  const { basePath, result } = await getTitlesByGenre(genre.id, genre.medium, PER_PAGE, page)

  const kind = genre.medium === 'tv' ? 'TV shows' : 'films'

  return (
    <div className="container mx-auto px-8 py-8 sm:px-16 md:py-12">
      <div className="mb-8 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-vermilion text-3xl font-semibold md:text-4xl">
          {genre.name} <span className="text-white opacity-60">{kind}</span>
        </h1>
        <p className="text-sm text-gray-400">
          {result.totalDocs.toLocaleString('en-GB')} {result.totalDocs === 1 ? 'title' : 'titles'}
        </p>
      </div>

      <TitleGrid items={result.docs} basePath={basePath} />

      <Pagination page={page} totalPages={result.totalPages} basePath={`/genres/${slug}`} />
    </div>
  )
}
