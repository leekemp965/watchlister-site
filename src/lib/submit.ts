'use server'

import { getPayloadClient } from './queries'

/**
 * Accepts a reader's suggestion for a title.
 *
 * Nothing submitted here reaches the site. It lands in the Submissions
 * collection as `pending` and an editor decides. That is deliberate: the form
 * is public and unauthenticated, so auto-publishing would be an open door.
 */

export type SubmitState = { ok: boolean; message: string } | null

const ALLOWED = new Set(['video', 'podcast', 'article'])

export async function submitContribution(
  _prev: SubmitState,
  formData: FormData,
): Promise<SubmitState> {
  const get = (k: string) => String(formData.get(k) ?? '').trim()

  // Honeypot: a field hidden from people, irresistible to bots. Anything that
  // fills it gets a success message and is quietly dropped, so the bot has no
  // signal to adapt to.
  if (get('website')) return { ok: true, message: 'Thanks — we’ll take a look.' }

  const type = get('type')
  const url = get('url')
  const itemTitle = get('itemTitle')
  const note = get('note')
  const submitterName = get('submitterName')
  const submitterEmail = get('submitterEmail')
  const movieId = get('movieId')
  const tvShowId = get('tvShowId')

  if (!ALLOWED.has(type)) return { ok: false, message: 'Please choose what kind of thing it is.' }
  if (!itemTitle) return { ok: false, message: 'Please give it a title.' }
  if (!movieId && !tvShowId) return { ok: false, message: 'Something went wrong — please reload.' }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, message: 'That does not look like a valid link.' }
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, message: 'Links must start with http:// or https://.' }
  }

  // Crude but effective length guards — a genuine suggestion is not an essay.
  if (itemTitle.length > 200 || note.length > 2000 || url.length > 500) {
    return { ok: false, message: 'That is longer than we can accept.' }
  }

  try {
    const payload = await getPayloadClient()
    await payload.create({
      collection: 'submissions',
      data: {
        status: 'pending',
        type,
        url: parsed.toString(),
        itemTitle,
        note: note || undefined,
        submitterName: submitterName || undefined,
        submitterEmail: submitterEmail || undefined,
        ...(movieId ? { movie: Number(movieId) } : { tvShow: Number(tvShowId) }),
      } as never,
      // The submitter is anonymous, so this runs without a user; the
      // collection's access rules allow create and nothing else.
      overrideAccess: true,
    })

    return { ok: true, message: 'Thanks — we’ll take a look and add it if it fits.' }
  } catch {
    return { ok: false, message: 'Something went wrong saving that. Please try again.' }
  }
}
