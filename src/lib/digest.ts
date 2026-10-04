import { getPayloadClient } from './queries'
import { buildAnalyticsReport, type AnalyticsReport } from './analytics'

/**
 * The daily digest: yesterday's numbers, plus anything waiting on you.
 *
 * Originally this deliberately covered only what a hosted analytics product
 * cannot see — how many title pages got built, and whether anyone has suggested
 * content — and linked out to Cloudflare for visitors and pageviews. That split
 * turned out to be a mistake twice over: the Cloudflare beacon token was
 * truncated on the way in and so collected nothing for weeks without ever
 * failing loudly, and Cloudflare has no custom events, so it could never have
 * reported video plays or article click-throughs anyway.
 *
 * It now reads everything from our own tables, so the email is self-contained
 * and there is one place for a number to be wrong.
 */

export type Digest = {
  date: string
  built: { films: number; shows: number; people: number }
  submissions: { newToday: number; pending: number }
  totals: { films: number; shows: number; people: number; credits: number }
  pendingList: Array<{ title: string; type: string; url: string; on: string }>
  analytics: AnalyticsReport
}

export async function buildDigest(): Promise<Digest> {
  const payload = await getPayloadClient()
  const pool = (payload.db as unknown as { pool: { query: Function } }).pool

  const { rows } = await pool.query(`
    select
      (select count(*) from movies      where created_at >= current_date - interval '1 day' and created_at < current_date)::int films,
      (select count(*) from tv_shows    where created_at >= current_date - interval '1 day' and created_at < current_date)::int shows,
      (select count(*) from people      where created_at >= current_date - interval '1 day' and created_at < current_date)::int people,
      (select count(*) from submissions where created_at >= current_date - interval '1 day' and created_at < current_date)::int subs_new,
      (select count(*) from submissions where status = 'pending')::int subs_pending,
      (select count(*) from movies)::int t_films,
      (select count(*) from tv_shows)::int t_shows,
      (select count(*) from people)::int t_people,
      (select count(*) from credits)::int t_credits
  `)
  const r = rows[0]

  const pending = await pool.query(`
    select s.item_title, s.type, s.url, s.created_at,
           coalesce(m.title, t.title) as for_title
      from submissions s
      left join movies m on s.movie_id = m.id
      left join tv_shows t on s.tv_show_id = t.id
     where s.status = 'pending'
     order by s.created_at desc
     limit 20`)

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

  /**
   * Analytics must not be able to take the digest down with it. If the events
   * table is missing or a query fails, the submissions and catalogue sections
   * are still worth sending, so this degrades to an empty report rather than
   * throwing.
   */
  const analytics = await buildAnalyticsReport().catch((err): AnalyticsReport => {
    console.error('digest: analytics unavailable', err)
    return {
      collecting: false,
      visitors: 0,
      pageviews: 0,
      popularPages: [],
      popularSearches: [],
      emptySearches: [],
      interactions: { videos: 0, podcasts: 0, articles: 0 },
      topInteractions: [],
    }
  })

  return {
    date: yesterday,
    analytics,
    built: { films: r.films, shows: r.shows, people: r.people },
    submissions: { newToday: r.subs_new, pending: r.subs_pending },
    totals: { films: r.t_films, shows: r.t_shows, people: r.t_people, credits: r.t_credits },
    pendingList: pending.rows.map((p: Record<string, unknown>) => ({
      title: String(p.item_title),
      type: String(p.type),
      url: String(p.url),
      on: String(p.for_title ?? 'unknown title'),
    })),
  }
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A two-or-three column table, or a quiet line when there is nothing to show. */
function table(rows: string[], empty: string): string {
  return rows.length
    ? `<table style="border-collapse:collapse;font-size:14px;margin:0 0 20px;width:100%">${rows.join('')}</table>`
    : `<p style="color:#666;margin:0 0 20px">${empty}</p>`
}

const num = (n: number) => n.toLocaleString('en-GB')

/** `plural(1, 'view')` → "1 view"; `plural(3, 'view')` → "3 views". */
const plural = (n: number, word: string, plural = `${word}s`) =>
  `${num(n)} ${n === 1 ? word : plural}`

export function renderDigest(d: Digest): { subject: string; html: string; text: string } {
  const built = d.built.films + d.built.shows
  const a = d.analytics

  const subject = d.submissions.pending
    ? `Watchlister — ${d.submissions.pending} submission${d.submissions.pending === 1 ? '' : 's'} waiting`
    : `Watchlister — ${num(a.visitors)} visitor${a.visitors === 1 ? '' : 's'}, ${built} new page${built === 1 ? '' : 's'}`

  const pageRows = a.popularPages.map(
    (p) =>
      `<tr>
         <td style="padding:6px 12px 6px 0"><a href="https://watchlister.co${esc(p.path)}" style="color:#111">${esc(p.label)}</a></td>
         <td style="padding:6px 0;text-align:right;white-space:nowrap">${plural(p.views, 'view')} <span style="color:#888">· ${plural(p.visitors, 'person', 'people')}</span></td>
       </tr>`,
  )

  const searchRows = a.popularSearches.map(
    (s) =>
      `<tr>
         <td style="padding:6px 12px 6px 0"><a href="https://watchlister.co/search?q=${encodeURIComponent(s.query)}" style="color:#111">${esc(s.query)}</a></td>
         <td style="padding:6px 0;text-align:right;white-space:nowrap">${num(s.searches)}${s.results === 0 ? ' <span style="color:#b45309">· nothing found</span>' : ''}</td>
       </tr>`,
  )

  const emptyRows = a.emptySearches.map(
    (s) =>
      `<tr>
         <td style="padding:6px 12px 6px 0">${esc(s.query)}</td>
         <td style="padding:6px 0;text-align:right;white-space:nowrap">${num(s.searches)}×</td>
       </tr>`,
  )

  const interactionRows = a.topInteractions.map(
    (i) =>
      `<tr>
         <td style="padding:6px 12px 6px 0">${esc(i.label)}</td>
         <td style="padding:6px 12px 6px 0;color:#888"><a href="https://watchlister.co${esc(i.path)}" style="color:#888">${esc(i.path)}</a></td>
         <td style="padding:6px 0;text-align:right">${num(i.count)}</td>
       </tr>`,
  )

  const rows = d.pendingList
    .map(
      (p) =>
        `<tr><td style="padding:6px 12px 6px 0">${esc(p.on)}</td><td style="padding:6px 12px 6px 0">${esc(p.type)}</td><td style="padding:6px 0"><a href="${esc(p.url)}">${esc(p.title)}</a></td></tr>`,
    )
    .join('')

  const html = `<!doctype html><meta charset="utf-8">
<div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;color:#111">
  <h2 style="margin:0 0 4px">Watchlister</h2>
  <p style="color:#666;margin:0 0 20px">${d.date}</p>

  ${
    a.collecting
      ? `<h3 style="margin:0 0 8px">Visitors</h3>
         <p style="margin:0 0 20px;font-size:18px">
           <strong>${num(a.visitors)}</strong> unique · <strong>${num(a.pageviews)}</strong> page view${a.pageviews === 1 ? '' : 's'}
         </p>

         <h3 style="margin:0 0 8px">Most popular pages</h3>
         ${table(pageRows, 'No page views recorded.')}

         <h3 style="margin:0 0 8px">Most popular searches</h3>
         ${table(searchRows, 'Nobody searched.')}

         ${
           emptyRows.length
             ? `<h3 style="margin:0 0 4px">Searches that found nothing</h3>
                <p style="color:#666;font-size:13px;margin:0 0 8px">
                  People looking for something the catalogue does not hold — the clearest signal of what to add next.
                </p>
                ${table(emptyRows, '')}`
             : ''
         }

         <h3 style="margin:0 0 8px">Interactions</h3>
         <p style="margin:0 0 8px">
           ${num(a.interactions.videos)} video${a.interactions.videos === 1 ? '' : 's'} played ·
           ${num(a.interactions.podcasts)} podcast${a.interactions.podcasts === 1 ? '' : 's'} opened ·
           ${num(a.interactions.articles)} article${a.interactions.articles === 1 ? '' : 's'} clicked
         </p>
         ${table(interactionRows, 'Nothing was played or clicked.')}`
      : `<h3 style="margin:0 0 8px">Visitors</h3>
         <p style="color:#b45309;margin:0 0 20px">
           No analytics events have ever been recorded. Either collection is not
           deployed yet, or the <code>analytics.events</code> table is missing —
           this is not the same as a quiet day.
         </p>`
  }

  <h3 style="margin:0 0 8px">Pages built yesterday</h3>
  <p style="margin:0 0 4px">${d.built.films} films · ${d.built.shows} shows · ${d.built.people} people</p>
  <p style="color:#666;font-size:13px;margin:0 0 20px">
    A page is built the first time someone opens a title we do not already hold.
  </p>

  <h3 style="margin:0 0 8px">Submissions</h3>
  <p style="margin:0 0 8px">${d.submissions.newToday} new · <strong>${d.submissions.pending} waiting for review</strong></p>
  ${
    rows
      ? `<table style="border-collapse:collapse;font-size:14px;margin:0 0 12px">${rows}</table>
         <p style="margin:0 0 20px"><a href="https://watchlister.co/admin/collections/submissions">Review them</a></p>`
      : '<p style="color:#666;margin:0 0 20px">Nothing waiting.</p>'
  }

  <h3 style="margin:0 0 8px">Catalogue</h3>
  <p style="margin:0 0 20px">${d.totals.films.toLocaleString()} films · ${d.totals.shows.toLocaleString()} shows · ${d.totals.people.toLocaleString()} people · ${d.totals.credits.toLocaleString()} credits</p>

  <p style="color:#666;font-size:12px">
    Collected first-party, without cookies. Nobody is identified and nothing
    follows anyone between days.
  </p>
</div>`

  const text = [
    `Watchlister — ${d.date}`,
    ``,
    ...(a.collecting
      ? [
          `Visitors: ${a.visitors} unique, ${a.pageviews} page views`,
          ``,
          `Most popular pages:`,
          ...a.popularPages.map(
            (p) => `  · ${p.label} — ${plural(p.views, 'view')}, ${plural(p.visitors, 'person', 'people')}`,
          ),
          ``,
          `Most popular searches:`,
          ...a.popularSearches.map(
            (s) => `  · ${s.query} — ${s.searches}${s.results === 0 ? ' (nothing found)' : ''}`,
          ),
          ...(a.emptySearches.length
            ? [
                ``,
                `Searches that found nothing:`,
                ...a.emptySearches.map((s) => `  · ${s.query} — ${s.searches}×`),
              ]
            : []),
          ``,
          `Interactions: ${plural(a.interactions.videos, 'video')} played, ${plural(a.interactions.podcasts, 'podcast')} opened, ${plural(a.interactions.articles, 'article')} clicked`,
          ...a.topInteractions.map((i) => `  · ${i.label} — ${i.count} (${i.path})`),
          ``,
        ]
      : [`Visitors: no analytics events have ever been recorded — collection may not be live.`, ``]),
    `Pages built yesterday: ${d.built.films} films, ${d.built.shows} shows, ${d.built.people} people`,
    `Submissions: ${d.submissions.newToday} new, ${d.submissions.pending} waiting`,
    ...d.pendingList.map((p) => `  · ${p.on} — ${p.type} — ${p.title} — ${p.url}`),
    ``,
    `Catalogue: ${d.totals.films} films, ${d.totals.shows} shows, ${d.totals.people} people`,
    `Review: https://watchlister.co/admin/collections/submissions`,
  ].join('\n')

  return { subject, html, text }
}
