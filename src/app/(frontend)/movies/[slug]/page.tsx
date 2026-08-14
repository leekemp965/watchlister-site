import type { Metadata } from 'next'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { RichText } from '@payloadcms/richtext-lexical/react'
import { getMovieBySlug, getCreditsForTitle } from '@/lib/queries'
import { posterUrl, backdropUrl, formatRuntime, year, PLACEHOLDER } from '@/lib/tmdb'
import { CreditsTable } from '@/components/CreditsTable'
import { CastRail } from '@/components/CastRail'
import { Videos, Podcasts, Articles, Trailer } from '@/components/Editorial'

/**
 * Port of the old single-movie.php.
 *
 * Section order matches the original, which achieved it with Tailwind `order-*`
 * utilities on a flex column: hero, custom content, videos, podcasts, articles,
 * trailer, cast. Here the markup is simply in that order.
 */

export const revalidate = 3600

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const movie = await getMovieBySlug(slug)
  if (!movie) return { title: 'Not found' }

  const y = year(movie.releaseDate)
  const image = backdropUrl(movie.backdropPath, 'w1280') ?? posterUrl(movie.posterPath, 'w780')

  return {
    title: y ? `${movie.title} (${y})` : movie.title,
    description: movie.overview?.slice(0, 300) ?? undefined,
    openGraph: {
      title: movie.title,
      description: movie.overview ?? undefined,
      images: image ? [image] : undefined,
      type: 'video.movie',
    },
  }
}

export default async function MoviePage({ params }: Props) {
  const { slug } = await params
  const movie = await getMovieBySlug(slug)
  if (!movie) notFound()

  const credits = await getCreditsForTitle('movie', movie.id)

  const poster = posterUrl(movie.posterPath, 'w342')
  const backdrop = backdropUrl(movie.backdropPath, 'w1280')
  const runtime = formatRuntime(movie.runtime)

  return (
    <div className="container mx-auto flex flex-col px-8 text-white sm:px-16">
      {/* Hero: cover artwork behind poster and headline details */}
      <article
        className="-mx-8 mb-8 h-fit bg-cover bg-center bg-no-repeat sm:-mx-16"
        style={backdrop ? { backgroundImage: `url('${backdrop}')` } : undefined}
      >
        <div className="grid h-full grid-cols-12 gap-8 bg-gradient-to-b from-gray-900/80 via-gray-800/80 to-gray-950 pt-8 md:gap-16 md:pt-16">
          <figure className="col-span-12 mx-6 md:col-span-3 md:mr-0 md:ml-16">
            <Image
              src={poster ?? PLACEHOLDER.poster}
              alt={`${movie.title} poster`}
              width={342}
              height={513}
              className="max-w-full"
              priority
              unoptimized={!poster}
            />
          </figure>

          <div className="col-span-12 mx-6 md:col-span-9 lg:mx-0">
            <div className="grid grid-cols-12 gap-2 md:gap-8">
              <div className="col-span-12 my-4">
                <h1 className="mb-1 text-4xl font-semibold">{movie.title}</h1>
                {year(movie.releaseDate) && (
                  <p className="text-2xl opacity-50">{year(movie.releaseDate)}</p>
                )}
              </div>

              <div className="col-span-12 mb-8 leading-relaxed md:col-span-6">
                {movie.overview && <p>{movie.overview}</p>}
                {runtime && <p className="mt-4">Running time: {runtime}</p>}
              </div>

              <div className="col-span-12 md:col-span-6">
                <CreditsTable
                  directors={credits.director}
                  writers={credits.writer}
                  composers={credits.composer}
                  genres={movie.genres ?? []}
                  certificate={movie.certificate}
                  releaseDate={movie.releaseDate}
                  productionCompanies={movie.productionCompanies ?? []}
                />
              </div>
            </div>
          </div>
        </div>
      </article>

      {movie.customContent && (
        <div className="prose-watchlister mb-16">
          <RichText data={movie.customContent} />
        </div>
      )}

      <Videos items={movie.videoEmbeds} />
      <Podcasts items={movie.podcasts} />
      <Articles items={movie.articles} />
      <Trailer url={movie.youtubeUrl} />
      <CastRail credits={credits.actor} title="Actors" />
    </div>
  )
}
