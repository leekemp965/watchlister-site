import { permanentRedirect } from 'next/navigation'

/**
 * Posts are canonical at the root (/{slug}) because that is where the old
 * WordPress permalink structure put them. This route exists only so links
 * built against /blog/{slug} — including ones I generated earlier in this
 * rebuild — resolve rather than 404, and so there is a single canonical URL
 * for search engines.
 */
export default async function BlogPostRedirect({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  permanentRedirect(`/${slug}`)
}
