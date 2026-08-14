/**
 * Writes each record's old WordPress slug onto it, so inbound links can be
 * redirected.
 *
 * Old: /movie/dune-2021   New: /movies/dune-438631
 *
 * The join is by TMDB id, which is why the id had to be recovered first. Where
 * several old slugs point at one record — the old site had a film that existed
 * eleven times — the first is kept; the rest were duplicates of the same thing.
 *
 * Run with:  node --env-file=.env.local scripts/populate-legacy-slugs.mjs
 */
import pg from 'pg'
import { readFile } from 'node:fs/promises'

const legacy = JSON.parse(await readFile('./data/legacy-slugs.json', 'utf8'))

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

/** Old post type → the table its records now live in. */
const TARGET = {
  movie: 'movies',
  tv_show: 'tv_shows',
  actor: 'people',
  director: 'people',
  writer: 'people',
  composer: 'people',
  creator: 'people',
}

// tmdb_id → slug, per target table. Built first so the five person types merge.
const byTable = {}
for (const [type, slugs] of Object.entries(legacy)) {
  const table = TARGET[type]
  if (!table) continue
  byTable[table] ??= new Map()
  for (const [slug, tmdbId] of Object.entries(slugs)) {
    if (!byTable[table].has(tmdbId)) byTable[table].set(tmdbId, slug)
  }
}

const report = {}

for (const [table, map] of Object.entries(byTable)) {
  const entries = [...map.entries()]
  let updated = 0

  // Batched so 93,000 people do not become 93,000 round trips.
  const BATCH = 1000
  for (let i = 0; i < entries.length; i += BATCH) {
    const chunk = entries.slice(i, i + BATCH)
    const ids = chunk.map(([id]) => Number(id))
    const slugs = chunk.map(([, slug]) => slug)
    const res = await c.query(
      `update ${table} t
          set legacy_slug = v.slug
         from (select unnest($1::int[]) as tmdb_id, unnest($2::text[]) as slug) v
        where t.tmdb_id = v.tmdb_id
          and t.legacy_slug is distinct from v.slug`,
      [ids, slugs],
    )
    updated += res.rowCount
    process.stdout.write(`\r  ${table.padEnd(10)} ${Math.min(i + BATCH, entries.length)}/${entries.length}`)
  }
  process.stdout.write('\n')

  const total = (await c.query(`select count(*)::int n from ${table}`)).rows[0].n
  const withSlug = (await c.query(`select count(legacy_slug)::int n from ${table}`)).rows[0].n
  report[table] = { candidates: entries.length, updated, total, withSlug }
}

console.log('\n  table       old slugs   updated   records   now mapped   coverage')
for (const [table, r] of Object.entries(report)) {
  const pct = ((r.withSlug / r.total) * 100).toFixed(1)
  console.log(
    `  ${table.padEnd(12)}${String(r.candidates).padStart(9)}${String(r.updated).padStart(10)}` +
      `${String(r.total).padStart(10)}${String(r.withSlug).padStart(13)}${(pct + '%').padStart(11)}`,
  )
}

console.log(`
Records with no old slug are ones that never existed on the old site — the 18
shows recovered by name search, and people added from TMDB credits.
`)

await c.end()
