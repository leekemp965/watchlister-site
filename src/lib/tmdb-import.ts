import type { Payload } from 'payload'

/**
 * Importing a single title from TMDB, on demand.
 *
 * The old WordPress site never held a fixed catalogue. Its search queried TMDB
 * directly, and the first time anyone opened a result it created the local
 * post — `get_or_add_movies()` in the old plugin. The 11,282 films it ended up
 * with were an accumulation of what people had searched for, which is why the
 * mix was so uneven.
 *
 * This restores that behaviour: the title routes call `importMovie` /
 * `importShow` when a slug carries a TMDB id that is not in the database yet.
 *
 * Shared with scripts/sync-tmdb.ts so bulk and on-demand imports cannot drift
 * apart in what they store.
 */

const API = 'https://api.themoviedb.org/3'

export const slugify = (s: string, suffix: string | number): string => {
  const base = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `${base || 'untitled'}-${suffix}`
}

/** A slug ends with the TMDB id, so "dune-438631" resolves without a lookup table. */
export const tmdbIdFromSlug = (slug: string): number | null => {
  const m = slug.match(/-(\d+)$/)
  if (!m) return null
  const id = Number(m[1])
  return Number.isFinite(id) && id > 0 ? id : null
}

async function tmdb<T>(endpoint: string, params: Record<string, string> = {}): Promise<T | null> {
  const key = process.env.TMDB_API_KEY
  if (!key) throw new Error('TMDB_API_KEY is not set')

  const url = new URL(API + endpoint)
  url.searchParams.set('api_key', key)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    // TMDB data changes slowly; a day of caching keeps repeat imports cheap.
    next: { revalidate: 86400 },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`TMDB ${res.status} on ${endpoint}`)
  return (await res.json()) as T
}

/* ------------------------------------------------------------------ *
 * Upserts
 * ------------------------------------------------------------------ */

type Collection = 'movies' | 'tv-shows' | 'people' | 'production-companies' | 'networks' | 'genres'

async function upsert(
  payload: Payload,
  collection: Collection,
  tmdbId: number,
  data: Record<string, unknown>,
  extraWhere: Record<string, unknown> = {},
): Promise<number | string> {
  const find = async () => {
    const res = await payload.find({
      collection,
      where: { tmdbId: { equals: tmdbId }, ...extraWhere },
      limit: 1,
      depth: 0,
    })
    return res.docs[0]?.id
  }

  const found = await find()
  if (found !== undefined) {
    await payload.update({ collection, id: found, data, depth: 0 } as never)
    return found
  }

  try {
    const created = await payload.create({
      collection,
      data: { ...data, tmdbId },
      depth: 0,
    } as never)
    return created.id
  } catch (err) {
    // Two visitors can open the same uncached title at once. The unique
    // constraint on tmdbId is what catches it; re-read rather than fail.
    const raced = await find()
    if (raced === undefined) throw err
    await payload.update({ collection, id: raced, data, depth: 0 } as never)
    return raced
  }
}

type TmdbPerson = {
  id: number
  name: string
  profile_path?: string | null
  known_for_department?: string | null
  gender?: number | null
  character?: string
  job?: string
  order?: number
}

async function ensurePerson(payload: Payload, p: TmdbPerson, cache: Map<number, number | string>) {
  const hit = cache.get(p.id)
  if (hit !== undefined) return hit
  const id = await upsert(payload, 'people', p.id, {
    name: p.name,
    slug: slugify(p.name, p.id),
    profileImagePath: p.profile_path ?? null,
    knownForDepartment: p.known_for_department ?? null,
    gender: p.gender != null ? String(p.gender) : undefined,
  })
  cache.set(p.id, id)
  return id
}

const JOBS: Record<string, string> = {
  Director: 'director',
  Writer: 'writer',
  Screenplay: 'writer',
  Story: 'writer',
  'Original Music Composer': 'composer',
  Music: 'composer',
}

