#!/usr/bin/env node
/**
 * Pulls the irreplaceable content out of the old WordPress dump.
 *
 * The dump is 1.7 GB of MySQL from Navicat, far too big to load into memory or
 * to import just to read a few thousand rows. So we stream it, keep only what
 * TMDB cannot give us back, and write JSON for the importer.
 *
 * What we keep:
 *   - the 465-odd titles carrying hand-written content, videos, podcasts, articles
 *   - the 18 posts and 8 pages
 *   - every post's TMDB id, so the editorial layer can be re-attached after sync
 *
 * What we discard: everything TMDB is the source of truth for, plus the
 * Wordfence, statistics, cache and Action Scheduler tables.
 *
 * Usage: node scripts/extract-wordpress.mjs ../watchlisterco.sql ./data
 */

import { createReadStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import path from 'node:path'

const [, , dumpPath, outDirArg] = process.argv
if (!dumpPath) {
  console.error('Usage: node scripts/extract-wordpress.mjs <dump.sql> [outDir]')
  process.exit(1)
}
const outDir = outDirArg ?? './data'

/* ------------------------------------------------------------------ *
 * SQL value parsing
 * ------------------------------------------------------------------ */

/**
 * Splits the inside of a VALUES (...) tuple into typed JS values.
 *
 * Hand-rolled rather than regex because post_content is full of apostrophes,
 * escaped backslashes and commas, and a regex that looks right will quietly
 * mangle a few hundred rows somewhere in the middle of a 1.7 GB file.
 */
function parseTuple(body) {
  const values = []
  let i = 0
  const n = body.length

  while (i < n) {
    while (i < n && /[\s,]/.test(body[i])) i++
    if (i >= n) break

    if (body[i] === "'") {
      i++
      let out = ''
      while (i < n) {
        const ch = body[i]
        if (ch === '\\') {
          // MySQL backslash escapes.
          const next = body[i + 1]
          const map = { n: '\n', r: '\r', t: '\t', 0: '\0', b: '\b', Z: '\x1a' }
          out += map[next] ?? next
          i += 2
          continue
        }
        if (ch === "'") {
          // Doubled '' is a literal quote; a lone ' ends the string.
          if (body[i + 1] === "'") {
            out += "'"
            i += 2
            continue
          }
          i++
          break
        }
        out += ch
        i++
      }
      values.push(out)
      continue
    }

    // Unquoted: a number, NULL, or a bare keyword.
    let start = i
    while (i < n && body[i] !== ',') i++
    const raw = body.slice(start, i).trim()
    if (raw === 'NULL') values.push(null)
    else if (raw !== '' && !Number.isNaN(Number(raw))) values.push(Number(raw))
    else values.push(raw)
  }

  return values
}

/** True when the line has an odd number of unescaped quotes, i.e. a string is still open. */
function hasOpenString(line) {
  let open = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\') { i++; continue }
    if (ch === "'") open = !open
  }
  return open
}

/* ------------------------------------------------------------------ *
 * What we are looking for
 * ------------------------------------------------------------------ */

const EDITORIAL_ROOTS = ['custom_content', 'video_embeds', 'podcasts', 'select_articles']
/**
 * There is no generic `tmdb_id` key — each post type carries its own, named
 * after the old CPT rather than after what TMDB calls it. Crew members are
 * doubly inconsistent: some rows use the role-specific key, some use
 * `tmdb_person_id`, so both are read and either will do.
 */
const TMDB_KEYS = new Set([
  'tmdb_movie_id',
  'tmdb_tv_show_id',
  'tmdb_actor_id',
  'tmdb_person_id',
  'tmdb_director_id',
  'tmdb_writer_id',
  'tmdb_composer_id',
  'tmdb_creator_id',
  'tmdb_company_id',
  'tmdb_network_id',
])

/** Preference order when a record carries more than one of the above. */
const TMDB_KEY_ORDER = [
  'tmdb_movie_id',
  'tmdb_tv_show_id',
  'tmdb_actor_id',
  'tmdb_director_id',
  'tmdb_writer_id',
  'tmdb_composer_id',
  'tmdb_creator_id',
  'tmdb_person_id',
  'tmdb_company_id',
  'tmdb_network_id',
]

