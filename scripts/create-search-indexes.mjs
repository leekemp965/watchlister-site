/**
 * Trigram indexes for catalogue search.
 *
 * Search runs `ILIKE '%query%'` across 5,757 films, 816 shows and 68,099
 * people. Without an index that is three sequential scans per keystroke-ish
 * request; with pg_trgm GIN indexes it is a fast index lookup, and trigrams
 * also make partial and mid-word matches work ("solo" finds "Han Solo").
 *
 * Safe to re-run — everything is IF NOT EXISTS. Worth re-running after any
 * Payload schema push, since drizzle may drop indexes it does not know about.
 *
 * Run with:  node --env-file=.env.local scripts/create-search-indexes.mjs
 */
import pg from 'pg'

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

const statements = [
  ['pg_trgm extension', 'create extension if not exists pg_trgm'],
  [
    'movies.title',
    'create index if not exists movies_title_trgm on movies using gin (title gin_trgm_ops)',
  ],
  [
    'tv_shows.title',
    'create index if not exists tv_shows_title_trgm on tv_shows using gin (title gin_trgm_ops)',
  ],
  [
    'people.name',
    'create index if not exists people_name_trgm on people using gin (name gin_trgm_ops)',
  ],
  // Ordering by popularity within a filtered set is the common read pattern.
  [
    'movies.popularity',
    'create index if not exists movies_popularity_idx on movies (popularity desc nulls last)',
  ],
  [
    'tv_shows.popularity',
    'create index if not exists tv_shows_popularity_idx on tv_shows (popularity desc nulls last)',
  ],
]

for (const [label, sql] of statements) {
  const t = Date.now()
  await c.query(sql)
  console.log(`  ok  ${label.padEnd(22)} ${Date.now() - t}ms`)
}

// Prove it works and is actually using the index.
const plan = await c.query(
  `explain (analyze, buffers) select id, title from movies where title ilike $1 order by popularity desc nulls last limit 10`,
  ['%dune%'],
)
console.log('\nQuery plan for a title search:')
for (const row of plan.rows.slice(0, 6)) console.log('  ' + row['QUERY PLAN'])

await c.end()
