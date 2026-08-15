import { TmdbImage } from '@/components/TmdbImage'
import Link from 'next/link'
import { posterUrl, year, PLACEHOLDER } from '@/lib/tmdb'

type Title = {
  id: number | string
  title?: string | null
  slug?: string | null
  posterPath?: string | null
  releaseDate?: string | null
  firstAirDate?: string | null
}

/** Poster grid used on the home page and the browse listings. */
export function TitleGrid({
  items,
  basePath,
}: {
  items: Title[]
  basePath: '/movies' | '/tv-shows'
}) {
  if (!items.length) {
    return <p className="text-gray-400">Nothing here yet.</p>
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 md:gap-6 lg:grid-cols-6">
      {items.map((t) => {
        const poster = posterUrl(t.posterPath, 'w342')
        const y = year(t.releaseDate ?? t.firstAirDate)
        return (
          <article key={t.id} className="group">
            <Link href={`${basePath}/${t.slug}`} className="block">
              <TmdbImage
                src={poster ?? PLACEHOLDER.poster}
                alt={t.title ?? ''}
                width={342}
                height={513}
                className="h-auto w-full object-cover transition duration-300 group-hover:ring-2 group-hover:ring-neutral-50"
                unoptimized={!poster}
              />
              <h3 className="group-hover:text-vermilion mt-2 text-sm leading-snug font-medium transition">
                {t.title}
              </h3>
              {y && <p className="text-xs opacity-50">{y}</p>}
            </Link>
          </article>
        )
      })}
    </div>
  )
}
