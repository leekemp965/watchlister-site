/**
 * Recovers the records that came across with no TMDB id.
 *
 * The old site held ~360 posts — mostly actors and TV shows — that carried no
 * `tmdb_*_id` meta, so the sync had nothing to key on and they were never
 * imported. Their titles are real, though (Murder She Wrote, the Monty Python
 * cast), so they can be recovered by searching TMDB by name.
 *
 * Two passes so nothing is guessed into the database:
 *   default     search, classify by confidence, write a report. Nothing written.
 *   --apply     import only the high-confidence matches.
 *
 * Confidence:
 *   exact       normalised title matches exactly, or matches and is the only hit
 *   likely      one hit only, title differs slightly
 *   ambiguous   several hits, none exact — left for a human
 *   none        TMDB returned nothing
 *
 * Run with:  node --env-file=.env.local scripts/resolve-missing-tmdb.mjs [--apply]
 */
import pg from 'pg'
import { readFile, writeFile } from 'node:fs/promises'

const KEY = process.env.TMDB_API_KEY
const APPLY = process.argv.includes('--apply')
const CONCURRENCY = 10

if (!KEY) {
  console.error('TMDB_API_KEY is not set.')
  process.exit(1)
}

/** Which TMDB search endpoint each old post type maps to. */
const ENDPOINT = {
  movie: 'movie',
  tv_show: 'tv',
  actor: 'person',
  director: 'person',
  writer: 'person',
  composer: 'person',
  creator: 'person',
  production_company: 'company',
  network: 'company',
}

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** WordPress slugs often end in a year — "the-office-2005" — which disambiguates. */
const yearFromSlug = (slug) => {
  const m = String(slug ?? '').match(/-((?:19|20)\d{2})$/)
  return m ? Number(m[1]) : null
}

const titleOf = (r) => r.title ?? r.name ?? ''
const dateOf = (r) => r.release_date ?? r.first_air_date ?? null

async function search(type, title, year) {
  const endpoint = ENDPOINT[type]
  if (!endpoint) return null
  const url = new URL(`https://api.themoviedb.org/3/search/${endpoint}`)
  url.searchParams.set('api_key', KEY)
  url.searchParams.set('query', title)
  if (year && endpoint === 'movie') url.searchParams.set('primary_release_year', String(year))
  if (year && endpoint === 'tv') url.searchParams.set('first_air_date_year', String(year))

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url)
    if (res.status === 429) {
      await new Promise((s) => setTimeout(s, 2000))
      continue
    }
    if (!res.ok) return null
    const data = await res.json()
    return data.results ?? []
  }
  return null
}

/**
 * How many of this candidate's best-known credits are already in our catalogue.
 *
 * This is what separates the right Eric Idle from his duplicate entry, and the
 * right John Young from fifteen strangers: the person we want appeared in films
 * this site already holds. Popularity alone would just pick whoever is famous.
 */
function catalogueOverlap(candidate, catalogueIds) {
  const known = candidate.known_for ?? []
  let hits = 0
  for (const k of known) if (k?.id && catalogueIds.has(k.id)) hits++
  return hits
}

