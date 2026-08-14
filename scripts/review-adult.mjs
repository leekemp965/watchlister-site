/**
 * Review pass before deleting anything.
 *
 * The adult flag is imperfect, so this hunts for false positives — legitimate
 * films caught by it — using three signals:
 *   1. titles you wrote editorial content about (strongest signal: curated by hand)
 *   2. flagged films that do have crew credits (adult titles generally don't)
 *   3. the most popular flagged titles, eyeballed
 *
 * Run with:  node --env-file=.env.local scripts/review-adult.mjs
 */
import pg from 'pg'
import { readFile } from 'node:fs/promises'

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

const editorial = JSON.parse(await readFile('./data/editorial.json', 'utf8'))
const editorialIds = editorial.map((e) => e.tmdbId).filter((n) => Number.isFinite(n))

console.log('1. Films you wrote editorial content about that are flagged adult')
const clash = await c.query(
  `select tmdb_id, title from movies where adult = true and tmdb_id = any($1) order by title`,
  [editorialIds],
)
if (clash.rows.length === 0) {
  console.log(`   none — all ${editorialIds.length} editorial titles are unflagged\n`)
} else {
  console.log(`   ${clash.rows.length} CLASH — review these carefully:`)
  for (const r of clash.rows) console.log(`     ${r.title}  (tmdb ${r.tmdb_id})`)
  console.log()
}

console.log('2. Flagged films that nonetheless have a director credit')
const withCrew = await c.query(`
  select m.tmdb_id, m.title, m.release_date,
         (select count(*)::int from credits cr where cr.movie_id=m.id and cr.role='director') d
    from movies m
   where m.adult = true
     and exists (select 1 from credits cr where cr.movie_id=m.id and cr.role='director')
   order by m.popularity desc nulls last
   limit 20
`)
const withCrewTotal = await c.query(`
  select count(*)::int n from movies m
   where m.adult = true
     and exists (select 1 from credits cr where cr.movie_id=m.id and cr.role='director')
`)
console.log(`   ${withCrewTotal.rows[0].n} of the flagged films have a director. Most popular:`)
for (const r of withCrew.rows) {
  console.log(`     ${String(r.title).slice(0, 52).padEnd(54)} ${String(r.release_date ?? '').slice(0, 4)}`)
}

console.log('\n3. Most popular flagged titles overall')
const top = await c.query(`
  select title, release_date from movies where adult = true
   order by popularity desc nulls last limit 20
`)
for (const r of top.rows) {
  console.log(`     ${String(r.title).slice(0, 52).padEnd(54)} ${String(r.release_date ?? '').slice(0, 4)}`)
}

console.log('\n4. Sanity check — most popular titles that would REMAIN')
const keep = await c.query(`
  select title, release_date from movies where adult = false
   order by popularity desc nulls last limit 15
`)
for (const r of keep.rows) {
  console.log(`     ${String(r.title).slice(0, 52).padEnd(54)} ${String(r.release_date ?? '').slice(0, 4)}`)
}

await c.end()
