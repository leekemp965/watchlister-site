/**
 * Daily numbers that analytics cannot answer.
 *
 * Cloudflare (or GA4) can tell you unique visitors and pages viewed. It cannot
 * tell you how many *new* title pages got built, because that happens in the
 * database when someone opens a title nobody has looked for before — there is
 * no pageview that distinguishes it from any other.
 *
 * Run with:  npm run stats  [-- --days=14]
 */
import pg from 'pg'

const days = Number(
  (process.argv.find((a) => a.startsWith('--days=')) ?? '--days=14').split('=')[1],
)

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

const rows = await c.query(
  `with d as (
     select generate_series(
       (current_date - ($1::int - 1) * interval '1 day')::date,
       current_date,
       interval '1 day'
     )::date as day
   )
   select d.day,
          (select count(*) from movies   m where m.created_at::date = d.day)::int as films,
          (select count(*) from tv_shows t where t.created_at::date = d.day)::int as shows,
          (select count(*) from people   p where p.created_at::date = d.day)::int as people,
          (select count(*) from submissions s where s.created_at::date = d.day)::int as subs
     from d
    order by d.day`,
  [days],
)

const totals = await c.query(`
  select (select count(*) from movies)::int films,
         (select count(*) from tv_shows)::int shows,
         (select count(*) from people)::int people,
         (select count(*) from submissions where status = 'pending')::int pending`)

const t = totals.rows[0]
const fmt = (n) => (n === 0 ? '·' : String(n))

console.log(`
New pages built, last ${days} days
(a title page is created the first time someone opens a title we do not hold)

  date          films   shows  people   submissions`)

let f = 0
let s = 0
for (const r of rows.rows) {
  f += r.films
  s += r.shows
  console.log(
    `  ${r.day.toISOString().slice(0, 10)}  ${fmt(r.films).padStart(6)}${fmt(r.shows).padStart(8)}` +
      `${fmt(r.people).padStart(8)}${fmt(r.subs).padStart(14)}`,
  )
}

console.log(`
  ${days}-day total: ${f} films, ${s} shows

Catalogue now
  films        ${t.films.toLocaleString()}
  tv shows     ${t.shows.toLocaleString()}
  people       ${t.people.toLocaleString()}

Submissions awaiting review: ${t.pending}${t.pending ? '   →  https://watchlister.co/admin/collections/submissions' : ''}
`)

await c.end()
