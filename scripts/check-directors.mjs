/**
 * Why do ~14% of films have no director credit?
 *
 * Two candidate explanations: TMDB genuinely has no crew for obscure titles,
 * or the sync's job-name mapping is too narrow. This samples the affected
 * films and asks TMDB directly.
 *
 * Run with:  node --env-file=.env.local scripts/check-directors.mjs
 */
import pg from 'pg'

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

const { rows } = await c.query(`
  select m.tmdb_id, m.title, m.release_date, m.popularity
    from movies m
   where not exists (
     select 1 from credits cr where cr.movie_id = m.id and cr.role = 'director'
   )
   order by m.popularity desc nulls last
   limit 12
`)

console.log('Most popular films missing a director:\n')
for (const r of rows) {
  console.log(`  ${String(r.title).slice(0, 44).padEnd(46)} pop ${Number(r.popularity ?? 0).toFixed(1)}`)
}

// Ask TMDB what crew it actually holds for these.
const KEY = process.env.TMDB_API_KEY
const jobCounts = new Map()
let noCrewAtAll = 0

console.log('\nWhat TMDB actually lists as crew for those films:\n')
for (const r of rows) {
  const res = await fetch(
    `https://api.themoviedb.org/3/movie/${r.tmdb_id}/credits?api_key=${KEY}`,
  )
  if (!res.ok) continue
  const data = await res.json()
  const crew = data.crew ?? []
  if (crew.length === 0) noCrewAtAll++
  for (const p of crew) jobCounts.set(p.job, (jobCounts.get(p.job) ?? 0) + 1)
  console.log(
    `  ${String(r.title).slice(0, 34).padEnd(36)} crew ${String(crew.length).padStart(3)}  ` +
      `jobs: ${[...new Set(crew.map((p) => p.job))].slice(0, 5).join(', ') || '(none)'}`,
  )
}

console.log(`\nFilms with literally no crew on TMDB: ${noCrewAtAll} of ${rows.length}`)
console.log('\nMost common crew jobs across the sample:')
for (const [job, n] of [...jobCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(job).padEnd(30)} ${n}`)
}

await c.end()
