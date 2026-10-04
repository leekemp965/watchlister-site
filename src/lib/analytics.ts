import { createHash } from 'crypto'
import { Pool } from 'pg'

/**
 * First-party analytics: pageviews, searches and content interactions.
 *
 * Why this exists rather than reading numbers out of a hosted product:
 *
 *   - Cloudflare Web Analytics has no custom events at all, so it cannot see a
 *     video play, a podcast opened or an article clicked through. Two of the
 *     three things we actually want to know are simply outside what it reports.
 *   - It also cannot report search terms, because it records paths and the query
 *     is in the query string.
 *   - GA4 could do all of it, but its cookies need consent under PECR, and a
 *     banner typically costs 30-60% of your data to declines. Paying that for
 *     numbers we can collect ourselves is a poor trade.
 *
 * So this collects what we need directly, into the Postgres database already
 * holding the catalogue, and the daily digest reads from the same place.
 *
 * ## Why this needs no consent banner
 *
 * No cookie is set, nothing is written to localStorage, and no identifier
 * follows anyone between visits. `visitor` is a hash of IP address and user
 * agent together with a secret and *the current date* — so the same person
 * hashes to the same value for the rest of today and to a different one
 * tomorrow. That makes "unique visitors today" countable while making
 * cross-day tracking impossible, which is the standard cookieless approach.
 * The raw IP is never written to the database.
 *
 * If that property is ever weakened — a salt that stops rotating, a stored IP,
 * a visitor id that persists — the consent position changes with it. Treat the
 * daily rotation as load-bearing, not as a detail.
 */

/**
 * A dedicated pool rather than Payload's.
 *
 * Reaching the pool through `getPayloadClient()` would boot the whole Payload
 * config — every collection, hook and access rule — on each event. That is
 * acceptable for the digest, which runs once a day, and wasteful for an
 * endpoint hit on every pageview. Module scope means a warm serverless instance
 * reuses the connection.
 */
let pool: Pool | null = null
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 })
  return pool
}

/** The only event kinds accepted. Anything else is dropped at the endpoint. */
export const EVENT_KINDS = ['pageview', 'search', 'video', 'podcast', 'article'] as const
export type EventKind = (typeof EVENT_KINDS)[number]

export function isEventKind(v: unknown): v is EventKind {
  return typeof v === 'string' && (EVENT_KINDS as readonly string[]).includes(v)
}

/**
 * Obvious crawlers, dropped so that "popular pages" means popular with people.
 *
 * Deliberately not exhaustive — anything running a real browser engine will
 * execute the beacon and be counted, and no list fixes that. This removes the
 * bulk of the noise, which is declared bots fetching pages.
 */
const BOT = /bot|crawl|spider|slurp|bingpreview|headless|lighthouse|pingdom|curl|wget|python-requests|facebookexternalhit|preview|monitor|semrush|ahrefs|screaming/i

export function isBot(userAgent: string | null): boolean {
  if (!userAgent) return true // a browser always sends one; absence is automation
  return BOT.test(userAgent)
}

/**
 * A visitor identifier good for one day only.
 *
 * Truncated to 16 hex characters, which is far more than enough to avoid
 * collisions at this site's volume and leaves less material to attack than a
 * full digest. Rotating the salt daily is what keeps this out of scope for
 * consent; see the note at the top of this file.
 */
export function visitorHash(ip: string, userAgent: string, day = today()): string {
  const secret = process.env.PAYLOAD_SECRET ?? ''
  return createHash('sha256').update(`${day}:${secret}:${ip}:${userAgent}`).digest('hex').slice(0, 16)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * The client's address, as Vercel presents it.
 *
 * `x-forwarded-for` is a comma-separated chain and the client is the first
 * entry; taking the last would give us Vercel's own proxy and hash every
 * visitor to the same value. A missing header falls back to a constant, which
 * degrades unique counts rather than throwing — a broken header should not cost
 * us the event.
 */
export function clientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]!.trim()
  return headers.get('x-real-ip')?.trim() || 'unknown'
}

