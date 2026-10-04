import {
  clientIp,
  isBot,
  isEventKind,
  recordEvent,
  visitorHash,
  type IncomingEvent,
} from '@/lib/analytics'

/**
 * The analytics collection endpoint.
 *
 * Not under /api: Payload owns `/api/[...slug]` and would try to resolve
 * `collect` as one of its collections.
 *
 * Nothing here is cacheable and every request must execute.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Always 204, whatever happened.
 *
 * This endpoint is called by a fire-and-forget beacon that cannot read the
 * response and would not act on it if it could. Returning detail would only
 * tell someone probing the endpoint which of their guesses was closer, so
 * acceptance, rejection and failure are indistinguishable from outside.
 */
const noContent = () => new Response(null, { status: 204 })

export async function POST(request: Request) {
  /**
   * Read from the request rather than next/headers: identical content, and it
   * keeps this handler a plain function of its Request, so it can be exercised
   * directly by scripts/check-collect.ts without standing a server up.
   */
  const h = request.headers

  /**
   * Same-origin only.
   *
   * `sendBeacon` and `fetch` both send Origin, so a real browser on our own
   * pages always satisfies this, while a script posting from anywhere else does
   * not. It is not a security boundary — Origin is trivially forged outside a
   * browser — but it costs nothing and removes casual cross-site noise.
   *
   * A missing Origin is rejected rather than allowed: our own beacon always
   * sends one, so absence means the caller is not a browser on this site.
   */
  const origin = h.get('origin')
  const host = h.get('host')
  if (!origin || !host) return noContent()
  try {
    if (new URL(origin).host !== host) return noContent()
  } catch {
    return noContent()
  }

  const userAgent = h.get('user-agent')
  if (isBot(userAgent)) return noContent()

  /**
   * Bounded read.
   *
   * Without a limit, a single request could stream until the function times out.
   * Every legitimate event is a few hundred bytes; 4 KB is generous.
   */
  let body: unknown
  try {
    const text = await request.text()
    if (text.length > 4096) return noContent()
    body = JSON.parse(text)
  } catch {
    return noContent()
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return noContent()
  const raw = body as Record<string, unknown>

  // The allowlist is the whole of the authorisation here: an unrecognised kind
  // is dropped rather than stored, so the table cannot be used as scratch space.
  if (!isEventKind(raw.kind)) return noContent()

  const event: IncomingEvent = {
    kind: raw.kind,
    path: typeof raw.path === 'string' ? raw.path : '/',
    label: typeof raw.label === 'string' ? raw.label : null,
    target: typeof raw.target === 'string' ? raw.target : null,
    results: typeof raw.results === 'number' ? raw.results : null,
  }

  // The IP is used to derive the daily visitor hash and is not stored.
  const visitor = visitorHash(clientIp(h), userAgent ?? '')

  await recordEvent(event, visitor)
  return noContent()
}

/** Anything other than POST gets the same silence. */
export async function GET() {
  return noContent()
}
