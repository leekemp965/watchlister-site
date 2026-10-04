'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

/**
 * The analytics beacon: pageviews, content interactions and video plays.
 *
 * Collection is client-side rather than server-side for two reasons. Title pages
 * are cached by ISR for thirty days, so on a cache hit no server code runs at
 * all and a server-side counter would record a small fraction of real traffic.
 * And requiring JavaScript filters out the declared crawlers and scripted
 * fetches that would otherwise dominate "popular pages".
 *
 * See src/lib/analytics.ts for why this is cookieless and needs no consent
 * banner.
 */

type Payload = {
  kind: 'pageview' | 'search' | 'video' | 'podcast' | 'article'
  path: string
  label?: string | null
  target?: string | null
  results?: number | null
}

/**
 * Fire and forget.
 *
 * `sendBeacon` is the right primitive: the browser takes ownership of the
 * request, so it still completes when the click that triggered it navigates the
 * page away — which is exactly what happens for every outbound podcast and
 * article link. `fetch` with `keepalive` is the fallback for anything without
 * it.
 */
function send(payload: Payload): void {
  try {
    const body = JSON.stringify(payload)
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/collect', new Blob([body], { type: 'application/json' }))
      return
    }
    void fetch('/collect', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Analytics must never break the page.
  }
}

/** Exported so the search page can report its query and result count. */
export function track(payload: Payload): void {
  send(payload)
}

declare global {
  interface Window {
    YT?: { Player: new (el: Element, opts: Record<string, unknown>) => unknown }
    onYouTubeIframeAPIReady?: () => void
  }
}

export function Collect() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  /** Videos already counted on this page, so scrubbing does not inflate plays. */
  const counted = useRef<Set<string>>(new Set())
  const wired = useRef<WeakSet<Element>>(new WeakSet())

  /* Pageviews ------------------------------------------------------------- */
  useEffect(() => {
    counted.current = new Set()
    send({ kind: 'pageview', path: pathname })
    // searchParams is a dependency so that /search?q=… counts each new query as
    // its own view; the path recorded is still just /search.
  }, [pathname, searchParams])

  /* Podcast and article clicks -------------------------------------------- */
  useEffect(() => {
    /**
     * One delegated listener on the document rather than props threaded through
     * every rail. The rails are server components and the links are plain
     * anchors; marking them with data attributes keeps them that way instead of
     * turning each one into a client component.
     *
     * Capture phase, because the click navigates away and a bubbling listener
     * can lose the race on a cross-document navigation.
     */
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-track-kind]')
      if (!el) return
      const kind = el.getAttribute('data-track-kind')
      if (kind !== 'podcast' && kind !== 'article') return
      send({
        kind,
        path: pathname,
        label: el.getAttribute('data-track-label'),
        target: el.getAttribute('href'),
      })
    }

    document.addEventListener('click', onClick, { capture: true })
    return () => document.removeEventListener('click', onClick, { capture: true })
  }, [pathname])

  /* Video plays ----------------------------------------------------------- */
  useEffect(() => {
    /**
     * YouTube's IFrame Player API.
     *
     * A click inside a cross-origin iframe is invisible to the page, so the only
     * way to know a video was played is to ask YouTube. The embeds already carry
     * `enablejsapi=1` — the old WordPress theme added it so Tag Manager could
     * track plays, and that survived the migration — so they are ready to be
     * attached to without changing any markup or how they look.
     *
     * The five Vimeo embeds in the catalogue, against 1,095 YouTube ones, are
     * not covered; a second SDK is not worth 0.5% of the videos.
     */
    const wire = () => {
      if (!window.YT?.Player) return
      const frames = document.querySelectorAll<HTMLIFrameElement>(
        'iframe[src*="youtube.com/embed/"]',
      )
      frames.forEach((frame) => {
        if (wired.current.has(frame)) return
        wired.current.add(frame)

        const id = frame.src.split('/embed/')[1]?.split(/[?&]/)[0] ?? frame.src
        const label = frame.getAttribute('title') || 'Video'

        try {
          new window.YT!.Player(frame, {
            events: {
              onStateChange: (e: { data: number }) => {
                // 1 is PLAYING. Counted once per video per page view.
                if (e.data !== 1 || counted.current.has(id)) return
                counted.current.add(id)
                send({ kind: 'video', path: pathname, label, target: id })
              },
            },
          })
        } catch {
          // A player that refuses to attach costs us one video's data, nothing more.
        }
      })
    }

    if (!document.querySelector('iframe[src*="youtube.com/embed/"]')) return

    if (window.YT?.Player) {
      wire()
    } else {
      /**
       * The API calls a single global when it loads, so chain rather than
       * overwrite — on a client-side navigation this effect can run again while
       * a previous script tag is still in flight.
       */
      const previous = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        previous?.()
        wire()
      }

      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const script = document.createElement('script')
        script.src = 'https://www.youtube.com/iframe_api'
        script.async = true
        document.head.appendChild(script)
      }
    }

    /**
     * Lazily-loaded iframes are in the DOM but not yet loaded, and the rails
     * scroll horizontally, so more appear as the reader moves along them. A
     * mutation observer catches those without polling.
     */
    const observer = new MutationObserver(() => wire())
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [pathname])

  return null
}
