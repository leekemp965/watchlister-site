import type { Metadata } from 'next'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { RichText } from '@payloadcms/richtext-lexical/react'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { getShowBySlug, getCreditsForTitle, getPayloadClient } from '@/lib/queries'
import { importShow, tmdbIdFromSlug } from '@/lib/tmdb-import'
import { posterUrl, backdropUrl, formatRuntime, year, PLACEHOLDER } from '@/lib/tmdb'
import { CreditsTable } from '@/components/CreditsTable'
import { CastRail } from '@/components/CastRail'
import { Videos, Podcasts, Articles, Trailer } from '@/components/Editorial'

export const revalidate = 3600

/** Importing a title fetches its details and up to 30 cast members. */
export const maxDuration = 60

type Props = { params: Promise<{ slug: string }> }

/**
 * See the film page for the reasoning — the catalogue grows from what people
 * look for, as it did on the old site, rather than from a fixed import.
 */
const findOrImport = cache(async (slug: string) => {
  const existing = await getShowBySlug(slug)
  if (existing) return { show: existing, redirectTo: null as string | null }

  const tmdbId = tmdbIdFromSlug(slug)
  if (!tmdbId) return { show: null, redirectTo: null }

  const payload = await getPayloadClient()
  const result = await importShow(payload, tmdbId)
  if (result.status !== 'ok') return { show: null, redirectTo: null }
  if (result.slug !== slug) return { show: null, redirectTo: `/tv-shows/${result.slug}` }

  const fresh = await payload.find({
    collection: 'tv-shows',
    where: { slug: { equals: result.slug } },
    limit: 1,
    depth: 2,
  })
  return { show: fresh.docs[0] ?? null, redirectTo: null }
})

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const { show } = await findOrImport(slug)
  if (!show) return { title: 'Not found' }

  const y = year(show.firstAirDate)
  const image = backdropUrl(show.backdropPath, 'w1280') ?? posterUrl(show.posterPath, 'w780')

  return {
    title: y ? `${show.title} (${y})` : show.title,
    description: show.overview?.slice(0, 300) ?? undefined,
    openGraph: {
      title: show.title,
      description: show.overview ?? undefined,
      images: image ? [image] : undefined,
      type: 'video.tv_show',
    },
  }
}

export default async function ShowPage({ params }: Props) {
  const { slug } = await params
  const { show, redirectTo } = await findOrImport(slug)
  if (redirectTo) redirect(redirectTo)
  if (!show) notFound()

  const credits = await getCreditsForTitle('tvShow', show.id)

  const poster = posterUrl(show.posterPath, 'w342')
  const backdrop = backdropUrl(show.backdropPath, 'w1280')

  const seasons = show.numberOfSeasons
    ? `${show.numberOfSeasons} season${show.numberOfSeasons === 1 ? '' : 's'}`
    : null
  const episodes = show.numberOfEpisodes
    ? `${show.numberOfEpisodes} episode${show.numberOfEpisodes === 1 ? '' : 's'}`
    : null

  return (
    <div className="container mx-auto flex flex-col px-8 text-white sm:px-16">
      <article
        className="-mx-8 mb-8 h-fit bg-cover bg-center bg-no-repeat sm:-mx-16"
        style={backdrop ? { backgroundImage: `url('${backdrop}')` } : undefined}
      >
        <div className="grid h-full grid-cols-12 gap-8 bg-gradient-to-b from-gray-900/80 via-gray-800/80 to-gray-950 pt-8 md:gap-16 md:pt-16">
          <figure className="col-span-12 mx-6 md:col-span-3 md:mr-0 md:ml-16">
            <Image
              src={poster ?? PLACEHOLDER.poster}
              alt={`${show.title} poster`}
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
                <h1 className="mb-1 text-4xl font-semibold">{show.title}</h1>
                {year(show.firstAirDate) && (
                  <p className="text-2xl opacity-50">{year(show.firstAirDate)}</p>
                )}
              </div>

              <div className="col-span-12 mb-8 leading-relaxed md:col-span-6">
                {show.overview && <p>{show.overview}</p>}
                {(seasons || episodes) && (
                  <p className="mt-4">{[seasons, episodes].filter(Boolean).join(' · ')}</p>
                )}
                {show.episodeRuntime && (
                  <p className="mt-1">Episode length: {formatRuntime(show.episodeRuntime)}</p>
                )}
              </div>

              <div className="col-span-12 md:col-span-6">
                <CreditsTable
                  creators={credits.creator}
                  directors={credits.director}
                  writers={credits.writer}
                  composers={credits.composer}
                  genres={show.genres ?? []}
                  releaseDate={show.firstAirDate}
                  releaseLabel="First Aired"
                  networks={show.networks ?? []}
                  productionCompanies={show.productionCompanies ?? []}
                  extra={[{ label: 'Status', value: show.status }]}
                />
              </div>
            </div>
          </div>
        </div>
      </article>

      {show.customContent && (
        <div className="prose-watchlister mb-16">
          <RichText data={show.customContent} />
        </div>
      )}

      <Videos items={show.videoEmbeds} />
      <Podcasts items={show.podcasts} />
      <Articles items={show.articles} />
      <Trailer url={show.youtubeUrl} />
      <CastRail credits={credits.actor} title="Cast" />
    </div>
  )
}
