/**
 * Checks that every genre link on a title page now resolves, and that the
 * archive returns the right titles.
 *
 * Run with: npm run check-genres
 *
 * The counts are compared against raw SQL over the relationship tables rather
 * than trusted from Payload alone — the whole bug was a route that nobody had
 * ever loaded, so "it returned something" is not the standard here.
 */
import { getAllGenres, getGenreBySlug, getTitlesByGenre, getPayloadClient } from '../src/lib/queries'

const payload = await getPayloadClient()

/** Typed properly rather than as `Function`, which eslint rightly objects to. */
type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
}
const pool = (payload.db as unknown as { pool: Queryable }).pool

let failures = 0
const fail = (msg: string) => {
  failures++
  console.log(`  FAIL ${msg}`)
}

const genres = await getAllGenres()
console.log(`${genres.length} genres\n`)

if (genres.length === 0) fail('no genres at all')

let checked = 0
for (const g of genres) {
  const slug = String(g.slug)

  // Every slug a title page can emit must resolve to a genre.
  const found = await getGenreBySlug(slug)
  if (!found) {
    fail(`${slug}: getGenreBySlug returned nothing`)
    continue
  }
  if (found.id !== g.id) fail(`${slug}: resolved to a different genre`)

  const { collection, basePath, result } = await getTitlesByGenre(g.id, g.medium, 48, 1)

  // The medium must pick the right collection, or a TV genre lists films.
  const expected = g.medium === 'tv' ? 'tv-shows' : 'movies'
  if (collection !== expected) fail(`${slug}: medium ${g.medium} chose ${collection}`)
  if (basePath !== (g.medium === 'tv' ? '/tv-shows' : '/movies'))
    fail(`${slug}: basePath wrong for medium ${g.medium}`)

  // Cross-check the total against the relationship table directly.
  const relTable = g.medium === 'tv' ? 'tv_shows_rels' : 'movies_rels'
  const { rows } = await pool.query(
    `select count(distinct parent_id)::int n from ${relTable} where genres_id = $1`,
    [g.id],
  )
  const sqlTotal = Number(rows[0]!.n)

  if (result.totalDocs !== sqlTotal)
    fail(`${slug}: Payload says ${result.totalDocs} titles, SQL says ${sqlTotal}`)

  // A non-empty genre must actually return rows on page 1, with usable links.
  if (sqlTotal > 0) {
    if (result.docs.length === 0) fail(`${slug}: ${sqlTotal} titles but page 1 is empty`)
    const noSlug = result.docs.filter((d) => !d.slug).length
    if (noSlug) fail(`${slug}: ${noSlug} title(s) on page 1 have no slug, so would link nowhere`)
  }

  checked++
  const flag = result.totalDocs === sqlTotal ? 'ok  ' : 'FAIL'
  console.log(
    `  ${flag} ${slug.padEnd(24)} ${String(g.medium).padEnd(6)} ${String(result.totalDocs).padStart(6)} titles  → ${basePath}`,
  )
}

console.log(`\nchecked ${checked} of ${genres.length} genres`)
console.log(failures ? `${failures} check(s) FAILED` : 'all checks passed')
process.exit(failures ? 1 : 0)