const resolveTmdbId = (bucket) => {
  for (const key of TMDB_KEY_ORDER) {
    const raw = bucket[key]
    if (raw === undefined || raw === null || raw === '') continue
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

/** Types that should always have a TMDB id; anything else is editorial. */
const TMDB_BACKED = new Set([
  'movie', 'tv_show', 'actor', 'director', 'writer',
  'composer', 'creator', 'production_company', 'network',
])
const WANTED_TYPES = new Set([
  'movie', 'tv_show', 'actor', 'director', 'writer', 'composer', 'creator',
  'production_company', 'network', 'country', 'language', 'post', 'page',
])

/** ACF stores repeaters flattened: `podcasts_0_title`. Recover index and leaf. */
function parseRepeaterKey(key) {
  const m = key.match(/^([a-z_]+?)_(\d+)_(.+)$/)
  if (!m) return null
  return { root: m[1], index: Number(m[2]), leaf: m[3] }
}

const isEditorialKey = (key) => {
  if (key.startsWith('_')) return false // ACF shadow rows point at field keys, not values
  if (EDITORIAL_ROOTS.includes(key)) return true
  const rep = parseRepeaterKey(key)
  return Boolean(rep && EDITORIAL_ROOTS.includes(rep.root))
}

/* ------------------------------------------------------------------ *
 * Streaming pass
 * ------------------------------------------------------------------ */

const posts = new Map() // id -> { type, title, slug, content, excerpt, status, date }
const meta = new Map() // postId -> { key: value }

let statement = ''
let lineNo = 0
let matchedPosts = 0
let matchedMeta = 0

const POSTS_PREFIX = 'INSERT INTO `wp_posts`'
const META_PREFIX = 'INSERT INTO `wp_postmeta`'

const rl = createInterface({
  input: createReadStream(dumpPath, { encoding: 'utf8', highWaterMark: 4 * 1024 * 1024 }),
  crlfDelay: Infinity,
})

process.stdout.write('Scanning dump')

for await (const line of rl) {
  lineNo++
  if (lineNo % 250_000 === 0) process.stdout.write('.')

  // Only two tables matter; skip the other ~60 without parsing them.
  if (statement === '' && !line.startsWith(POSTS_PREFIX) && !line.startsWith(META_PREFIX)) {
    continue
  }

  statement += (statement ? '\n' : '') + line

  // A statement can wrap across lines when post_content contains a raw newline.
  if (!statement.trimEnd().endsWith(');') || hasOpenString(statement)) continue

  const isPosts = statement.startsWith(POSTS_PREFIX)
  const open = statement.indexOf(' VALUES (')
  if (open === -1) { statement = ''; continue }

  const body = statement.slice(open + ' VALUES ('.length, statement.trimEnd().length - 2)
  const v = parseTuple(body)
  statement = ''

  if (isPosts) {
    // (ID, post_author, post_date, post_date_gmt, post_content, post_title,
    //  post_excerpt, post_status, comment_status, ping_status, post_password,
    //  post_name, to_ping, pinged, post_modified, post_modified_gmt,
    //  post_content_filtered, post_parent, guid, menu_order, post_type, ...)
    const [id, , date, , content, title, excerpt, status, , , , name] = v
    const type = v[20]
    if (!WANTED_TYPES.has(type)) continue
    if (status === 'trash' || status === 'auto-draft') continue
    posts.set(id, { id, type, title, slug: name, content, excerpt, status, date })
    matchedPosts++
  } else {
    // (meta_id, post_id, meta_key, meta_value)
    const [, postId, key, value] = v
    if (typeof key !== 'string') continue
    if (!isEditorialKey(key) && !TMDB_KEYS.has(key)) continue
    if (value === null || value === '') continue
    let bucket = meta.get(postId)
    if (!bucket) { bucket = {}; meta.set(postId, bucket) }
    bucket[key] = value
    matchedMeta++
  }
}

process.stdout.write('\n')

/* ------------------------------------------------------------------ *
 * Reassemble ACF repeaters into real objects
 * ------------------------------------------------------------------ */

function buildRepeaters(bucket) {
  const groups = {} // root -> index -> { leaf: value }
  for (const [key, value] of Object.entries(bucket)) {
    const rep = parseRepeaterKey(key)
    if (!rep || !EDITORIAL_ROOTS.includes(rep.root)) continue
    groups[rep.root] ??= {}
    groups[rep.root][rep.index] ??= {}
    groups[rep.root][rep.index][rep.leaf] = value
  }
  const out = {}
  for (const [root, byIndex] of Object.entries(groups)) {
    out[root] = Object.keys(byIndex)
      .map(Number)
      .sort((a, b) => a - b)
      .map((i) => byIndex[i])
  }
  return out
}

const editorial = []
const orphans = []

for (const [postId, bucket] of meta) {
  const post = posts.get(postId)
  const repeaters = buildRepeaters(bucket)
  const custom = bucket.custom_content

  const hasEditorial =
    Boolean(custom) ||
    (repeaters.video_embeds?.length ?? 0) > 0 ||
    (repeaters.podcasts?.length ?? 0) > 0 ||
    (repeaters.select_articles?.length ?? 0) > 0

  if (!hasEditorial) continue

  const record = {
    wpId: postId,
    type: post?.type ?? null,
    title: post?.title ?? null,
    slug: post?.slug ?? null,
    tmdbId: resolveTmdbId(bucket),
    customContent: custom || null,
    videoEmbeds: repeaters.video_embeds ?? [],
    podcasts: repeaters.podcasts ?? [],
    articles: repeaters.select_articles ?? [],
  }

  // A TMDB-backed record with no id cannot be reattached automatically after
  // the sync, so it is reported rather than dropped. Posts and pages have no
  // TMDB counterpart by design and are handled separately below.
  const needsTmdbId = post && TMDB_BACKED.has(post.type)
  if (!post || (needsTmdbId && record.tmdbId === null)) orphans.push(record)
  else editorial.push(record)
}

/** The written-from-scratch posts and pages, which have no TMDB counterpart. */
const articles = [...posts.values()]
  .filter((p) => p.type === 'post' || p.type === 'page')
  .map((p) => ({
    wpId: p.id,
    type: p.type,
    title: p.title,
    slug: p.slug,
    status: p.status,
    date: p.date,
    excerpt: p.excerpt || null,
    content: p.content || null,
  }))

/**
 * The seed lists for the sync, so the new catalogue is the same catalogue.
 * Also doubles as a data-quality report: the old site accumulated both
 * duplicate records pointing at one TMDB id, and records with no id at all.
 */
const tmdbSeeds = {}
const idMap = {} // wpId -> tmdbId, for reattaching relationships after sync
const quality = {}

for (const post of posts.values()) {
  if (!TMDB_BACKED.has(post.type)) continue
  quality[post.type] ??= { total: 0, withId: 0, missing: [], duplicates: {} }
  const q = quality[post.type]
  q.total++

  const id = resolveTmdbId(meta.get(post.id) ?? {})
  if (id === null) {
    // Full list, not a sample — these are the records that need recovering by
    // name search, so a truncated list would silently lose some of them.
    // The slug often carries a disambiguating year, e.g. "dune-2021".
    q.missing.push({ wpId: post.id, title: post.title, slug: post.slug })
    continue
  }

  q.withId++
  idMap[post.id] = id
  tmdbSeeds[post.type] ??= []
  tmdbSeeds[post.type].push(id)
}

// Collapse to unique ids, recording which ones appeared more than once.
for (const [type, ids] of Object.entries(tmdbSeeds)) {
  const seen = new Map()
  for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1)
  tmdbSeeds[type] = [...seen.keys()]
  const dupes = [...seen.entries()].filter(([, c]) => c > 1)
  quality[type].duplicates = {
    count: dupes.length,
    examples: dupes.slice(0, 20).map(([id, c]) => ({ tmdbId: id, records: c })),
  }
}

await mkdir(outDir, { recursive: true })
const write = (name, data) =>
  writeFile(path.join(outDir, name), JSON.stringify(data, null, 2))

/**
 * Old slug → TMDB id, per type.
 *
 * The new slugs carry a TMDB id suffix ("dune-438631") while the old ones
 * carried a year ("dune-2021"), so redirecting /movie/dune-2021 needs a lookup
 * rather than a pattern. This is that lookup table.
 */
const legacySlugs = {}
for (const post of posts.values()) {
  if (!TMDB_BACKED.has(post.type)) continue
  const id = idMap[post.id]
  if (!id || !post.slug) continue
  legacySlugs[post.type] ??= {}
  // First writer wins: duplicates in the old data point at the same TMDB id.
  legacySlugs[post.type][post.slug] ??= id
}
await write('legacy-slugs.json', legacySlugs)

await write('editorial.json', editorial)
await write('articles.json', articles)
await write('tmdb-seeds.json', tmdbSeeds)
await write('id-map.json', idMap)
await write('data-quality.json', quality)
if (orphans.length) await write('orphans.json', orphans)

const pad = (s, n) => String(s).padEnd(n)
const rows = Object.entries(quality)
  .sort((a, b) => b[1].total - a[1].total)
  .map(([type, q]) => {
    const missing = q.total - q.withId
    return `  ${pad(type, 20)}${pad(q.total.toLocaleString(), 10)}${pad(
      tmdbSeeds[type]?.length.toLocaleString() ?? '0',
      10,
    )}${pad(missing || '—', 10)}${q.duplicates.count || '—'}`
  })

console.log(`
Lines read          ${lineNo.toLocaleString()}
Posts kept          ${matchedPosts.toLocaleString()}
Meta rows kept      ${matchedMeta.toLocaleString()}

  ${pad('type', 20)}${pad('records', 10)}${pad('unique', 10)}${pad('no id', 10)}dupes
${rows.join('\n')}

Editorial records   ${editorial.length}
  with custom copy  ${editorial.filter((e) => e.customContent).length}
  with videos       ${editorial.filter((e) => e.videoEmbeds.length).length}
  with podcasts     ${editorial.filter((e) => e.podcasts.length).length}
  with articles     ${editorial.filter((e) => e.articles.length).length}
Posts and pages     ${articles.length}
${orphans.length ? `\n⚠  ${orphans.length} editorial record(s) have no TMDB id — see orphans.json` : ''}
Written to ${path.resolve(outDir)}
`)
