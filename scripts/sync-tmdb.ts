/**
 * Populates the catalogue from TMDB.
 *
 * Seeded from the ids the old site held, so the same films and shows come
 * across — but with current data rather than whatever was true in 2025.
 *
 * Run with:  npx payload run scripts/sync-tmdb.ts
 * Resume:    the same command. Completed ids are checkpointed, so an
 *            interrupted run picks up where it stopped rather than restarting
 *            10,892 fetches.
 *
 * Flags:
 *   --only=movies|shows   restrict to one medium
 *   --limit=N             stop after N titles (for a trial run)
 *   --force               re-fetch ids already in the checkpoint
 */

import { getPayload } from 'payload'
// See init-db.ts — the alias is not available under the script runner.
import config from '../src/payload.config'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const API = 'https://api.themoviedb.org/3'
const KEY = process.env.TMDB_API_KEY
const DATA_DIR = path.resolve(process.cwd(), 'data')
const CHECKPOINT = path.join(DATA_DIR, 'sync-checkpoint.json')

/**
 * TMDB permits ~50 requests/second, so the API is never the limit — database
 * round trips are. Concurrency is what keeps the connection pool busy while
 * individual titles wait on writes.
 */
const CONCURRENCY = Number(process.env.SYNC_CONCURRENCY ?? 12)
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? 'true']
  }),
)

if (!KEY) {
  console.error('TMDB_API_KEY is not set. Copy .env.example to .env.local and fill it in.')
  process.exit(1)
}

/* ------------------------------------------------------------------ *
 * HTTP
 * ------------------------------------------------------------------ */

let requests = 0

async function tmdb<T>(endpoint: string, params: Record<string, string> = {}): Promise<T | null> {
  const url = new URL(API + endpoint)
  url.searchParams.set('api_key', KEY!)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } })
      requests++

      if (res.status === 404) return null // Title withdrawn from TMDB since 2025.
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after') ?? 2)
        await sleep((retryAfter + 1) * 1000)
        continue
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return (await res.json()) as T
    } catch (err) {
      if (attempt === 4) throw err
      await sleep(2 ** attempt * 500) // 0.5s, 1s, 2s, 4s
    }
  }
  return null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const slugify = (s: string, suffix?: string | number): string => {
  const base = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining accents left by NFD
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return suffix ? `${base || 'untitled'}-${suffix}` : base || 'untitled'
}

// Assigned in run(). `payload run` transpiles to CommonJS, which has no
// top-level await, so the client is initialised inside main rather than here.
let payload: Awaited<ReturnType<typeof getPayload>>

/**
 * Upsert by TMDB id. Every catalogue collection is keyed on it, which is what
 * makes a refresh idempotent — re-running never duplicates a record.
 */
async function upsert(
  collection: 'movies' | 'tv-shows' | 'people' | 'production-companies' | 'networks' | 'genres',
  tmdbId: number,
  data: Record<string, unknown>,
  extraWhere: Record<string, unknown> = {},
): Promise<number | string> {
  const find = async (): Promise<number | string | undefined> => {
    const existing = await payload.find({
      collection,
      where: { tmdbId: { equals: tmdbId }, ...extraWhere },
      limit: 1,
      depth: 0,
    })
    return existing.docs[0]?.id
  }

  const found = await find()
  if (found !== undefined) {
    await payload.update({ collection, id: found, data, depth: 0 })
    return found
  }

  try {
    // Cast: `collection` is a union here, so Payload cannot narrow `data` to a
    // single collection's shape. The shapes are validated by the collection
    // configs at write time regardless.
    const created = await payload.create({
      collection,
      data: { ...data, tmdbId },
      depth: 0,
    } as never)
    return created.id
  } catch (err) {
    // Another worker inserted this record between our find and our create.
    // Unique constraints on tmdbId and slug are what caught it, so re-read and
    // update instead of failing the whole title.
    const raced = await find()
    if (raced === undefined) throw err
    await payload.update({ collection, id: raced, data, depth: 0 })
    return raced
  }
}

/**
 * In-run caches, keyed by TMDB id.
 *
 * These hold the in-flight *promise*, not the resolved id. Caching only the
 * settled value leaves a window where eight concurrent workers each miss the
 * cache for the same popular actor and race to create them. Storing the promise
 * immediately means the first caller does the work and the rest await it.
 */
