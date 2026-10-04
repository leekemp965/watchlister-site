'use client'

import { useEffect, useRef } from 'react'
import { track } from './Collect'

/**
 * Records one search, with how many results it found.
 *
 * Separate from the pageview that <Collect> already sends for /search, because
 * the interesting part is the query and the result count rather than the visit.
 * Searches returning nothing are the most useful number in the digest — each is
 * someone looking for something the catalogue does not hold.
 *
 * Reported from the client rather than the server component so that crawlers and
 * scripted fetches, which do not run JavaScript, stay out of the figures.
 */
export function TrackSearch({ query, results }: { query: string; results: number }) {
  const sent = useRef<string | null>(null)

  useEffect(() => {
    // Guard against React's development double-invoke, and against a re-render
    // logging the same query twice.
    const key = `${query}:${results}`
    if (sent.current === key) return
    sent.current = key

    if (!query.trim()) return
    track({ kind: 'search', path: '/search', label: query, results })
  }, [query, results])

  return null
}
