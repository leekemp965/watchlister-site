import type { CollectionAfterChangeHook, CollectionAfterDeleteHook } from 'payload'

/**
 * Clear a page's cache the moment its record changes.
 *
 * Title pages cache for a month, because film metadata does not change — the
 * previous setting of one hour rewrote every visited page's cache entry hourly
 * across a 94,000-page catalogue and consumed Vercel's ISR write allowance.
 *
 * A long window is only safe if edits still appear immediately, which is what
 * these hooks are for: cache indefinitely, invalidate on write, rather than
 * expire constantly on the chance something changed.
 */

const PREFIX: Record<string, string> = {
  movies: '/movies',
  'tv-shows': '/tv-shows',
  people: '/people',
}

async function purge(collection: string, slug?: string | null) {
  if (!slug) return
  const prefix = PREFIX[collection]
  if (!prefix) return

  try {
    // Imported lazily: this module is pulled in by the Payload config, which
    // also runs in contexts where next/cache is not available (the sync and
    // import scripts). A static import would break them.
    const { revalidatePath } = await import('next/cache')
    revalidatePath(`${prefix}/${slug}`)
  } catch {
    // Outside a Next request — a CLI script — there is no cache to purge.
  }
}

export const revalidateAfterChange: CollectionAfterChangeHook = async ({ doc, collection }) => {
  await purge(collection.slug, (doc as { slug?: string }).slug)
  return doc
}

export const revalidateAfterDelete: CollectionAfterDeleteHook = async ({ doc, collection }) => {
  await purge(collection.slug, (doc as { slug?: string }).slug)
  return doc
}