const personCache = new Map<number, Promise<number | string>>()
const companyCache = new Map<number, Promise<number | string>>()
const networkCache = new Map<number, Promise<number | string>>()
const genreCache = new Map<string, Promise<number | string>>()

function memo<K>(
  cache: Map<K, Promise<number | string>>,
  key: K,
  make: () => Promise<number | string>,
): Promise<number | string> {
  const hit = cache.get(key)
  if (hit) return hit
  const promise = make().catch((err) => {
    // Don't poison the cache: a transient failure shouldn't doom every later
    // title that references the same person.
    cache.delete(key)
    throw err
  })
  cache.set(key, promise)
  return promise
}

function ensurePerson(p: {
  id: number
  name: string
  profile_path?: string | null
  known_for_department?: string | null
  gender?: number | null
}): Promise<number | string> {
  return memo(personCache, p.id, () =>
    upsert('people', p.id, {
      name: p.name,
      slug: slugify(p.name, p.id),
      profileImagePath: p.profile_path ?? null,
      knownForDepartment: p.known_for_department ?? null,
      gender: p.gender != null ? String(p.gender) : undefined,
    }),
  )
}

function ensureCompany(c: {
  id: number
  name: string
  logo_path?: string | null
  origin_country?: string | null
}): Promise<number | string> {
  return memo(companyCache, c.id, () =>
    upsert('production-companies', c.id, {
      name: c.name,
      slug: slugify(c.name, c.id),
      logoPath: c.logo_path ?? null,
      originCountry: c.origin_country ?? null,
    }),
  )
}

function ensureNetwork(n: { id: number; name: string; logo_path?: string | null }) {
  return memo(networkCache, n.id, () =>
    upsert('networks', n.id, {
      name: n.name,
      slug: slugify(n.name, n.id),
      logoPath: n.logo_path ?? null,
    }),
  )
}

function ensureGenre(g: { id: number; name: string }, medium: 'movie' | 'tv') {
  // TMDB numbers film and television genres separately, so the cache key and
  // the lookup both need the medium alongside the id.
  return memo(genreCache, `${medium}:${g.id}`, () =>
    upsert(
      'genres',
      g.id,
      { name: g.name, slug: slugify(g.name, medium), medium },
      { medium: { equals: medium } },
    ),
  )
}

/**
 * Resolve a whole title's cast and crew in one query instead of one per person.
 *
 * A film with 30 credits otherwise costs 30 sequential round trips to find
 * people who, after the first few hundred titles, almost always already exist.
 * One `in` query replaces all of them, and only genuine newcomers fall through
 * to an individual insert.
 *
 * People already present are cached as-is rather than being updated: the fields
 * a credit payload carries (name, profile path, department, gender) are the
 * same every time TMDB returns them, so re-writing them each pass would cost
 * thousands of updates to change nothing. A dedicated person refresh, which
 * pulls biography and place of birth, is a separate job.
 */
async function preloadPeople(ids: number[]) {
  const missing = [...new Set(ids)].filter((id) => !personCache.has(id))
  if (!missing.length) return

  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100)
    const found = await payload.find({
      collection: 'people',
      where: { tmdbId: { in: chunk } },
      pagination: false,
      depth: 0,
    })
    for (const doc of found.docs) {
      const tmdbId = (doc as { tmdbId: number }).tmdbId
      if (!personCache.has(tmdbId)) personCache.set(tmdbId, Promise.resolve(doc.id))
    }
  }
}

/**
 * Credits are rewritten rather than merged: TMDB is authoritative for who did
 * what, and diffing 168k rows would cost more than replacing the handful that
 * belong to one title.
 */
