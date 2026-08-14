/**
 * Fills in the person details the catalogue sync could not know.
 *
 * People were created from film and TV credits, which carry only a name,
 * profile path, department and gender. Biography, birth and death dates and
 * place of birth live on TMDB's /person endpoint and were never fetched — so
 * the rebuilt site had less about each person than the old WordPress one,
 * which held 48,826 birth dates and 15,023 death dates.
 *
 * Resumable: only rows still missing everything are fetched, so an interrupted
 * run picks up where it stopped.
 *
 * Run with:  node --env-file=.env.local scripts/enrich-people.mjs [--all]
 */
import pg from 'pg'

const KEY = process.env.TMDB_API_KEY
const CONCURRENCY = 16
const REFETCH_ALL = process.argv.includes('--all')

if (!KEY) {
  console.error('TMDB_API_KEY is not set.')
  process.exit(1)
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

const { rows } = await c.query(
  REFETCH_ALL
    ? 'select id, tmdb_id, name from people order by id'
    : `select id, tmdb_id, name from people
        where biography is null and birth_date is null and place_of_birth is null
        order by id`,
)

console.log(`${rows.length.toLocaleString()} people to enrich\n`)
if (!rows.length) {
  await c.end()
  process.exit(0)
}

let cursor = 0
let done = 0
let updated = 0
let gone = 0
let failed = 0
const started = Date.now()

async function worker() {
  while (cursor < rows.length) {
    const r = rows[cursor++]
    try {
      const res = await fetch(`https://api.themoviedb.org/3/person/${r.tmdb_id}?api_key=${KEY}`)

      if (res.status === 429) {
        cursor-- // put it back, then back off
        await new Promise((s) => setTimeout(s, 2000))
        continue
      }
      if (res.status === 404) {
        gone++
      } else if (res.ok) {
        const p = await res.json()
        // Empty strings are how TMDB says "unknown"; store null instead so the
        // resume filter above stays meaningful.
        const nz = (v) => (v && String(v).trim() ? v : null)
        await c.query(
          `update people set
             biography = coalesce($2, biography),
             birth_date = coalesce($3::date, birth_date),
             death_date = coalesce($4::date, death_date),
             place_of_birth = coalesce($5, place_of_birth),
             profile_image_path = coalesce($6, profile_image_path),
             known_for_department = coalesce($7, known_for_department)
           where id = $1`,
          [
            r.id,
            nz(p.biography),
            nz(p.birthday),
            nz(p.deathday),
            nz(p.place_of_birth),
            nz(p.profile_path),
            nz(p.known_for_department),
          ],
        )
        updated++
      } else {
        failed++
      }
    } catch {
      failed++
    }

    done++
    if (done % 500 === 0) {
      const rate = done / ((Date.now() - started) / 1000)
      const eta = Math.round((rows.length - done) / rate)
      process.stdout.write(
        `\r${done.toLocaleString()}/${rows.length.toLocaleString()}  ${rate.toFixed(1)}/s  ` +
          `updated ${updated.toLocaleString()} gone ${gone} failed ${failed}  ` +
          `eta ${Math.floor(eta / 60)}m${String(eta % 60).padStart(2, '0')}s   `,
      )
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))
process.stdout.write('\n')

const stats = await c.query(`
  select count(*)::int total,
         count(biography)::int bios,
         count(birth_date)::int births,
         count(death_date)::int deaths,
         count(place_of_birth)::int places
    from people`)

const s = stats.rows[0]
console.log(`
Done in ${((Date.now() - started) / 60000).toFixed(1)}m
  updated  ${updated.toLocaleString()}
  gone     ${gone.toLocaleString()} (no longer on TMDB)
  failed   ${failed.toLocaleString()}

Coverage across ${s.total.toLocaleString()} people:
  biography       ${s.bios.toLocaleString()}
  birth date      ${s.births.toLocaleString()}
  death date      ${s.deaths.toLocaleString()}
  place of birth  ${s.places.toLocaleString()}
`)

await c.end()
