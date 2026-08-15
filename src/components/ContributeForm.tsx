'use client'

import { useActionState } from 'react'
import { submitContribution, type SubmitState } from '@/lib/submit'

/**
 * Lets a reader suggest something for a title.
 *
 * Aimed at the ~95% of titles carrying no editorial content: TMDB gives the
 * facts, but the video essays and podcasts that make a page worth visiting
 * were all added by hand, and there are only 405 of those across 7,455 titles.
 *
 * Submissions are queued for review, never published directly.
 */
export function ContributeForm({
  movieId,
  tvShowId,
  titleName,
}: {
  movieId?: number | string
  tvShowId?: number | string
  titleName: string
}) {
  const [state, action, pending] = useActionState<SubmitState, FormData>(
    submitContribution,
    null,
  )

  if (state?.ok) {
    return (
      <section id="contribute" className="my-12 scroll-mt-8">
        <div className="bg-cod-gray border-vermilion border-l-4 p-8">
          <h2 className="text-vermilion mb-2 text-2xl font-semibold">Thank you</h2>
          <p className="text-gray-300">{state.message}</p>
        </div>
      </section>
    )
  }

  return (
    <section id="contribute" className="my-12 scroll-mt-8">
      <div className="bg-cod-gray p-8">
        <h2 className="text-vermilion mb-2 text-2xl font-semibold">
          Know something about {titleName}?
        </h2>
        <p className="mb-6 max-w-2xl text-gray-400">
          If you have come across a video essay, a breakdown, a podcast episode or a piece of
          writing worth reading about this title, tell us and we will add it to this page.
        </p>

        <form action={action} className="max-w-2xl space-y-4">
          {movieId ? (
            <input type="hidden" name="movieId" value={String(movieId)} />
          ) : (
            <input type="hidden" name="tvShowId" value={String(tvShowId)} />
          )}

          {/* Honeypot — hidden from people, filled in by bots. */}
          <div aria-hidden="true" className="absolute -left-[9999px]">
            <label htmlFor="website">Website</label>
            <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <label htmlFor="type" className="mb-1 block text-sm font-medium">
                What is it?
              </label>
              <select
                id="type"
                name="type"
                required
                defaultValue="video"
                className="focus:border-vermilion w-full border border-gray-700 bg-gray-950 px-3 py-2 text-white focus:outline-none"
              >
                <option value="video">Video</option>
                <option value="podcast">Podcast</option>
                <option value="article">Article</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="itemTitle" className="mb-1 block text-sm font-medium">
                Title
              </label>
              <input
                id="itemTitle"
                name="itemTitle"
                type="text"
                required
                maxLength={200}
                placeholder="e.g. Why Dune's Editing Feels Different"
                className="focus:border-vermilion w-full border border-gray-700 bg-gray-950 px-3 py-2 text-white placeholder-gray-600 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="url" className="mb-1 block text-sm font-medium">
              Link
            </label>
            <input
              id="url"
              name="url"
              type="url"
              required
              maxLength={500}
              placeholder="https://…"
              className="focus:border-vermilion w-full border border-gray-700 bg-gray-950 px-3 py-2 text-white placeholder-gray-600 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="note" className="mb-1 block text-sm font-medium">
              Anything else? <span className="font-normal text-gray-500">Optional</span>
            </label>
            <textarea
              id="note"
              name="note"
              rows={3}
              maxLength={2000}
              className="focus:border-vermilion w-full border border-gray-700 bg-gray-950 px-3 py-2 text-white focus:outline-none"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="submitterName" className="mb-1 block text-sm font-medium">
                Your name <span className="font-normal text-gray-500">Optional</span>
              </label>
              <input
                id="submitterName"
                name="submitterName"
                type="text"
                maxLength={100}
                className="focus:border-vermilion w-full border border-gray-700 bg-gray-950 px-3 py-2 text-white focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="submitterEmail" className="mb-1 block text-sm font-medium">
                Email <span className="font-normal text-gray-500">Optional</span>
              </label>
              <input
                id="submitterEmail"
                name="submitterEmail"
                type="email"
                maxLength={200}
                className="focus:border-vermilion w-full border border-gray-700 bg-gray-950 px-3 py-2 text-white focus:outline-none"
              />
            </div>
          </div>

          {state && !state.ok && (
            <p role="alert" className="text-sm text-amber-400">
              {state.message}
            </p>
          )}

          <div className="flex items-center gap-4 pt-2">
            <button
              type="submit"
              disabled={pending}
              className="bg-vermilion px-6 py-3 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {pending ? 'Sending…' : 'Send it in'}
            </button>
            <p className="text-xs text-gray-500">
              Reviewed before anything appears. Your email is only used to follow up.
            </p>
          </div>
        </form>
      </div>
    </section>
  )
}