/** Strips the query string, enforces a leading slash, and bounds the length. */
export function normalisePath(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '/'
  const path = raw.split(/[?#]/)[0]!
  const withSlash = path.startsWith('/') ? path : `/${path}`
  return withSlash.slice(0, 512)
}

const clamp = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

export type IncomingEvent = {
  kind: EventKind
  path: string
  label?: string | null
  target?: string | null
  results?: number | null
}

/**
 * Writes one event. Never throws: analytics failing must not break a pageview
 * or, worse, surface as an error to the person reading the site.
 */
export async function recordEvent(e: IncomingEvent, visitor: string): Promise<void> {
  try {
    await db().query(
      `insert into analytics.events (kind, path, label, target, results, visitor)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        e.kind,
        normalisePath(e.path),
        clamp(e.label, 300),
        clamp(e.target, 1000),
        typeof e.results === 'number' && Number.isFinite(e.results)
          ? Math.max(0, Math.min(100000, Math.trunc(e.results)))
          : null,
        visitor,
      ],
    )
  } catch (err) {
    console.error('analytics: failed to record event', err)
  }
}

/* ------------------------------------------------------------------------- */
/* Reporting, for the daily digest                                            */
/* ------------------------------------------------------------------------- */

/**
 * One whole day, as a half-open range: `0` is today so far, `1` is yesterday.
 *
 * The daily email always wants yesterday, but being able to ask for today is
 * what makes the thing checkable — otherwise the only way to see whether a
 * change works is to wait until tomorrow morning.
 *
 * `offset` is interpolated into SQL, so it is forced to a bounded integer here
 * rather than trusted. `make_interval` takes an integer directly, which keeps
 * the arithmetic readable at both ends: offset 0 gives
 * `[current_date, current_date + 1 day)`.
 */
function dayWindow(offset: number): string {
  const n = Math.max(0, Math.min(3650, Math.trunc(Number(offset) || 0)))
  return `at >= current_date - make_interval(days => ${n}) and at < current_date - make_interval(days => ${n - 1})`
}

export type PopularPage = { path: string; label: string; views: number; visitors: number }
export type PopularSearch = { query: string; searches: number; results: number }
export type Interaction = { label: string; path: string; target: string | null; count: number }

export type AnalyticsReport = {
  collecting: boolean
  visitors: number
  pageviews: number
  popularPages: PopularPage[]
  popularSearches: PopularSearch[]
  emptySearches: PopularSearch[]
  interactions: { videos: number; podcasts: number; articles: number }
  topInteractions: Interaction[]
}

export async function buildAnalyticsReport(offsetDays = 1): Promise<AnalyticsReport> {
  const p = db()
  const W = dayWindow(offsetDays)

  const { rows: totals } = await p.query(`
    select
      (select count(distinct visitor) from analytics.events
        where kind = 'pageview' and ${W})::int visitors,
      (select count(*) from analytics.events
        where kind = 'pageview' and ${W})::int pageviews,
      (select count(*) from analytics.events where kind = 'video'   and ${W})::int videos,
      (select count(*) from analytics.events where kind = 'podcast' and ${W})::int podcasts,
      (select count(*) from analytics.events where kind = 'article' and ${W})::int articles,
      (select count(*) from analytics.events)::int ever
  `)
  const t = totals[0]

  const { rows: pages } = await p.query(`
    select path, count(*)::int views, count(distinct visitor)::int visitors
      from analytics.events
     where kind = 'pageview' and ${W}
     group by path order by views desc, path limit 10`)

  const { rows: searches } = await p.query(`
    select lower(label) query, count(*)::int searches, max(coalesce(results, 0))::int results
      from analytics.events
     where kind = 'search' and label is not null and ${W}
     group by lower(label) order by searches desc, query limit 10`)

  /**
   * Searches that found nothing are the most actionable number in the digest:
   * each one is somebody looking for something the catalogue does not hold.
   */
  const { rows: empty } = await p.query(`
    select lower(label) query, count(*)::int searches, 0 results
      from analytics.events
     where kind = 'search' and label is not null and ${W}
     group by lower(label)
    having max(coalesce(results, 0)) = 0
     order by searches desc, query limit 10`)

  const { rows: top } = await p.query(`
    select coalesce(label, target, '(untitled)') label, path, target, count(*)::int count
      from analytics.events
     where kind in ('video', 'podcast', 'article') and ${W}
     group by 1, 2, 3 order by count desc, label limit 10`)

  return {
    // Distinguishes "nobody visited yesterday" from "collection is not working",
    // which otherwise look identical in an email full of zeroes.
    collecting: t.ever > 0,
    visitors: t.visitors,
    pageviews: t.pageviews,
    popularPages: await withTitles(pages as Array<{ path: string; views: number; visitors: number }>),
    popularSearches: searches as PopularSearch[],
    emptySearches: empty as PopularSearch[],
    interactions: { videos: t.videos, podcasts: t.podcasts, articles: t.articles },
    topInteractions: top as Interaction[],
  }
}

/**
 * Turns `/movies/the-social-network-37799` into "The Social Network".
 *
 * A digest listing raw slugs is readable but tiring; the point of the section is
 * to be skimmed. Falls back to the path whenever a slug cannot be resolved,
 * which covers the static pages and anything since deleted.
 */
async function withTitles(
  pages: Array<{ path: string; views: number; visitors: number }>,
): Promise<PopularPage[]> {
  const lookups: Array<{ table: string; prefix: string }> = [
    { table: 'movies', prefix: '/movies/' },
    { table: 'tv_shows', prefix: '/tv-shows/' },
    { table: 'people', prefix: '/people/' },
    { table: 'posts', prefix: '/blog/' },
  ]

  const names = new Map<string, string>()

  for (const { table, prefix } of lookups) {
    const slugs = pages.filter((p) => p.path.startsWith(prefix)).map((p) => p.path.slice(prefix.length))
    if (!slugs.length) continue
    try {
      const { rows } = await db().query(
        `select slug, ${table === 'people' ? 'name' : 'title'} as name from ${table} where slug = any($1::text[])`,
        [slugs],
      )
      for (const r of rows) names.set(prefix + r.slug, String(r.name))
    } catch (err) {
      console.error(`analytics: could not resolve titles from ${table}`, err)
    }
  }

  // Posts also live at the root, to preserve the old WordPress permalinks.
  const rootSlugs = pages
    .filter((p) => p.path.split('/').filter(Boolean).length === 1 && !names.has(p.path))
    .map((p) => p.path.slice(1))
  if (rootSlugs.length) {
    try {
      const { rows } = await db().query(
        `select slug, title from posts where slug = any($1::text[])`,
        [rootSlugs],
      )
      for (const r of rows) names.set('/' + r.slug, String(r.title))
    } catch (err) {
      console.error('analytics: could not resolve root post titles', err)
    }
  }

  const STATIC: Record<string, string> = {
    '/': 'Home',
    '/search': 'Search',
    '/blog': 'Blog',
    '/movies': 'All films',
    '/tv-shows': 'All shows',
    '/people': 'All people',
  }

  return pages.map((p) => ({
    ...p,
    label: names.get(p.path) ?? STATIC[p.path] ?? p.path,
  }))
}

/**
 * Drops events older than the retention window.
 *
 * One row per pageview outgrows the catalogue itself given time, and the
 * database is on a metered plan. Six months is enough to compare a month
 * against the same month last quarter, which is as far back as a daily digest
 * is ever read. Run from the digest cron so it needs no schedule of its own.
 */
export async function pruneEvents(days = 180): Promise<number> {
  try {
    const { rowCount } = await db().query(
      `delete from analytics.events where at < now() - ($1 || ' days')::interval`,
      [String(days)],
    )
    return rowCount ?? 0
  } catch (err) {
    console.error('analytics: prune failed', err)
    return 0
  }
}
