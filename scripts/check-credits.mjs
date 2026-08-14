/**
 * Integrity check on the credits table after a sync.
 *
 * The initial import happened in two passes: a trial batch before the
 * concurrency race was fixed, then the full run. This confirms whether any
 * title is still carrying rows from the buggy pass.
 *
 * Run with:  node --env-file=.env.local scripts/check-credits.mjs
 */
import pg from 'pg'

const CUTOFF = process.argv[2] ?? '2026-08-13T13:00:00Z'

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

const onlyOld = await c.query(
  `select m.id, m.tmdb_id, m.title, count(*)::int n
     from credits cr
     join movies m on cr.movie_id = m.id
    group by 1, 2, 3
   having max(cr.created_at) < $1
    order by n`,
  [CUTOFF],
)

const mixed = await c.query(
  `select count(*)::int n from (
     select movie_id from credits
      where movie_id is not null
      group by 1
     having min(created_at) < $1 and max(created_at) >= $1
   ) x`,
  [CUTOFF],
)

const noCast = await c.query(
  `select count(*)::int n from movies m
    where not exists (
      select 1 from credits cr where cr.movie_id = m.id and cr.role = 'actor'
    )`,
)

const noDirector = await c.query(
  `select count(*)::int n from movies m
    where not exists (
      select 1 from credits cr where cr.movie_id = m.id and cr.role = 'director'
    )`,
)

const counts = onlyOld.rows.map((r) => r.n)
console.log(`Titles carrying only pre-cutoff credits: ${onlyOld.rows.length}`)
if (counts.length) {
  console.log(`  credits per title — min ${Math.min(...counts)}, max ${Math.max(...counts)}`)
  console.log(`  sample: ${onlyOld.rows.slice(0, 6).map((r) => `${r.title} (${r.n})`).join(', ')}`)
}
console.log(`Titles with mixed old+new credits:       ${mixed.rows[0].n}`)
console.log(`Films with no actor credits:             ${noCast.rows[0].n}`)
console.log(`Films with no director credit:           ${noDirector.rows[0].n}`)

// The tmdb ids worth re-syncing, if any.
if (onlyOld.rows.length) {
  const ids = onlyOld.rows.map((r) => r.tmdb_id)
  const { writeFile } = await import('node:fs/promises')
  await writeFile('./data/resync-ids.json', JSON.stringify(ids))
  console.log(`\nWrote ${ids.length} tmdb ids to data/resync-ids.json`)
}

await c.end()
