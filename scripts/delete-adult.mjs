/**
 * Removes the films TMDB flags as adult, with their credits and any people left
 * unreachable by the removal.
 *
 * Order matters. `credits.movie_id` and `credits.person_id` are SET NULL, not
 * CASCADE, so deleting films first would leave 57k credits pointing at nothing
 * rather than deleting them. Credits go first, explicitly.
 *
 * Everything runs in one transaction and is verified before commit; any failed
 * check rolls the whole thing back.
 *
 * Recoverable: data/tmdb-seeds.json still holds every id and the sync is
 * idempotent, so a re-run restores anything removed here.
 *
 * Run with:  node --env-file=.env.local scripts/delete-adult.mjs [--dry-run]
 */
import pg from 'pg'

const DRY = process.argv.includes('--dry-run')
const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

const before = {}
for (const t of ['movies', 'credits', 'people', 'tv_shows']) {
  before[t] = (await c.query(`select count(*)::int n from ${t}`)).rows[0].n
}

const flagged = (await c.query('select id from movies where adult = true')).rows.map((r) => r.id)
console.log(`Flagged for removal: ${flagged.length.toLocaleString()} films\n`)

if (flagged.length === 0) {
  console.log('Nothing to do.')
  await c.end()
  process.exit(0)
}

await c.query('begin')

try {
  // 1. Credits belonging to those films.
  const delCredits = await c.query('delete from credits where movie_id = any($1)', [flagged])
  console.log(`  credits deleted        ${delCredits.rowCount.toLocaleString()}`)

  // 2. The films themselves. Cascades clear movies_rels, movies_articles,
  //    movies_podcasts, movies_video_embeds and posts_rels references.
  const delMovies = await c.query('delete from movies where id = any($1)', [flagged])
  console.log(`  films deleted          ${delMovies.rowCount.toLocaleString()}`)

  // 3. People now unreachable — no credits at all on either films or shows.
  const delPeople = await c.query(
    `delete from people p
      where not exists (select 1 from credits cr where cr.person_id = p.id)`,
  )
  console.log(`  people deleted         ${delPeople.rowCount.toLocaleString()}`)

  // ---- verification before commit ----
  const checks = []
  const q = async (sql) => (await c.query(sql)).rows[0].n

  checks.push(['credits with null movie AND null show', await q(
    'select count(*)::int n from credits where movie_id is null and tv_show_id is null')])
  checks.push(['credits pointing at a missing film', await q(
    `select count(*)::int n from credits cr left join movies m on cr.movie_id=m.id
      where cr.movie_id is not null and m.id is null`)])
  checks.push(['credits pointing at a missing person', await q(
    `select count(*)::int n from credits cr left join people p on cr.person_id=p.id
      where p.id is null`)])
  checks.push(['adult films remaining', await q(
    'select count(*)::int n from movies where adult = true')])
  checks.push(['orphaned movies_rels rows', await q(
    `select count(*)::int n from movies_rels r left join movies m on r.parent_id=m.id
      where m.id is null`)])

  console.log('\n  verification:')
  let failed = false
  for (const [label, n] of checks) {
    const ok = n === 0
    if (!ok) failed = true
    console.log(`    ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(40)} ${n}`)
  }

  if (failed) {
    await c.query('rollback')
    console.log('\nRolled back — verification failed, nothing was changed.')
    await c.end()
    process.exit(1)
  }

  if (DRY) {
    await c.query('rollback')
    console.log('\nDry run — rolled back, nothing was changed.')
  } else {
    await c.query('commit')
    console.log('\nCommitted.')
  }
} catch (err) {
  await c.query('rollback')
  console.error('\nRolled back after error:', err.message)
  await c.end()
  process.exit(1)
}

const after = {}
for (const t of ['movies', 'credits', 'people', 'tv_shows']) {
  after[t] = (await c.query(`select count(*)::int n from ${t}`)).rows[0].n
}
const size = (await c.query('select pg_size_pretty(pg_database_size(current_database())) s')).rows[0].s

console.log('\n            before        after       change')
for (const t of Object.keys(before)) {
  const d = after[t] - before[t]
  console.log(
    `  ${t.padEnd(10)}${before[t].toLocaleString().padStart(9)}${after[t]
      .toLocaleString()
      .padStart(13)}${(d === 0 ? '—' : d.toLocaleString()).padStart(13)}`,
  )
}
console.log(`\n  database size: ${size}`)

await c.end()
