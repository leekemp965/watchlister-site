import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { RichText } from '@payloadcms/richtext-lexical/react'
import { getPageBySlug, getPostBySlug, getPayloadClient } from '@/lib/queries'

/**
 * Root-level content: the static pages, and the blog posts.
 *
 * Posts live here rather than under /blog/ because the old site's permalink
 * structure was `/%postname%/` — every inbound link and every share of
 * "/artificial-intelligence-movies/" points at the root. Moving them under
 * /blog/ would have broken all of it for no gain. /blog remains the index, and
 * /blog/{slug} redirects here so there is a single canonical URL.
 *
 * Next resolves static segments (/movies, /search, /blog) before this, so they
 * are unaffected.
 */

export const revalidate = 86400

type Props = { params: Promise<{ slug: string }> }

/**
 * Slugs this route must never claim, because a real route owns them.
 *
 * The migrated WordPress pages include ones called "Blog" and "Search" — the
 * old site's listing and results pages, which are real routes here. Left
 * alone, `generateStaticParams` prerenders /search as that empty page, and the
 * resulting static file is served in preference to the actual search route,
 * which is `force-dynamic` and therefore not prerendered. The symptom is a
 * search page that renders in 4ms and returns nothing.
 *
 * /blog escaped only by luck: its route is prerendered too, so the explicit
 * route won. That is not something to rely on.
 */
const RESERVED = new Set([
  'search',
  'blog',
  'movies',
  'tv-shows',
  'people',
  'admin',
  'api',
  'robots.txt',
  'sitemap.xml',
  'sitemap',
  'seo',
  // Legacy WordPress prefixes, handled by their own redirect routes.
  'movie',
  'tv_show',
  'actor',
  'director',
  'writer',
  'composer',
  'creator',
  'production_company',
  'network',
  'country',
  'language',
])

export async function generateStaticParams() {
  const payload = await getPayloadClient()
  const [pages, posts] = await Promise.all([
    payload.find({ collection: 'pages', limit: 100, depth: 0 }),
    payload.find({
      collection: 'posts',
      where: { _status: { equals: 'published' } },
      limit: 200,
      depth: 0,
    }),
  ])
  return [...pages.docs, ...posts.docs]
    .map((d) => String(d.slug))
    .filter((slug) => slug && !RESERVED.has(slug))
    .map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const page = await getPageBySlug(slug)
  if (page) return { title: page.title }

  const post = await getPostBySlug(slug)
  if (!post) return { title: 'Not found' }

  const img =
    typeof post.featuredImage === 'object' && post.featuredImage
      ? (post.featuredImage as { url?: string })
      : null

  return {
    title: post.title,
    description: post.excerpt ?? undefined,
    openGraph: {
      title: post.title ?? undefined,
      description: post.excerpt ?? undefined,
      type: 'article',
      publishedTime: post.publishedAt ?? undefined,
      images: img?.url ? [img.url] : undefined,
    },
  }
}

export default async function RootContentPage({ params }: Props) {
  const { slug } = await params

  // Belt and braces: even if a reserved slug reaches this route at runtime,
  // it must not render the WordPress leftover in place of the real page.
  if (RESERVED.has(slug)) notFound()

  const page = await getPageBySlug(slug)
  if (page) {
    return (
      <article className="container mx-auto max-w-4xl px-8 py-8 sm:px-16 md:py-12">
        <h1 className="mb-8 text-3xl leading-tight font-semibold md:text-5xl">{page.title}</h1>
        {page.content && (
          <div className="prose-watchlister">
            <RichText data={page.content} />
          </div>
        )}
      </article>
    )
  }

  const post = await getPostBySlug(slug)
  if (!post) notFound()

  const img =
    typeof post.featuredImage === 'object' && post.featuredImage
      ? (post.featuredImage as { url?: string; alt?: string; width?: number; height?: number })
      : null

  const related = Array.isArray(post.relatedTitles) ? post.relatedTitles : []

  return (
    <article className="container mx-auto max-w-4xl px-8 py-8 sm:px-16 md:py-12">
      <header className="mb-8">
        {post.publishedAt && (
          <time className="text-sm text-gray-500" dateTime={post.publishedAt}>
            {new Date(post.publishedAt).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </time>
        )}
        <h1 className="mt-2 text-3xl leading-tight font-semibold md:text-5xl">{post.title}</h1>
      </header>

      {img?.url && (
        <Image
          src={img.url}
          alt={img.alt ?? post.title ?? ''}
          width={img.width ?? 1200}
          height={img.height ?? 675}
          className="mb-8 h-auto w-full"
          priority
        />
      )}

      {post.content && (
        <div className="prose-watchlister">
          <RichText data={post.content} />
        </div>
      )}

      {related.length > 0 && (
        <footer className="mt-12 border-t border-gray-800 pt-8">
          <h2 className="text-vermilion mb-4 text-xl font-semibold">Related titles</h2>
          <ul className="flex flex-wrap gap-3">
            {related.map((r, i) => {
              const rel = r as { relationTo?: string; value?: { slug?: string; title?: string } }
              if (!rel?.value?.slug) return null
              const base = rel.relationTo === 'tv-shows' ? '/tv-shows' : '/movies'
              return (
                <li key={i}>
                  <Link
                    href={`${base}/${rel.value.slug}`}
                    className="bg-cod-gray hover:border-vermilion inline-block border-2 border-transparent px-4 py-2 text-sm transition"
                  >
                    {rel.value.title}
                  </Link>
                </li>
              )
            })}
          </ul>
        </footer>
      )}
    </article>
  )
}
