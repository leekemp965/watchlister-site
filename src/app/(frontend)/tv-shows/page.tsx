import type { Metadata } from 'next'
import { getPopularShows } from '@/lib/queries'
import { TitleGrid } from '@/components/TitleGrid'
import { Pagination } from '@/components/Pagination'

export const revalidate = 86400

export const metadata: Metadata = {
  title: 'TV Shows',
  description: 'Browse the Watchlister television catalogue.',
}

const PER_PAGE = 48

export default async function ShowsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const { page: pageParam } = await searchParams
  const page = Math.max(1, Number(pageParam) || 1)

  const result = await getPopularShows(PER_PAGE, page)

  return (
    <div className="container mx-auto px-8 py-8 sm:px-16 md:py-12">
      <div className="mb-8 flex items-baseline justify-between">
        <h1 className="text-vermilion text-3xl font-semibold md:text-4xl">TV Shows</h1>
        <p className="text-sm text-gray-400">{result.totalDocs.toLocaleString()} titles</p>
      </div>

      <TitleGrid items={result.docs} basePath="/tv-shows" />

      <Pagination page={page} totalPages={result.totalPages} basePath="/tv-shows" />
    </div>
  )
}