async function replaceCredits(
  payload: Payload,
  key: 'movie' | 'tvShow',
  titleId: number | string,
  credits: { cast?: TmdbPerson[]; crew?: TmdbPerson[] },
  createdBy?: TmdbPerson[],
) {
  await payload.delete({ collection: 'credits', where: { [key]: { equals: titleId } } })

  // Decide what the credits are before touching the database, so the writes
  // can be issued together. Doing it inline meant ~35 round trips in series,
  // which put a first-time visitor through a 16-second wait.
  type Planned = { person: TmdbPerson; role: string; character?: string | null; order: number }
  const planned: Planned[] = []

  // Top billing only — the same cap the bulk sync uses.
  for (const c of (credits.cast ?? []).slice(0, 30)) {
    planned.push({ person: c, role: 'actor', character: c.character ?? null, order: c.order ?? 0 })
  }

  const seen = new Set<string>()
  for (const c of credits.crew ?? []) {
    const role = JOBS[c.job ?? '']
    if (!role) continue
    const dedupe = `${c.id}:${role}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    planned.push({ person: c, role, order: 0 })
  }
  for (const c of createdBy ?? []) planned.push({ person: c, role: 'creator', order: 0 })

  /**
   * Resolve people and write credits in a handful of statements rather than
   * one Payload call each.
   *
   * Going through payload.create for ~35 cast and crew meant ~70 round trips,
   * each carrying field validation and hooks. On a serverless function that
   * took 47 seconds against a 60-second ceiling. The same work as five
   * set-based statements takes a fraction of that, and `on conflict do
   * nothing` handles two visitors importing the same title at once without
   * the retry dance.
   *
   * This writes through the pool rather than Payload, so it bypasses the
   * collection hooks. That is safe here because the shape is fixed and the
   * only hook on credits — exactly one of movie/tvShow — is guaranteed by
   * construction.
   */
  const pool = (payload.db as unknown as { pool: { query: Function } }).pool
  const people = [...new Map(planned.map((p) => [p.person.id, p.person])).values()]

  if (people.length) {
    // gender and role are Postgres enums, so the text arrays need casting
    // explicitly — unnest yields text and the insert will not coerce it.
    await pool.query(
      `insert into people (tmdb_id, name, slug, profile_image_path, known_for_department,
                           gender, updated_at, created_at)
       select tmdb_id, name, slug, profile_image_path, known_for_department,
              gender::enum_people_gender, now(), now()
         from unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
              as t(tmdb_id, name, slug, profile_image_path, known_for_department, gender)
       on conflict (tmdb_id) do nothing`,
      [
        people.map((p) => p.id),
        people.map((p) => p.name),
        people.map((p) => slugify(p.name, p.id)),
        people.map((p) => p.profile_path ?? null),
        people.map((p) => p.known_for_department ?? null),
        people.map((p) => (p.gender != null ? String(p.gender) : null)),
      ],
    )
  }

  const idRows = people.length
    ? (
        await pool.query('select id, tmdb_id from people where tmdb_id = any($1::int[])', [
          people.map((p) => p.id),
        ])
      ).rows
    : []
  const personId = new Map<number, number>(idRows.map((r: any) => [Number(r.tmdb_id), r.id]))

  const column = key === 'movie' ? 'movie_id' : 'tv_show_id'
  const rows = planned
    .map((p) => ({ ...p, id: personId.get(p.person.id) }))
    .filter((p): p is typeof p & { id: number } => p.id !== undefined)

  if (rows.length) {
    await pool.query(
      `insert into credits (person_id, role, ${column}, "character", "order", updated_at, created_at)
       select person_id, role::enum_credits_role, title_id, "character", "order", now(), now()
         from unnest($1::int[], $2::text[], $3::int[], $4::text[], $5::int[])
              as t(person_id, role, title_id, "character", "order")`,
      [
        rows.map((r) => r.id),
        rows.map((r) => r.role),
        rows.map(() => Number(titleId)),
        rows.map((r) => r.character ?? null),
        rows.map((r) => r.order),
      ],
    )
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

/** UK certificate where TMDB has one, matching what the old site displayed. */
const pickCertificate = (releaseDates?: {
  results?: Array<{ iso_3166_1: string; release_dates: Array<{ certification: string }> }>
}) => {
  const gb = releaseDates?.results?.find((r) => r.iso_3166_1 === 'GB')
  return gb?.release_dates?.find((d) => d.certification)?.certification || null
}

/* ------------------------------------------------------------------ *
 * Public
 * ------------------------------------------------------------------ */

export type ImportResult =
  | { status: 'ok'; slug: string; credits: number }
  | { status: 'gone' }
  | { status: 'adult' }

/**
 * Adult titles are not imported on demand.
 *
 * 5,067 of the old catalogue's 10,824 films were pornography, precisely because
 * anything searched for got created. Declining here is what stops that
 * happening again.
 */
export async function importMovie(payload: Payload, tmdbId: number): Promise<ImportResult> {
  const m = await tmdb<Record<string, any>>(`/movie/${tmdbId}`, {
    append_to_response: 'credits,videos,release_dates',
  })
  if (!m) return { status: 'gone' }
  if (m.adult) return { status: 'adult' }

  const slug = slugify(m.title, tmdbId)

  const genres = await Promise.all(
    (m.genres ?? []).map((g: { id: number; name: string }) =>
      upsert(payload, 'genres', g.id, { name: g.name, slug: slugify(g.name, 'movie'), medium: 'movie' }, {
        medium: { equals: 'movie' },
      }),
    ),
  )
  const companies = await Promise.all(
    (m.production_companies ?? []).map((c: { id: number; name: string; logo_path?: string }) =>
      upsert(payload, 'production-companies', c.id, {
        name: c.name,
        slug: slugify(c.name, c.id),
        logoPath: c.logo_path ?? null,
      }),
    ),
  )

  const id = await upsert(payload, 'movies', tmdbId, {
    title: m.title,
    slug,
    overview: m.overview || null,
    posterPath: m.poster_path ?? null,
    backdropPath: m.backdrop_path ?? null,
    releaseDate: m.release_date || null,
    runtime: m.runtime ?? null,
    certificate: pickCertificate(m.release_dates),
    popularity: m.popularity ?? null,
    adult: false,
    youtubeUrl: pickTrailer(m.videos),
    genres,
    productionCompanies: companies,
  })

  const credits = await replaceCredits(payload, 'movie', id, m.credits ?? {})
  return { status: 'ok', slug, credits }
}

export async function importShow(payload: Payload, tmdbId: number): Promise<ImportResult> {
  const s = await tmdb<Record<string, any>>(`/tv/${tmdbId}`, {
    append_to_response: 'credits,videos',
  })
  if (!s) return { status: 'gone' }

  const slug = slugify(s.name, tmdbId)

  const genres = await Promise.all(
    (s.genres ?? []).map((g: { id: number; name: string }) =>
      upsert(payload, 'genres', g.id, { name: g.name, slug: slugify(g.name, 'tv'), medium: 'tv' }, {
        medium: { equals: 'tv' },
      }),
    ),
  )
  const networks = await Promise.all(
    (s.networks ?? []).map((n: { id: number; name: string; logo_path?: string }) =>
      upsert(payload, 'networks', n.id, {
        name: n.name,
        slug: slugify(n.name, n.id),
        logoPath: n.logo_path ?? null,
      }),
    ),
  )

  const id = await upsert(payload, 'tv-shows', tmdbId, {
    title: s.name,
    slug,
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
    genres,
    networks,
  })

  const credits = await replaceCredits(payload, 'tvShow', id, s.credits ?? {}, s.created_by)
  return { status: 'ok', slug, credits }
}

/** Search TMDB directly, so results are not limited to what has been imported. */
export type TmdbSearchHit = {
  tmdbId: number
  title: string
  year: string | null
  imagePath: string | null
  subtitle?: string | null
}

export async function searchTmdb(query: string, limit = 20) {
  const q = query.trim()
  if (q.length < 2) return { movies: [], shows: [], people: [] }

  const [movies, shows, people] = await Promise.all([
    tmdb<any>('/search/movie', { query: q, include_adult: 'false' }),
    tmdb<any>('/search/tv', { query: q, include_adult: 'false' }),
    tmdb<any>('/search/person', { query: q, include_adult: 'false' }),
  ])

  const year = (d?: string | null) => (d ? d.slice(0, 4) : null)

  return {
    movies: (movies?.results ?? [])
      .filter((m: any) => !m.adult)
      .slice(0, limit)
      .map(
        (m: any): TmdbSearchHit => ({
          tmdbId: m.id,
          title: m.title,
          year: year(m.release_date),
          imagePath: m.poster_path ?? null,
        }),
      ),
    shows: (shows?.results ?? []).slice(0, limit).map(
      (s: any): TmdbSearchHit => ({
        tmdbId: s.id,
        title: s.name,
        year: year(s.first_air_date),
        imagePath: s.poster_path ?? null,
      }),
    ),
    people: (people?.results ?? [])
      .filter((p: any) => !p.adult)
      .slice(0, limit)
      .map(
        (p: any): TmdbSearchHit => ({
          tmdbId: p.id,
          title: p.name,
          year: null,
          imagePath: p.profile_path ?? null,
          subtitle: p.known_for_department ?? null,
        }),
      ),
  }
}
