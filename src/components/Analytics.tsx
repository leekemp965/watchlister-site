import { GoogleAnalytics, GoogleTagManager } from '@next/third-parties/google'

/**
 * Analytics, loaded only when configured.
 *
 * Supports either route, because the old site ran Google Tag Manager
 * (container GTM-TJZDDM6X) rather than GA4 directly. If that container still
 * exists and has tags configured in it, reusing it keeps them; otherwise a
 * plain GA4 measurement id is simpler.
 *
 * Set one of:
 *   NEXT_PUBLIC_GA_ID   G-XXXXXXXXXX   GA4 measurement id
 *   NEXT_PUBLIC_GTM_ID  GTM-XXXXXXX    Tag Manager container
 *
 * Setting neither renders nothing at all — no script, no cookies — which is
 * what happens in development.
 *
 * These use @next/third-parties, which loads the tag after hydration so it
 * does not compete with the page for bandwidth. The old WordPress theme
 * injected GTM as a blocking script in <head>.
 */
export function Analytics() {
  const gaId = process.env.NEXT_PUBLIC_GA_ID
  const gtmId = process.env.NEXT_PUBLIC_GTM_ID

  return (
    <>
      {gtmId && <GoogleTagManager gtmId={gtmId} />}
      {gaId && <GoogleAnalytics gaId={gaId} />}
    </>
  )
}
