import { NextResponse, type NextRequest } from 'next/server'

/**
 * Turns away commercial crawlers at the edge.
 *
 * ## Why this exists
 *
 * Opening a title we do not hold imports it from TMDB and writes a new page —
 * that is the point, and it is how the old WordPress site worked. The cost is
 * that a crawler walking links does the same thing, thousands of times, for
 * pages no person ever asked for. Between 30 September and 3 October roughly
 * 6,200 films were created this way: 1,798 then 2,315 then 1,942 in a day, then
 * nothing. A steady ~83 an hour for four days, scattered across the TMDB id
 * space, stopping dead when the link graph was exhausted. No audience behaves
 * like that.
 *
 * The only page that links to titles we do not hold is /search, which
 * robots.txt has disallowed from the start. So whatever did this read
 * robots.txt and ignored it, which rules out a polite crawler and rules out
 * fixing this politely.
 *
 * ## Why not a rate limit
 *
 * Considered and rejected. 83 imports an hour is indistinguishable from a
 * healthy day's organic growth, so any cap low enough to stop the crawl is low
 * enough to turn real visitors away. Rate limiting is the wrong instrument for
 * a slow, patient crawl.
 *
 * ## Why not block in the page
 *
 * The title routes are ISR-cached for thirty days, and reading a request header
 * inside a page — `headers()` — opts the whole route out of static rendering.
 * That would trade a crawler problem for a performance problem on every page.
 * Middleware runs before routing and costs the cached pages nothing.
 *
 * ## What this does and does not catch
 *
 * It catches crawlers that declare themselves. Anything presenting a browser
 * user agent gets through, and no list fixes that — the complete fix is to stop
 * importing during a page render at all and have the browser ask for the import
 * instead, since these crawlers do not run JavaScript. That is a larger change
 * to the on-demand flow and is not what this file does.
 *
 * Search engines are deliberately absent: Google, Bing, DuckDuckGo, Yandex,
 * Apple and the social-preview fetchers are all welcome, because being findable
 * is the entire point of the site. The list below is confined to SEO-tooling and
 * data-resale crawlers, which bring no traffic. AI training crawlers (GPTBot,
 * ClaudeBot, CCBot and the rest) are a separate decision and are not blocked
 * here.
 */
const BLOCKED = [
  'ahrefsbot',
  'semrushbot',
  'dotbot',
  'mj12bot',
  'blexbot',
  'dataforseobot',
  'barkrowler',
  'serpstatbot',
  'zoominfobot',
  'petalbot',
  'bytespider',
  'imagesiftbot',
  'magpie-crawler',
  'seekportbot',
  'megaindex',
  'linkdexbot',
  'spbot',
]

export default function proxy(request: NextRequest) {
  const ua = request.headers.get('user-agent')?.toLowerCase() ?? ''

  if (ua && BLOCKED.some((bot) => ua.includes(bot))) {
    /**
     * 403 rather than 404: honest about the refusal, and unlike a 404 it does
     * not invite a retry or suggest the URL is wrong. `noindex` keeps the
     * refusal itself out of any index that does reach it.
     */
    return new NextResponse('Not available to this crawler.\n', {
      status: 403,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'x-robots-tag': 'noindex, nofollow',
        'cache-control': 'no-store',
      },
    })
  }

  return NextResponse.next()
}

/**
 * Skips Next's internals and static files, so the check runs once per page
 * rather than once per asset. The admin is excluded as well — it is behind
 * authentication and no crawler reaches it.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon|admin|.*\\.(?:png|jpg|jpeg|svg|ico|webp|txt|xml|woff2?)$).*)'],
}
