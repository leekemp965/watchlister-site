import Image, { type ImageProps } from 'next/image'

/**
 * A TMDB image, served straight from their CDN without Vercel's optimiser.
 *
 * TMDB already publishes each image at fixed widths — w185, w342, w500, w780 —
 * and `src/lib/tmdb.ts` requests the size the layout actually needs. Passing
 * those through Next's optimiser re-encodes an image that is already
 * compressed and already the right dimensions, for no measurable gain.
 *
 * It is not free, either. Every distinct source image counts against Vercel's
 * optimisation quota, and a single film page carries 31 of them: a poster, a
 * backdrop and up to 30 cast headshots. Pre-warming 843 titles pushed roughly
 * 26,000 images through the optimiser and exhausted the allowance.
 *
 * Our own uploads — blog featured images, article thumbnails, ~222 files in R2
 * — still go through the optimiser via plain `next/image`. Those are arbitrary
 * dimensions and genuinely benefit, and there are few enough to be affordable.
 */
export function TmdbImage(props: ImageProps) {
  return <Image {...props} unoptimized />
}