function classify(wanted, results, catalogueIds) {
  if (!results || results.length === 0) return { confidence: 'none', match: null }

  const target = norm(wanted)
  const exact = results.filter((r) => norm(titleOf(r)) === target)

  if (exact.length === 1) return { confidence: 'exact', match: exact[0] }

  if (exact.length > 1) {
    // Same name, several people. Prefer whoever actually worked on something
    // we hold; fall back to popularity only when nothing overlaps.
    const scored = exact
      .map((r) => ({ r, overlap: catalogueOverlap(r, catalogueIds) }))
      .sort((a, b) => b.overlap - a.overlap || (b.r.popularity ?? 0) - (a.r.popularity ?? 0))

    const best = scored[0]
    const runnerUp = scored[1]

    // A clear winner on catalogue overlap is a real match, not a guess.
    if (best.overlap > 0 && best.overlap > (runnerUp?.overlap ?? 0)) {
      return { confidence: 'exact', match: best.r, alternatives: exact.length, via: 'catalogue' }
    }
    return { confidence: 'ambiguous', match: best.r, alternatives: exact.length }
  }

  if (results.length === 1) return { confidence: 'likely', match: results[0] }

  // No exact title match, several hits — same overlap test before giving up.
  const scored = results
    .map((r) => ({ r, overlap: catalogueOverlap(r, catalogueIds) }))
    .sort((a, b) => b.overlap - a.overlap || (b.r.popularity ?? 0) - (a.r.popularity ?? 0))
  if (scored[0].overlap > 0 && scored[0].overlap > (scored[1]?.overlap ?? 0)) {
    return { confidence: 'likely', match: scored[0].r, alternatives: results.length, via: 'catalogue' }
  }
  return { confidence: 'ambiguous', match: results[0], alternatives: results.length }
}

/* ------------------------------------------------------------------ */

// Every TMDB id already in the catalogue, used to disambiguate same-name people.
const catalogueClient = new pg.Client({ connectionString: process.env.DATABASE_URL })
await catalogueClient.connect()
const catalogueIds = new Set()
for (const table of ['movies', 'tv_shows']) {
  const { rows } = await catalogueClient.query(`select tmdb_id from ${table}`)
  for (const r of rows) catalogueIds.add(Number(r.tmdb_id))
}
await catalogueClient.end()
console.log(`Catalogue holds ${catalogueIds.size.toLocaleString()} titles for disambiguation.\n`)

const quality = JSON.parse(await readFile('./data/data-quality.json', 'utf8'))

const jobs = []
for (const [type, q] of Object.entries(quality)) {
  for (const m of q.missing ?? []) {
    const title = String(m.title ?? '').trim()
    if (!title) continue // empty-title junk rows — nothing to search for
    jobs.push({ type, title, wpId: m.wpId, slug: m.slug, year: yearFromSlug(m.slug) })
  }
}

const emptyTitled = Object.entries(quality).reduce(
  (n, [, q]) => n + (q.missing ?? []).filter((m) => !String(m.title ?? '').trim()).length,
  0,
)

console.log(
  `${jobs.length} named records to resolve (${emptyTitled} empty-title rows skipped)\n`,
)

const out = []
let cursor = 0
async function worker() {
  while (cursor < jobs.length) {
    const job = jobs[cursor++]
    const results = await search(job.type, job.title, job.year)
    const { confidence, match, alternatives, via } = classify(job.title, results, catalogueIds)
    out.push({
      ...job,
      confidence,
      tmdbId: match?.id ?? null,
      matchedTitle: match ? titleOf(match) : null,
      matchedDate: match ? dateOf(match) : null,
      alternatives: alternatives ?? null,
      resolvedVia: via ?? 'name',
    })
    if (out.length % 50 === 0) process.stdout.write(`\r  searched ${out.length}/${jobs.length}`)
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))
process.stdout.write('\n')

const byConfidence = { exact: [], likely: [], ambiguous: [], none: [] }
for (const r of out) byConfidence[r.confidence].push(r)

// Two old records resolving to the same TMDB id are duplicates, which the old
// site was full of. Keep one.
const seen = new Set()
const importable = []
for (const r of [...byConfidence.exact, ...byConfidence.likely]) {
  const key = `${ENDPOINT[r.type]}:${r.tmdbId}`
  if (seen.has(key)) continue
  seen.add(key)
  importable.push(r)
}

await writeFile('./data/resolved-tmdb.json', JSON.stringify(out, null, 2))

const byType = {}
for (const r of out) {
  byType[r.type] ??= { exact: 0, likely: 0, ambiguous: 0, none: 0 }
  byType[r.type][r.confidence]++
}

