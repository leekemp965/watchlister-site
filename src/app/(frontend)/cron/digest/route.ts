import { buildDigest, renderDigest } from '@/lib/digest'

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

  const digest = await buildDigest()
  const { subject, html, text } = renderDigest(digest)

  const to = process.env.DIGEST_TO
  const key = process.env.RESEND_API_KEY
  const from = process.env.DIGEST_FROM ?? 'Watchlister <onboarding@resend.dev>'

  // Preview mode, or not yet configured: show what would be sent.
  if (preview || !key || !to) {
    return Response.json({
      wouldSendTo: to ?? '(DIGEST_TO not set)',
      configured: Boolean(key && to),
      subject,
      digest,
    })
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  })

  if (!res.ok) {
    const detail = await res.text()
    // Surfaced rather than swallowed: a digest that silently stops arriving is
    // indistinguishable from a quiet day.
    return Response.json({ sent: false, status: res.status, detail }, { status: 502 })
  }

  return Response.json({ sent: true, to, subject })
}
