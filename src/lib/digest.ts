import { getPayloadClient } from './queries'

/**
 * The daily digest: what analytics cannot tell you, plus anything waiting.
 *
 * Cloudflare covers visitors and pageviews. This covers the two things it
 * cannot see — how many title pages got built (a database event, with no
 * distinguishing pageview) and whether anyone has suggested content.
 */

export type Digest = {
  date: string
  built: { films: number; shows: number; people: number }
  submissions: { newToday: number; pending: number }
  totals: { films: number; shows: number; people: number; credits: number }
  pendingList: Array<{ title: string; type: string; url: string; on: string }>
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

  return {
    date: yesterday,
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

export function renderDigest(d: Digest): { subject: string; html: string; text: string } {
  const built = d.built.films + d.built.shows
  const subject = d.submissions.pending
    ? `Watchlister — ${d.submissions.pending} submission${d.submissions.pending === 1 ? '' : 's'} waiting`
    : `Watchlister — ${built} new page${built === 1 ? '' : 's'} yesterday`

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
    Visitor numbers are in
    <a href="https://dash.cloudflare.com">Cloudflare Web Analytics</a> — this covers
    what analytics cannot see.
  </p>
</div>`

  const text = [
    `Watchlister — ${d.date}`,
    ``,
    `Pages built yesterday: ${d.built.films} films, ${d.built.shows} shows, ${d.built.people} people`,
    `Submissions: ${d.submissions.newToday} new, ${d.submissions.pending} waiting`,
    ...d.pendingList.map((p) => `  · ${p.on} — ${p.type} — ${p.title} — ${p.url}`),
    ``,
    `Catalogue: ${d.totals.films} films, ${d.totals.shows} shows, ${d.totals.people} people`,
    `Review: https://watchlister.co/admin/collections/submissions`,
  ].join('\n')

  return { subject, html, text }
}
