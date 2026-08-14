/**
 * Characterises the films TMDB holds no crew for, and checks how much of the
 * catalogue TMDB flags as adult.
 *
 * Run with:  node --env-file=.env.local scripts/check-adult.mjs
 */
import pg from 'pg'

const KEY = process.env.TMDB_API_KEY
const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

const sample = async (sql, n) => (await c.query(sql.replace('$N', String(n)))).rows

const noDirector = await sample(
  `select tmdb_id, title from movies m
    where not exists (select 1 from credits cr where cr.movie_id=m.id and cr.role='director')
    order by random() limit $N`,
  40,
)
const overall = await sample(`select tmdb_id, title from movies order by random() limit $N`, 40)

async function adultRate(rows, label) {
  let adult = 0
  let checked = 0
  const flagged = []
  for (const r of rows) {
    const res = await fetch(`https://api.themoviedb.org/3/movie/${r.tmdb_id}?api_key=${KEY}`)
    if (!res.ok) continue
    const d = await res.json()
    checked++
    if (d.adult) {
      adult++
      if (flagged.length < 4) flagged.push(d.title)
    }
  }
  const pct = checked ? ((adult / checked) * 100).toFixed(0) : '—'
  console.log(`${label.padEnd(34)} ${adult}/${checked} flagged adult (${pct}%)`)
  if (flagged.length) console.log(`   e.g. ${flagged.join(', ')}`)
  return { adult, checked }
}

console.log('Random samples, checked against TMDB\'s own adult flag:\n')
await adultRate(noDirector, 'Films with no director credit')
await adultRate(overall, 'The catalogue overall')

console.log('\nRandom titles from the no-director set:')
for (const r of noDirector.slice(0, 15)) console.log(`  ${r.title}`)

await c.end()
