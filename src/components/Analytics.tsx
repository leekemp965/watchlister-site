import Script from 'next/script'
import { GoogleAnalytics, GoogleTagManager } from '@next/third-parties/google'

/**
 * Analytics, loaded only when configured.
 *
 * Cloudflare Web Analytics is the default: it sets no cookies and stores no
 * personal data, so it needs no consent banner — which matters for a UK site,
 * where GA4's cookies require consent under PECR and a banner typically costs
 * 30-60% of your data to declines.
 *
 * The Google options remain wired for the case where funnels or ad attribution
 * are wanted later. Setting either brings the consent obligation back.
 *
 * Set at most one of:
 *   NEXT_PUBLIC_CF_BEACON_TOKEN   Cloudflare Web Analytics  (cookieless)
 *   NEXT_PUBLIC_GA_ID             GA4 measurement id        (needs consent)
 *   NEXT_PUBLIC_GTM_ID            Tag Manager container     (needs consent)
 */
export function Analytics() {
  const cfToken = process.env.NEXT_PUBLIC_CF_BEACON_TOKEN
  const gaId = process.env.NEXT_PUBLIC_GA_ID
  const gtmId = process.env.NEXT_PUBLIC_GTM_ID

  return (
    <>
      {cfToken && (
        <Script
          src="https://static.cloudflareinsights.com/beacon.min.js"
          strategy="afterInteractive"
          data-cf-beacon={JSON.stringify({ token: cfToken })}
        />
      )}
      {gtmId && <GoogleTagManager gtmId={gtmId} />}
      {gaId && <GoogleAnalytics gaId={gaId} />}
    </>
  )
}