console.log('\n  type                 exact  likely  ambiguous  none')
for (const [type, c] of Object.entries(byType).sort((a, b) => {
  const t = (x) => x[1].exact + x[1].likely + x[1].ambiguous + x[1].none
  return t(b) - t(a)
})) {
  console.log(
    `  ${type.padEnd(20)}${String(c.exact).padStart(5)}${String(c.likely).padStart(8)}` +
      `${String(c.ambiguous).padStart(11)}${String(c.none).padStart(6)}`,
  )
}

console.log(`
  importable (exact + likely, deduped)  ${importable.length}
  needs a human decision                ${byConfidence.ambiguous.length}
  not found on TMDB                     ${byConfidence.none.length}
`)

console.log('Sample of exact matches:')
for (const r of byConfidence.exact.slice(0, 8)) {
  console.log(`  ${r.type.padEnd(10)} ${r.title.slice(0, 34).padEnd(36)} → ${r.matchedTitle} (${r.tmdbId})`)
}
if (byConfidence.ambiguous.length) {
  console.log('\nSample of ambiguous (not imported):')
  for (const r of byConfidence.ambiguous.slice(0, 8)) {
    console.log(
      `  ${r.type.padEnd(10)} ${r.title.slice(0, 30).padEnd(32)} → ${r.matchedTitle} +${r.alternatives - 1} others`,
    )
  }
}

if (!APPLY) {
  console.log('\nReport only — nothing written. Re-run with --apply to import the importable set.')
  process.exit(0)
}

/* ---------------- apply ---------------- */

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

const seeds = JSON.parse(await readFile('./data/tmdb-seeds.json', 'utf8'))
let addedSeeds = 0
let alreadyPresent = 0

for (const r of importable) {
  const endpoint = ENDPOINT[r.type]
  if (endpoint === 'movie' || endpoint === 'tv') {
    const key = endpoint === 'movie' ? 'movie' : 'tv_show'
    const table = endpoint === 'movie' ? 'movies' : 'tv_shows'
    const exists = await c.query(`select 1 from ${table} where tmdb_id = $1`, [r.tmdbId])
    if (exists.rowCount) {
      alreadyPresent++
      continue
    }
    seeds[key] ??= []
    if (!seeds[key].includes(r.tmdbId)) {
      seeds[key].push(r.tmdbId)
      addedSeeds++
    }
  }
}

await writeFile('./data/tmdb-seeds.json', JSON.stringify(seeds, null, 2))

// People are added by the sync as they appear in credits, so the ones worth
// adding directly are those the sync will never reach.
const people = importable.filter((r) => ENDPOINT[r.type] === 'person')
let peopleAdded = 0
for (const r of people) {
  const exists = await c.query('select 1 from people where tmdb_id = $1', [r.tmdbId])
  if (exists.rowCount) {
    alreadyPresent++
    continue
  }
  const res = await fetch(`https://api.themoviedb.org/3/person/${r.tmdbId}?api_key=${KEY}`)
  if (!res.ok) continue
  const p = await res.json()
  const slug =
    norm(p.name).replace(/\s+/g, '-').slice(0, 80) + '-' + r.tmdbId
  await c.query(
    `insert into people (tmdb_id, name, slug, profile_image_path, known_for_department,
                         gender, birth_date, death_date, place_of_birth, biography,
                         updated_at, created_at)
     values ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10, now(), now())
     on conflict (tmdb_id) do nothing`,
    [
      r.tmdbId,
      p.name,
      slug,
      p.profile_path || null,
      p.known_for_department || null,
      p.gender != null ? String(p.gender) : null,
      p.birthday || null,
      p.deathday || null,
      p.place_of_birth || null,
      p.biography || null,
    ],
  )
  peopleAdded++
}

console.log(`
Applied:
  people inserted        ${peopleAdded}
  titles added to seeds  ${addedSeeds}
  already in database    ${alreadyPresent}

${addedSeeds ? 'Run `npm run sync` to import the newly seeded titles.' : ''}
`)

await c.end()
