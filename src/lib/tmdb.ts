/**
 * TMDB image helpers.
 *
 * The old site downloaded every poster and still into wp-content/uploads,
 * which is how that folder reached 1.1 GB across 60,290 files. Here we keep
 * only the path TMDB gives us and build a CDN URL at render time; Next's image
 * optimiser handles resizing and format negotiation.
 */

const BASE = 'https://image.tmdb.org/t/p'

export type PosterSize = 'w185' | 'w342' | 'w500' | 'w780' | 'original'
export type BackdropSize = 'w780' | 'w1280' | 'original'
export type ProfileSize = 'w45' | 'w185' | 'h632' | 'original'

export const posterUrl = (path?: string | null, size: PosterSize = 'w342') =>
  path ? `${BASE}/${size}${path}` : null

export const backdropUrl = (path?: string | null, size: BackdropSize = 'w1280') =>
  path ? `${BASE}/${size}${path}` : null

export const profileUrl = (path?: string | null, size: ProfileSize = 'w185') =>
  path ? `${BASE}/${size}${path}` : null

/** Local fallbacks, carried over from the old theme. */
export const PLACEHOLDER = {
  poster: '/img/featured-image-missing.svg',
  profile: '/img/watchlister-icon.svg',
  article: '/img/featured-image-missing.svg',
} as const

/** "2h 35m" from a raw minute count, matching the old single-movie template. */
export function formatRuntime(minutes?: number | null): string | null {
  if (!minutes || minutes <= 0) return null
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m}m`
  return `${h}h ${m}m`
}

export function year(date?: string | null): string | null {
  if (!date) return null
  const y = new Date(date).getFullYear()
  return Number.isFinite(y) ? String(y) : null
}

/**
 * Turn a video share URL into an embeddable one.
 *
 * The curated video essays are mostly YouTube, in a mix of youtube.com/watch?v=,
 * youtu.be/ and already-embedded forms, often with tracking parameters. A
 * handful are Vimeo — 5 of the 1,100 — which the old theme handled via
 * WordPress oEmbed, so they need explicit support here.
 *
 * Returns null for anything unrecognised, so callers can filter rather than
 * render a broken frame.
 */
export function videoEmbed(url?: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)

    if (u.hostname.includes('vimeo.com')) {
      // https://vimeo.com/135486928?embedded=true → player.vimeo.com/video/135486928
      const id = u.pathname.split('/').filter(Boolean)[0]
      return /^\d+$/.test(id ?? '') ? `https://player.vimeo.com/video/${id}` : null
    }

    if (u.hostname.includes('youtu.be') || u.hostname.includes('youtube.com')) {
      let id: string | null = null
      if (u.hostname.includes('youtu.be')) id = u.pathname.slice(1)
      else if (u.pathname.startsWith('/embed/')) id = u.pathname.split('/embed/')[1]
      else id = u.searchParams.get('v')

      if (!id) return null // e.g. a bare "https://youtu.be/" left in the old data
      id = id.split(/[/?&]/)[0]
      if (!id) return null

      /**
       * `enablejsapi=1` exposes the player to the JavaScript API, which is what
       * lets Tag Manager track plays and completions.
       *
       * The old WordPress theme did this with a filter on oEmbed output
       * (`add_enablejsapi_to_oembed_url`), and the GTM container still carries
       * tags that depend on it. Without the flag those tags fire against a
       * player that cannot answer, so video engagement silently reads as zero.
       */
      return `https://www.youtube.com/embed/${id}?enablejsapi=1`
    }

    return null
  } catch {
    return null
  }
}

/** @deprecated use videoEmbed — kept so older imports keep working */
export const youtubeEmbed = videoEmbed
