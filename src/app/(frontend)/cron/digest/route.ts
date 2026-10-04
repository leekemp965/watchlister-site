import { buildDigest, renderDigest, sendDigest } from '@/lib/digest'
import { pruneEvents } from '@/lib/analytics'

/**
 * The daily digest, sent by Vercel Cron.
 *
 * Deliberately not under /api — Payload owns /api/[...slug], and this project
 * has already been bitten twice by routes shadowing each other. A separate
 * segment avoids the question entirely.
 *
 * Without RESEND_API_KEY it returns the digest as JSON instead of sending,
 * which makes it testable before any email account exists.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: Request) {
  /**
   * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without this the
   * endpoint is world-callable — harmless in content terms, but anyone could
   * trigger email at will.
   */
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  const preview = new URL(req.url).searchParams.get('preview') === '1'

  if (secret && auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  /**
   * `?day=0` reports today so far instead of yesterday, for checking a change
   * without waiting for tomorrow's 08:00 run. The cron passes nothing and gets
   * yesterday.
   */
  const dayParam = new URL(req.url).searchParams.get('day')
  const offsetDays = dayParam === null ? 1 : Number(dayParam)

  const digest = await buildDigest(offsetDays)
  const { subject } = renderDigest(digest)

  /**
   * Retention, run here rather than on a schedule of its own: this is already a
   * once-a-day job, and one row per pageview outgrows the catalogue given time.
   * Skipped in preview so that checking the digest never deletes anything.
   */
  if (!preview) {
    const pruned = await pruneEvents()
    if (pruned) console.log(`digest: pruned ${pruned} analytics events past retention`)
  }

  const to = process.env.DIGEST_TO
  const key = process.env.RESEND_API_KEY

  // Preview mode, or not yet configured: show what would be sent.
  if (preview || !key || !to) {
    return Response.json({
      wouldSendTo: to ?? '(DIGEST_TO not set)',
      configured: Boolean(key && to),
      day: digest.date,
      subject,
      digest,
    })
  }

  const result = await sendDigest(digest)

  // Surfaced rather than swallowed: a digest that silently stops arriving is
  // indistinguishable from a quiet day.
  if (!result.sent) return Response.json(result, { status: 502 })

  return Response.json({ ...result, day: digest.date })
}
