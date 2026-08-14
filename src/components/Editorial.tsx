import Image from 'next/image'
import Link from 'next/link'
import { videoEmbed, PLACEHOLDER } from '@/lib/tmdb'

/**
 * The editorial rails: videos, podcasts and articles.
 *
 * These are the hand-curated layer carried over from WordPress — 1,100 video
 * embeds, 142 podcast episodes and 248 article links across 409 titles. Each
 * renders as a horizontally scrollable row, as on the old site.
 */

function Section({
  title,
  children,
  className = '',
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`my-8 md:my-12 ${className}`}>
      <h2 className="text-vermilion mb-4 text-3xl font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Rail({ children }: { children: React.ReactNode }) {
  return (
    <div className="custom-scrollbar -m-1 flex overflow-x-auto py-2">
      <div className="flex space-x-4 p-1">{children}</div>
    </div>
  )
}

export type VideoEmbed = { id?: string | null; videoUrl?: string | null; videoTitle?: string | null }

export function Videos({ items, title = 'Videos' }: { items?: VideoEmbed[] | null; title?: string }) {
  const valid = (items ?? []).filter((v) => videoEmbed(v.videoUrl))
  if (!valid.length) return null

  return (
    <Section title={title}>
      <Rail>
        {valid.map((v, i) => (
          <div key={v.id ?? i} className="w-64 shrink-0 sm:w-[456px]">
            <div className="youtube-embed">
              <iframe
                src={videoEmbed(v.videoUrl)!}
                title={v.videoTitle ?? 'Video'}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
              />
            </div>
            {v.videoTitle && <h3 className="my-4 font-semibold">{v.videoTitle}</h3>}
          </div>
        ))}
      </Rail>
    </Section>
  )
}

export type Podcast = {
  id?: string | null
  title?: string | null
  episodeTitle?: string | null
  url?: string | null
}

export function Podcasts({ items }: { items?: Podcast[] | null }) {
  const valid = (items ?? []).filter((p) => p.url)
  if (!valid.length) return null

  return (
    <Section title="Podcasts">
      <Rail>
        {valid.map((p, i) => (
          <a
            key={p.id ?? i}
            href={p.url!}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-cod-gray hover:border-vermilion min-w-64 max-w-96 shrink-0 border-2 border-transparent px-4 py-6 text-center transition ease-in"
          >
            <Image
              src="/img/podcast.svg"
              alt=""
              width={40}
              height={40}
              className="mx-auto my-2 w-10"
            />
            {p.title && <span className="font-semibold">{p.title}: </span>}
            {p.episodeTitle && <span className="font-semibold">{p.episodeTitle}</span>}
          </a>
        ))}
      </Rail>
    </Section>
  )
}

export type ArticleLink = {
  id?: string | null
  internalLink?: boolean | null
  post?: { slug?: string; title?: string; featuredImage?: unknown } | string | number | null
  url?: string | null
  title?: string | null
  image?: { url?: string | null; alt?: string | null } | string | number | null
}

export function Articles({ items }: { items?: ArticleLink[] | null }) {
  const valid = (items ?? []).filter((a) => a.url || a.post)
  if (!valid.length) return null

  return (
    <Section title="Articles">
      <Rail>
        {valid.map((a, i) => {
          const internal = Boolean(a.internalLink) && a.post && typeof a.post === 'object'
          const post = typeof a.post === 'object' && a.post ? a.post : null

          const href = internal && post?.slug ? `/${post.slug}` : (a.url ?? '#')
          const label = internal ? (post?.title ?? 'Read more') : (a.title ?? 'Read more')

          const img = typeof a.image === 'object' && a.image ? a.image : null
          const src = img?.url ?? PLACEHOLDER.article

          return (
            <article key={a.id ?? i} className="w-64 shrink-0 sm:w-[340px]">
              <a
                href={href}
                {...(internal ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                className="block"
              >
                <Image
                  src={src}
                  alt={img?.alt ?? label}
                  width={340}
                  height={192}
                  className="h-48 w-full object-cover"
                  unoptimized={src.endsWith('.svg')}
                />
              </a>
              <div className="py-4">
                <h3 className="font-semibold">
                  <a
                    href={href}
                    {...(internal ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                    className="hover:text-vermilion"
                  >
                    {label}
                  </a>
                </h3>
              </div>
            </article>
          )
        })}
      </Rail>
    </Section>
  )
}

/** The trailer, shown as a single embed rather than a rail. */
export function Trailer({ url }: { url?: string | null }) {
  const embed = videoEmbed(url)
  if (!embed) return null
  return (
    <Section title="Trailer">
      <div className="youtube-embed max-w-4xl">
        <iframe
          src={embed}
          title="Trailer"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
        />
      </div>
    </Section>
  )
}

export { Section, Rail }
