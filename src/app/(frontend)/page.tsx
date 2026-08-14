import Link from 'next/link'
import Image from 'next/image'
import { getPopularMovies, getPopularShows, getRecentPosts } from '@/lib/queries'
import { TitleGrid } from '@/components/TitleGrid'

export const revalidate = 3600

export default async function HomePage() {
  const [movies, shows, posts] = await Promise.all([
    getPopularMovies(12),
    getPopularShows(6),
    getRecentPosts(6),
  ])

  return (
    <div className="container mx-auto px-8 sm:px-16">
      <section className="py-8 md:py-12">
        <h1 className="max-w-3xl text-3xl leading-tight font-semibold md:text-5xl">
          Watched something and wanted to know{' '}
          <span className="text-vermilion">everything</span> about it?
        </h1>
        <p className="mt-4 max-w-2xl text-gray-400">
          People are analysing, writing about and sharing their love of film constantly. Watchlister
          puts it in one place.
        </p>
      </section>

      <section className="my-8 md:my-12">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-vermilion text-3xl font-semibold">Popular Films</h2>
          <Link href="/movies" className="hover:text-vermilion text-sm transition">
            Browse all &rarr;
          </Link>
        </div>
        <TitleGrid items={movies.docs} basePath="/movies" />
      </section>

      <section className="my-8 md:my-12">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-vermilion text-3xl font-semibold">Popular TV</h2>
          <Link href="/tv-shows" className="hover:text-vermilion text-sm transition">
            Browse all &rarr;
          </Link>
        </div>
        <TitleGrid items={shows.docs} basePath="/tv-shows" />
      </section>

      {posts.docs.length > 0 && (
        <section className="my-8 md:my-12">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-vermilion text-3xl font-semibold">From the Blog</h2>
            <Link href="/blog" className="hover:text-vermilion text-sm transition">
              All posts &rarr;
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-6 md:gap-8">
            {posts.docs.map((post) => {
              const img =
                typeof post.featuredImage === 'object' && post.featuredImage
                  ? (post.featuredImage as { url?: string; alt?: string })
                  : null
              return (
                <div key={post.id} className="flex flex-col gap-3">
                  <Link href={`/${post.slug}`} aria-label={post.title}>
                    <Image
                      src={img?.url ?? '/img/featured-image-missing.svg'}
                      alt={img?.alt ?? post.title ?? ''}
                      width={340}
                      height={220}
                      className="h-32 w-full object-cover"
                      unoptimized={!img?.url}
                    />
                  </Link>
                  <p className="my-0 text-base font-medium">
                    <Link
                      href={`/${post.slug}`}
                      className="hover:text-vermilion block leading-snug text-white transition"
                    >
                      {post.title}
                    </Link>
                  </p>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
