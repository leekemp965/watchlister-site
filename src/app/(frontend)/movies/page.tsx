import type { Metadata } from 'next'
import { getPopularMovies } from '@/lib/queries'
import { TitleGrid } from '@/components/TitleGrid'
import { Pagination } from '@/components/Pagination'

export const revalidate = 86400

export const metadata: Metadata = {
  title: 'Films',
  description: 'Browse the Watchlister film catalogue.',
}

const PER_PAGE = 48

export default async function MoviesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const { page: pageParam } = await searchParams
  const page = Math.max(1, Number(pageParam) || 1)

  const result = await getPopularMovies(PER_PAGE, page)

  return (
    <div className="container mx-auto px-8 py-8 sm:px-16 md:py-12">
      <div className="mb-8 flex items-baseline justify-between">
        <h1 className="text-vermilion text-3xl font-semibold md:text-4xl">Films</h1>
        <p className="text-sm text-gray-400">{result.totalDocs.toLocaleString()} titles</p>
      </div>

      <TitleGrid items={result.docs} basePath="/movies" />

      <Pagination page={page} totalPages={result.totalPages} basePath="/movies" />
    </div>
  )
}
