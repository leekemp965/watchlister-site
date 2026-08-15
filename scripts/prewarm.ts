/**
 * Pre-warms the catalogue at a deliberately gentle pace.
 *
 * On-demand import means nothing *needs* pre-warming — anything searched for
 * appears in 3-5 seconds. This just removes that wait for titles people are
 * likely to want, chiefly the two years of releases missed while the site was
 * down.
 *
 * Paced on purpose. TMDB permits around 50 requests/second; this defaults to
 * one every 3 seconds, roughly 0.7% of what they allow. It is meant to run
 * quietly in the background for an hour, not to hammer anyone.
 *
 * Resumable: completed ids are checkpointed, so stopping and restarting costs
 * nothing.
 *
 * Run with:  npx tsx scripts/prewarm.ts [options]
 *
 *   --set=recent|popular|toprated   what to warm (default: recent)
 *   --limit=N                       stop after N titles (default: 500)
 *   --delay=MS                      gap between titles (default: 3000)
 *   --shows                         television instead of film
 *   --ping=https://watchlister.co   also request each page, so the first real
 *                                   visitor gets a cached render too
 *   --dry-run                       list what would be imported
 */

import { getPayload } from 'payload'
import config from '../src/payload.config'
import { importMovie, importShow, slugify } from '../src/lib/tmdb-import'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? 'true']
  }),
)

const SET = args.get('set') ?? 'recent'
const LIMIT = Number(args.get('limit') ?? 500)
const DELAY = Number(args.get('delay') ?? 3000)
const SHOWS = args.has('shows')
const PING = args.get('ping')
const DRY = args.has('dry-run')

const KEY = process.env.TMDB_API_KEY
if (!KEY) {
  console.error('TMDB_API_KEY is not set.')
  process.exit(1)
}

const DATA = path.resolve(process.cwd(), 'data')
const CHECKPOINT = path.join(DATA, 'prewarm-checkpoint.json')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Discover queries, all filtered to exclude adult titles. */
function discoverUrl(page: number) {
  const kind = SHOWS ? 'tv' : 'movie'
  const url = new URL(`https://api.themoviedb.org/3/discover/${kind}`)
  url.searchParams.set('api_key', KEY!)
  url.searchParams.set('include_adult', 'false')
  url.searchParams.set('page', String(page))

  if (SET === 'recent') {
    // The gap since the site went dark.
    url.searchParams.set('vote_count.gte', '50')
    url.searchParams.set(SHOWS ? 'first_air_date.gte' : 'primary_release_date.gte', '2025-01-01')
    url.searchParams.set('sort_by', 'popularity.desc')
  } else if (SET === 'toprated') {
    url.searchParams.set('vote_count.gte', '1000')
    url.searchParams.set('sort_by', 'vote_average.desc')
  } else {
    url.searchParams.set('vote_count.gte', '250')
    url.searchParams.set('sort_by', 'popularity.desc')
  }
  return url
}

async function collectTargets(): Promise<Array<{ id: number; title: string }>> {
  const out: Array<{ id: number; title: string }> = []
  const seen = new Set<number>()

  for (let page = 1; page <= 500 && out.length < LIMIT; page++) {
    const res = await fetch(discoverUrl(page))
    if (!res.ok) break
    const data = await res.json()
    const results = data.results ?? []
    if (!results.length) break

    for (const r of results) {
      if (out.length >= LIMIT) break
      if (seen.has(r.id)) continue
      seen.add(r.id)
      out.push({ id: r.id, title: r.title ?? r.name ?? String(r.id) })
    }
    // Gentle even while listing.
    await sleep(400)
  }
  return out
}

type Checkpoint = { movies: number[]; shows: number[] }

async function main() {
  const payload = await getPayload({ config })

  let checkpoint: Checkpoint = { movies: [], shows: [] }
  try {
    checkpoint = JSON.parse(await readFile(CHECKPOINT, 'utf8'))
  } catch {
    /* first run */
  }
  const done = new Set(SHOWS ? checkpoint.shows : checkpoint.movies)

  console.log(`Collecting "${SET}" ${SHOWS ? 'shows' : 'films'} from TMDB…`)
  const targets = await collectTargets()

  // Skip anything already held — the point is to fill gaps, not re-fetch.
  const collection = SHOWS ? 'tv-shows' : 'movies'
  const existing = await payload.find({
    collection,
    where: { tmdbId: { in: targets.map((t) => t.id) } },
    limit: 1000,
    depth: 0,
  })
  const held = new Set(existing.docs.map((d) => Number(d.tmdbId)))

  const queue = targets.filter((t) => !held.has(t.id) && !done.has(t.id))

  const mins = Math.round((queue.length * DELAY) / 60000)
  console.log(`
  found in TMDB     ${targets.length}
  already held      ${targets.length - queue.length - queue.filter((q) => done.has(q.id)).length}
  to import         ${queue.length}
  pace              one every ${(DELAY / 1000).toFixed(1)}s  (~${mins} minutes)
`)

  if (DRY) {
    for (const t of queue.slice(0, 25)) console.log(`    ${t.title}`)
    if (queue.length > 25) console.log(`    … and ${queue.length - 25} more`)
    console.log('\nDry run — nothing imported.')
    process.exit(0)
  }

  let ok = 0
  let skipped = 0
  let failed = 0
  const started = Date.now()

  for (const [i, t] of queue.entries()) {
    try {
      const result = SHOWS ? await importShow(payload, t.id) : await importMovie(payload, t.id)

      if (result.status === 'ok') {
        ok++
        // Optionally warm the page cache too, so the first visitor gets a HIT
        // rather than paying for the render.
        if (PING) {
          const base = SHOWS ? '/tv-shows' : '/movies'
          await fetch(`${PING}${base}/${result.slug}`).catch(() => {})
        }
      } else {
        skipped++ // gone from TMDB, or adult
      }

      ;(SHOWS ? checkpoint.shows : checkpoint.movies).push(t.id)
    } catch (err) {
      failed++
      console.log(`\n  failed: ${t.title} — ${(err as Error).message}`)
    }

    if ((i + 1) % 10 === 0) {
      await mkdir(DATA, { recursive: true })
      await writeFile(CHECKPOINT, JSON.stringify(checkpoint))
      const elapsed = (Date.now() - started) / 1000
      const remaining = Math.round(((queue.length - i - 1) * elapsed) / (i + 1))
      process.stdout.write(
        `\r  ${i + 1}/${queue.length}  imported ${ok}  skipped ${skipped}  failed ${failed}  ` +
          `~${Math.floor(remaining / 60)}m left   `,
      )
    }

    if (i < queue.length - 1) await sleep(DELAY)
  }

  await mkdir(DATA, { recursive: true })
  await writeFile(CHECKPOINT, JSON.stringify(checkpoint))

  console.log(`

Done in ${((Date.now() - started) / 60000).toFixed(1)} minutes.
  imported  ${ok}
  skipped   ${skipped} (adult, or no longer on TMDB)
  failed    ${failed}
`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