async function replaceCredits(
  key: 'movie' | 'tvShow',
  titleId: number | string,
  credits: {
    cast?: Array<{ id: number; name: string; character?: string; order?: number; profile_path?: string | null; known_for_department?: string | null; gender?: number | null }>
    crew?: Array<{ id: number; name: string; job?: string; profile_path?: string | null; known_for_department?: string | null; gender?: number | null }>
  },
  createdBy?: Array<{ id: number; name: string; profile_path?: string | null; gender?: number | null }>,
) {
  await payload.delete({ collection: 'credits', where: { [key]: { equals: titleId } } })

  const cast = (credits.cast ?? []).slice(0, 30)
  await preloadPeople([
    ...cast.map((c) => c.id),
    ...(credits.crew ?? []).map((c) => c.id),
    ...(createdBy ?? []).map((c) => c.id),
  ])

  const JOBS: Record<string, string> = {
    Director: 'director',
    Writer: 'writer',
    Screenplay: 'writer',
    Story: 'writer',
    'Original Music Composer': 'composer',
    Music: 'composer',
  }

  const rows: Array<Record<string, unknown>> = []

  // Top billing only. The old site stored entire cast lists — the reason
  // `cast_N_actor` reached 168,117 rows — but no page ever showed more than
  // a couple of dozen. Raise this if you want the long tail back.
  for (const c of cast) {
    rows.push({
      person: await ensurePerson(c),
      role: 'actor',
      [key]: titleId,
      character: c.character ?? null,
      order: c.order ?? 0,
    })
  }

  const seenCrew = new Set<string>()
  for (const c of credits.crew ?? []) {
    const role = JOBS[c.job ?? '']
    if (!role) continue
    const dedupe = `${c.id}:${role}`
    if (seenCrew.has(dedupe)) continue // Credited twice, e.g. Story and Screenplay.
    seenCrew.add(dedupe)
    rows.push({ person: await ensurePerson(c), role, [key]: titleId, order: 0 })
  }

  for (const c of createdBy ?? []) {
    rows.push({ person: await ensurePerson(c), role: 'creator', [key]: titleId, order: 0 })
  }

  for (const data of rows) {
    await payload.create({ collection: 'credits', data: data as never, depth: 0 })
  }
  return rows.length
}

const pickTrailer = (videos?: { results?: Array<{ site: string; type: string; key: string }> }) => {
  const r = videos?.results ?? []
  const best =
    r.find((v) => v.site === 'YouTube' && v.type === 'Trailer') ??
    r.find((v) => v.site === 'YouTube' && v.type === 'Teaser')
  return best ? `https://www.youtube.com/watch?v=${best.key}` : null
}

/** UK certificate where TMDB has one, since that is what the old site showed. */
const pickCertificate = (releaseDates?: {
  results?: Array<{ iso_3166_1: string; release_dates: Array<{ certification: string }> }>
}) => {
  const gb = releaseDates?.results?.find((r) => r.iso_3166_1 === 'GB')
  const cert = gb?.release_dates?.find((d) => d.certification)?.certification
  return cert || null
}

/* ------------------------------------------------------------------ *
 * Per-title sync
 * ------------------------------------------------------------------ */

async function syncMovie(tmdbId: number) {
  const m = await tmdb<any>(`/movie/${tmdbId}`, {
    append_to_response: 'credits,videos,release_dates',
  })
  if (!m) return { status: 'gone' as const }

  const id = await upsert('movies', tmdbId, {
    title: m.title,
    slug: slugify(m.title, tmdbId),
    overview: m.overview || null,
    posterPath: m.poster_path ?? null,
    backdropPath: m.backdrop_path ?? null,
    releaseDate: m.release_date || null,
    runtime: m.runtime ?? null,
    certificate: pickCertificate(m.release_dates),
    popularity: m.popularity ?? null,
    adult: Boolean(m.adult),
    youtubeUrl: pickTrailer(m.videos),
    genres: await Promise.all((m.genres ?? []).map((g: any) => ensureGenre(g, 'movie'))),
    productionCompanies: await Promise.all(
      (m.production_companies ?? []).map((c: any) => ensureCompany(c)),
    ),
  })

  const credits = await replaceCredits('movie', id, m.credits ?? {})
  return { status: 'ok' as const, credits }
}

