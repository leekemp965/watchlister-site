'use client'

import { useEffect, useState } from 'react'

/**
 * Invites the reader to add something, on titles that have nothing yet.
 *
 * 405 of 7,455 titles carry editorial content — so this is the state of about
 * 95% of pages, which makes restraint important:
 *
 *   - It never appears alongside the "you found something new" notice. A
 *     freshly imported page qualifies for both, and two popups at once is
 *     worse than either alone, so that one wins and this waits for a later
 *     visit.
 *   - It appears once per title per session. Nagging on every page view of an
 *     empty catalogue would be intolerable.
 *   - It waits a few seconds, so it arrives after the reader has looked at the
 *     page rather than over the top of it.
 */
export function ContributeNotice({ titleName, storageKey }: { titleName: string; storageKey: string }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // The new-title notice owns this moment; stand down.
    if (new URLSearchParams(window.location.search).get('new') === '1') return

    const key = `wl-contribute-seen:${storageKey}`
    try {
      if (sessionStorage.getItem(key)) return
    } catch {
      // Private browsing can throw on sessionStorage; showing it is harmless.
    }

    const timer = setTimeout(() => {
      setVisible(true)
      try {
        sessionStorage.setItem(key, '1')
      } catch {
        /* ignore */
      }
    }, 4000)

    return () => clearTimeout(timer)
  }, [storageKey])

  if (!visible) return null

  const goToForm = () => {
    setVisible(false)
    document.getElementById('contribute')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-4 z-50 max-w-sm animate-[fadeIn_0.3s_ease-out]"
    >
      <div className="bg-cod-gray border-vermilion border-l-4 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-vermilion mb-1 font-semibold">Nothing here yet</p>
            <p className="mb-3 text-sm leading-relaxed text-gray-300">
              Nobody has added anything about{' '}
              <span className="text-white">{titleName}</span> yet. If you know of a video essay,
              podcast or article worth reading, we would love to include it.
            </p>
            <button
              onClick={goToForm}
              className="bg-vermilion px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Add something
            </button>
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
