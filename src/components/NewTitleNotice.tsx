'use client'

import { useEffect, useState } from 'react'

/**
 * Shown to whoever is first to open a title, immediately after it has been
 * imported from TMDB.
 *
 * Triggered by `?new=1` rather than a server prop, because the page is
 * ISR-cached: a prop set during the importing request would be baked into the
 * cached HTML and shown to every later visitor too. The import redirects here
 * with the flag, this reads it once, then strips it from the URL so a refresh
 * or a shared link does not show it again.
 */
export function NewTitleNotice({ title }: { title?: string | null }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('new') !== '1') return

    setVisible(true)

    // Clean the URL so refreshing or sharing does not repeat the message.
    params.delete('new')
    const qs = params.toString()
    window.history.replaceState(
      {},
      '',
      window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash,
    )

    const timer = setTimeout(() => setVisible(false), 12000)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-4 z-50 max-w-sm animate-[fadeIn_0.3s_ease-out]"
    >
      <div className="bg-cod-gray border-vermilion border-l-4 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-vermilion mb-1 font-semibold">You found something new</p>
            <p className="text-sm leading-relaxed text-gray-300">
              You&rsquo;re the first person to look for{' '}
              {title ? <span className="text-white">{title}</span> : 'this title'} on Watchlister,
              so we&rsquo;ve just built this page from scratch.
            </p>
          </div>
          <button
            onClick={() => setVisible(false)}
            aria-label="Dismiss"
            className="-mt-1 shrink-0 text-2xl leading-none text-gray-500 transition hover:text-white"
          >
            &times;
          </button>
        </div>
      </div>
    </div>
  )
}
