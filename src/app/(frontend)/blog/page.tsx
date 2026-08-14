import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { getRecentPosts } from '@/lib/queries'

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Writing about film and television from Watchlister.',
}

export default async function BlogPage() {
  const posts = await getRecentPosts(50)

  return (
    <div className="container mx-auto px-8 py-8 sm:px-16 md:py-12">
      <h1 className="text-vermilion mb-8 text-3xl font-semibold md:text-4xl">Blog</h1>

      {posts.docs.length === 0 ? (
        <p className="text-gray-400">No posts yet.</p>
      ) : (
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {posts.docs.map((post) => {
            const img =
              typeof post.featuredImage === 'object' && post.featuredImage
                ? (post.featuredImage as { url?: string; alt?: string })
                : null
            return (
              <article key={post.id} className="group flex flex-col">
                <Link href={`/${post.slug}`} className="block">
                  <Image
                    src={img?.url ?? '/img/featured-image-missing.svg'}
                    alt={img?.alt ?? post.title ?? ''}
                    width={480}
                    height={280}
                    className="h-48 w-full object-cover transition group-hover:opacity-90"
                    unoptimized={!img?.url}
                  />
                </Link>
                <div className="py-4">
                  {post.publishedAt && (
                    <time className="text-xs text-gray-500" dateTime={post.publishedAt}>
                      {new Date(post.publishedAt).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </time>
                  )}
                  <h2 className="mt-1 text-lg font-semibold">
                    <Link href={`/${post.slug}`} className="hover:text-vermilion transition">
                      {post.title}
                    </Link>
                  </h2>
                  {post.excerpt && (
                    <p className="mt-2 line-clamp-3 text-sm text-gray-400">{post.excerpt}</p>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