async function syncShow(tmdbId: number) {
  const s = await tmdb<any>(`/tv/${tmdbId}`, { append_to_response: 'credits,videos' })
  if (!s) return { status: 'gone' as const }

  const id = await upsert('tv-shows', tmdbId, {
    title: s.name,
    slug: slugify(s.name, tmdbId),
    overview: s.overview || null,
    posterPath: s.poster_path ?? null,
    backdropPath: s.backdrop_path ?? null,
    firstAirDate: s.first_air_date || null,
    lastAirDate: s.last_air_date || null,
    status: s.status || null,
    numberOfSeasons: s.number_of_seasons ?? null,
    numberOfEpisodes: s.number_of_episodes ?? null,
    episodeRuntime: s.episode_run_time?.[0] ?? null,
    popularity: s.popularity ?? null,
    youtubeUrl: pickTrailer(s.videos),
    genres: await Promise.all((s.genres ?? []).map((g: any) => ensureGenre(g, 'tv'))),
    networks: await Promise.all((s.networks ?? []).map((n: any) => ensureNetwork(n))),
    productionCompanies: await Promise.all(
      (s.production_companies ?? []).map((c: any) => ensureCompany(c)),
    ),
  })

  const credits = await replaceCredits('tvShow', id, s.credits ?? {}, s.created_by)
  return { status: 'ok' as const, credits }
}

/* ------------------------------------------------------------------ *
 * Driver
 * ------------------------------------------------------------------ */

type Checkpoint = { movies: number[]; shows: number[] }

async function loadCheckpoint(): Promise<Checkpoint> {
  if (args.has('force')) return { movies: [], shows: [] }
  try {
    return JSON.parse(await readFile(CHECKPOINT, 'utf8'))
  } catch {
    return { movies: [], shows: [] }
  }
}

async function run() {
  payload = await getPayload({ config })
  const seeds = JSON.parse(await readFile(path.join(DATA_DIR, 'tmdb-seeds.json'), 'utf8'))
  const checkpoint = await loadCheckpoint()
  const only = args.get('only')
  const limit = args.has('limit') ? Number(args.get('limit')) : Infinity

  const jobs: Array<{ kind: 'movie' | 'show'; id: number }> = []
  if (only !== 'shows') {
    const done = new Set(checkpoint.movies)
    for (const id of seeds.movie ?? []) if (!done.has(id)) jobs.push({ kind: 'movie', id })
  }
  if (only !== 'movies') {
    const done = new Set(checkpoint.shows)
    for (const id of seeds.tv_show ?? []) if (!done.has(id)) jobs.push({ kind: 'show', id })
  }

  const queue = jobs.slice(0, limit === Infinity ? undefined : limit)
  console.log(`${queue.length.toLocaleString()} titles to sync (${jobs.length.toLocaleString()} outstanding)\n`)

  const stats = { ok: 0, gone: 0, failed: 0, credits: 0 }
  const failures: Array<{ id: number; kind: string; error: string }> = []
  const started = Date.now()
  let cursor = 0

  const save = () => writeFile(CHECKPOINT, JSON.stringify(checkpoint))

  async function worker() {
    while (cursor < queue.length) {
      const job = queue[cursor++]
      const n = cursor
      try {
        const result = job.kind === 'movie' ? await syncMovie(job.id) : await syncShow(job.id)
        if (result.status === 'gone') stats.gone++
        else {
          stats.ok++
          stats.credits += result.credits ?? 0
        }
        ;(job.kind === 'movie' ? checkpoint.movies : checkpoint.shows).push(job.id)
      } catch (err) {
        stats.failed++
        failures.push({ id: job.id, kind: job.kind, error: (err as Error).message })
      }

      if (n % 50 === 0) {
        const elapsed = (Date.now() - started) / 1000
        const rate = n / elapsed
        const eta = Math.round((queue.length - n) / rate)
        process.stdout.write(
          `\r${n}/${queue.length}  ${rate.toFixed(1)}/s  ` +
            `ok ${stats.ok} gone ${stats.gone} failed ${stats.failed}  ` +
            `eta ${Math.floor(eta / 60)}m${String(eta % 60).padStart(2, '0')}s   `,
        )
        await save()
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  await save()
  if (failures.length) {
    await mkdir(DATA_DIR, { recursive: true })
    await writeFile(path.join(DATA_DIR, 'sync-failures.json'), JSON.stringify(failures, null, 2))
  }

  const mins = ((Date.now() - started) / 60000).toFixed(1)
  console.log(`
Done in ${mins}m across ${requests.toLocaleString()} API requests.
  synced   ${stats.ok.toLocaleString()}
  credits  ${stats.credits.toLocaleString()}
  gone     ${stats.gone.toLocaleString()} (no longer on TMDB)
  failed   ${stats.failed.toLocaleString()}${failures.length ? ' — see data/sync-failures.json' : ''}
`)
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
