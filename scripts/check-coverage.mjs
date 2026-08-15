/**
 * How much of the film world is actually in the catalogue?
 *
 * The catalogue is whatever the old site's bulk importer happened to pull, not
 * a systematic slice of anything. This samples TMDB's most popular and
 * best-rated films and reports how many are missing, so the size of the gap is
 * a number rather than an anecdote.
 *
 * Run with:  node --env-file=.env.local scripts/check-coverage.mjs
 */
import pg from 'pg'

const KEY = process.env.TMDB_API_KEY
const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

const held = new Set(
  (await c.query('select tmdb_id from movies')).rows.map((r) => Number(r.tmdb_id)),
)
console.log(`Catalogue holds ${held.size.toLocaleString()} films.\n`)

async function sample(label, path, pages = 5) {
  const missing = []
  let total = 0

  for (let page = 1; page <= pages; page++) {
    const url = new URL(`https://api.themoviedb.org/3${path}`)
    url.searchParams.set('api_key', KEY)
    url.searchParams.set('page', String(page))
    url.searchParams.set('include_adult', 'false')
    const res = await fetch(url)
    if (!res.ok) break
    const data = await res.json()
    for (const m of data.results ?? []) {
      total++
      if (!held.has(m.id)) missing.push(`${m.title} (${(m.release_date ?? '').slice(0, 4)})`)
    }
  }

  const pct = total ? ((missing.length / total) * 100).toFixed(0) : '—'
  console.log(`${label}`)
  console.log(`  checked ${total}, missing ${missing.length} (${pct}%)`)
  console.log(`  e.g. ${missing.slice(0, 6).join(' · ')}\n`)
  return { total, missing: missing.length }
}

const popular = await sample('TMDB most popular', '/movie/popular')
const topRated = await sample('TMDB best rated', '/movie/top_rated')
const nowPlaying = await sample('In cinemas now', '/movie/now_playing', 3)

const totals = [popular, topRated, nowPlaying].reduce(
  (a, b) => ({ total: a.total + b.total, missing: a.missing + b.missing }),
  { total: 0, missing: 0 },
)
console.log(
  `Overall: ${totals.missing} of ${totals.total} sampled films are missing ` +
    `(${((totals.missing / totals.total) * 100).toFixed(0)}%).`,
)

await c.end()
