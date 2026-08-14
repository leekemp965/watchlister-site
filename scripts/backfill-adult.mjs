/**
 * Backfills TMDB's `adult` flag onto every film.
 *
 * The initial sync discarded it. Rather than re-run the full import, this
 * fetches only the flag and updates one column — no credit rewrites, no people
 * lookups, so it is far quicker than a full pass.
 *
 * Writes a full list of flagged titles to data/adult-titles.json for review
 * BEFORE anything is deleted.
 *
 * Run with:  node --env-file=.env.local scripts/backfill-adult.mjs
 */
import pg from 'pg'
import { writeFile } from 'node:fs/promises'

const KEY = process.env.TMDB_API_KEY
const CONCURRENCY = 16

if (!KEY) {
  console.error('TMDB_API_KEY is not set.')
  process.exit(1)
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

const { rows } = await c.query('select id, tmdb_id, title from movies order by id')
console.log(`Checking ${rows.length.toLocaleString()} films\n`)

const flagged = []
let cursor = 0
let done = 0
let failed = 0
const started = Date.now()

async function worker() {
  while (cursor < rows.length) {
    const r = rows[cursor++]
    try {
      const res = await fetch(`https://api.themoviedb.org/3/movie/${r.tmdb_id}?api_key=${KEY}`)
      if (res.status === 429) {
        cursor-- // put it back and wait
        await new Promise((s) => setTimeout(s, 2000))
        continue
      }
      if (res.ok) {
        const d = await res.json()
        if (d.adult) {
          flagged.push({ id: r.id, tmdbId: r.tmdb_id, title: r.title })
          await c.query('update movies set adult = true where id = $1', [r.id])
        }
      } else if (res.status !== 404) {
        failed++
      }
    } catch {
      failed++
    }

    done++
    if (done % 250 === 0) {
      const rate = done / ((Date.now() - started) / 1000)
      const eta = Math.round((rows.length - done) / rate)
      process.stdout.write(
        `\r${done}/${rows.length}  ${rate.toFixed(1)}/s  flagged ${flagged.length}  ` +
          `eta ${Math.floor(eta / 60)}m${String(eta % 60).padStart(2, '0')}s   `,
      )
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))
process.stdout.write('\n')

flagged.sort((a, b) => String(a.title).localeCompare(String(b.title)))
await writeFile('./data/adult-titles.json', JSON.stringify(flagged, null, 2))

// How many credits and people would be affected by removing these.
const ids = flagged.map((f) => f.id)
let creditCount = 0
let orphanPeople = 0
if (ids.length) {
  const cr = await c.query('select count(*)::int n from credits where movie_id = any($1)', [ids])
  creditCount = cr.rows[0].n
  const op = await c.query(
    `select count(*)::int n from people p
      where exists (select 1 from credits c where c.person_id=p.id and c.movie_id = any($1))
        and not exists (
          select 1 from credits c2 where c2.person_id=p.id
            and (c2.movie_id is null or not (c2.movie_id = any($1)))
        )`,
    [ids],
  )
  orphanPeople = op.rows[0].n
}

console.log(`
Films checked      ${rows.length.toLocaleString()}
Flagged adult      ${flagged.length.toLocaleString()} (${((flagged.length / rows.length) * 100).toFixed(1)}%)
Would remain       ${(rows.length - flagged.length).toLocaleString()}
Lookup failures    ${failed}

If these were removed:
  credits deleted  ${creditCount.toLocaleString()}
  people orphaned  ${orphanPeople.toLocaleString()} (appear in no other title)

Full list written to data/adult-titles.json — review before deleting.
`)

await c.end()
