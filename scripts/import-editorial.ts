/**
 * Imports the hand-written layer from the old site and reattaches it to the
 * freshly synced catalogue.
 *
 * This is the part TMDB cannot give back: 409 records carrying video essays,
 * podcast episodes and linked articles, plus 18 posts and 8 pages.
 *
 * Order matters — posts are created first, because a handful of the article
 * links point at them rather than out to the web.
 *
 * Run with:  npx tsx scripts/import-editorial.ts [--dry-run]
 */

import { getPayload } from 'payload'
import config from '../src/payload.config'
import { convertHTMLToLexical, editorConfigFactory } from '@payloadcms/richtext-lexical'
import { JSDOM } from 'jsdom'
import { readFile, writeFile } from 'node:fs/promises'

const DRY = process.argv.includes('--dry-run')

type EditorialRecord = {
  wpId: number
  type: string | null
  title: string | null
  slug: string | null
  tmdbId: number | null
  customContent: string | null
  videoEmbeds: Array<{ video_url?: string; video_title?: string }>
  podcasts: Array<{ title?: string; episode_title?: string; url?: string }>
  articles: Array<{
    internal_link?: string
    post_link?: string
    url?: string
    title?: string
    image?: string
  }>
}

type ArticleRecord = {
  wpId: number
  type: 'post' | 'page'
  title: string
  slug: string
  status: string
  date: string
  excerpt: string | null
  content: string | null
}

/** ACF stores post-object references PHP-serialised: a:1:{i:0;s:4:"6131";} */
function parseSerialisedIds(raw: string | undefined): number[] {
  if (!raw) return []
  const ids: number[] = []
  for (const m of raw.matchAll(/s:\d+:"(\d+)"/g)) ids.push(Number(m[1]))
  for (const m of raw.matchAll(/i:\d+;i:(\d+)/g)) ids.push(Number(m[1]))
  return [...new Set(ids)]
}

/**
 * WordPress content is Gutenberg block HTML; Payload stores Lexical JSON.
 * The converter needs the sanitised editor config to know which node types are
 * permitted, so it is built once and reused.
 */
type EditorConfig = Awaited<ReturnType<typeof editorConfigFactory.default>>

type LexicalNode = { type?: string; children?: LexicalNode[]; [k: string]: unknown }

/**
 * Inline <img> tags become Lexical upload nodes pointing at WordPress
 * attachment ids, which do not exist in Payload's media library — so the
 * document fails validation with "not a valid upload ID".
 *
 * Media has not been migrated yet, so these are removed and recorded rather
 * than silently dropped. Once media is imported they can be reinstated.
 */
function stripUploadNodes(node: LexicalNode, dropped: unknown[]): LexicalNode {
  if (Array.isArray(node.children)) {
    node.children = node.children.filter((child) => {
      if (child?.type === 'upload') {
        dropped.push({ value: child.value, relationTo: child.relationTo })
        return false
      }
      stripUploadNodes(child, dropped)
      return true
    })
  }
  return node
}

const makeToLexical =
  (editorConfig: EditorConfig, dropped: unknown[]) =>
  (html: string) => {
    const state = convertHTMLToLexical({ editorConfig, html, JSDOM }) as unknown as {
      root: LexicalNode
    }
    stripUploadNodes(state.root, dropped)
    return state
  }

/** Slugs must be unique; WordPress guarantees it, but empties need a fallback. */
const safeSlug = (slug: string | null, fallback: string | number) =>
  slug && slug.trim() ? slug.trim() : `item-${fallback}`

const slugify = (s: string, suffix: string | number) =>
  `${
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'person'
  }-${suffix}`

/** Pull a single person from TMDB so their editorial content is not lost. */
async function rescuePerson(
  payload: Awaited<ReturnType<typeof getPayload>>,
  tmdbId: number,
): Promise<{ id: number | string } | undefined> {
  const key = process.env.TMDB_API_KEY
  if (!key) return undefined
  const res = await fetch(`https://api.themoviedb.org/3/person/${tmdbId}?api_key=${key}`)
  if (!res.ok) return undefined
  const p = (await res.json()) as {
    name: string
    profile_path?: string | null
    known_for_department?: string | null
    gender?: number | null
    birthday?: string | null
    deathday?: string | null
    place_of_birth?: string | null
    biography?: string | null
  }
  return payload.create({
    collection: 'people',
    depth: 0,
    data: {
      tmdbId,
      name: p.name,
      slug: slugify(p.name, tmdbId),
      profileImagePath: p.profile_path ?? null,
      knownForDepartment: p.known_for_department ?? null,
      gender: p.gender != null ? String(p.gender) : undefined,
      birthDate: p.birthday || undefined,
      deathDate: p.deathday || undefined,
      placeOfBirth: p.place_of_birth || undefined,
      biography: p.biography || undefined,
    } as never,
  })
}

async function main() {
  const payload = await getPayload({ config })
  const editorConfig = await editorConfigFactory.default({ config: payload.config })
  const droppedInlineImages: unknown[] = []
  const toLexical = makeToLexical(editorConfig, droppedInlineImages)

  const editorial: EditorialRecord[] = JSON.parse(
    await readFile('./data/editorial.json', 'utf8'),
  )
  const articles: ArticleRecord[] = JSON.parse(await readFile('./data/articles.json', 'utf8'))

  const report = {
    posts: { created: 0, skipped: 0 },
    pages: { created: 0, skipped: 0 },
    matched: { movies: 0, 'tv-shows': 0, people: 0 },
    unmatched: [] as Array<{ title: string | null; type: string | null; tmdbId: number | null }>,
    videos: 0,
    podcasts: 0,
    podcastsSkipped: [] as string[],
    articleLinks: 0,
    imagesDeferred: 0,
    internalLinksResolved: 0,
    internalLinksUnresolved: 0,
    rescuedPeople: [] as string[],
  }

  /* ---------------- posts and pages first ---------------- */

  const wpPostToPayloadId = new Map<number, number | string>()

  for (const a of articles) {
    const collection = a.type === 'page' ? 'pages' : 'posts'
    const slug = safeSlug(a.slug, a.wpId)

    const existing = await payload.find({
      collection,
      where: { slug: { equals: slug } },
      limit: 1,
      depth: 0,
    })
    if (existing.docs.length) {
      wpPostToPayloadId.set(a.wpId, existing.docs[0].id)
      report[collection === 'pages' ? 'pages' : 'posts'].skipped++
      continue
    }

    if (DRY) {
      report[collection === 'pages' ? 'pages' : 'posts'].created++
      continue
    }

    const content = a.content ? toLexical(a.content) : undefined

    const data: Record<string, unknown> =
      collection === 'pages'
        ? { title: a.title, slug, content }
        : {
            title: a.title,
            slug,
            content,
            excerpt: a.excerpt || undefined,
            publishedAt: a.date || undefined,
            _status: a.status === 'publish' ? 'published' : 'draft',
          }

    const created = await payload.create({ collection, data: data as never, depth: 0 })
    wpPostToPayloadId.set(a.wpId, created.id)
    report[collection === 'pages' ? 'pages' : 'posts'].created++
  }

  /* ---------------- editorial onto catalogue records ---------------- */

  // The old actor/director/writer/... post types all became `people`.
  const collectionFor = (type: string | null) =>
    type === 'movie'
      ? ('movies' as const)
      : type === 'tv_show'
        ? ('tv-shows' as const)
        : type === null
          ? null
          : ('people' as const)

  for (const rec of editorial) {
    const collection = collectionFor(rec.type)
    if (!collection || rec.tmdbId === null) {
      report.unmatched.push({ title: rec.title, type: rec.type, tmdbId: rec.tmdbId })
      continue
    }

    const found = await payload.find({
      collection,
      where: { tmdbId: { equals: rec.tmdbId } },
      limit: 1,
      depth: 0,
    })

    // Only the id is used from here on; typing it narrowly lets a record
    // fetched from TMDB stand in for one found in the database.
    let target: { id: string | number } | undefined = found.docs[0]

    // People are only created from the top-30 billed cast of synced films, so
    // someone written about but never billed that highly will be absent. Rather
    // than drop their content, fetch them from TMDB.
    if (!target && collection === 'people' && !DRY) {
      const rescued = await rescuePerson(payload, rec.tmdbId)
      if (rescued) {
        target = rescued
        report.rescuedPeople.push(rec.title ?? String(rec.tmdbId))
      }
    }

    if (!target) {
      report.unmatched.push({ title: rec.title, type: rec.type, tmdbId: rec.tmdbId })
      continue
    }

    const videoEmbeds = rec.videoEmbeds
      .filter((v) => v.video_url)
      .map((v) => ({ videoUrl: v.video_url!, videoTitle: v.video_title || undefined }))

    // Two records carry only an episode title with no URL — nothing to link to.
    const podcasts = rec.podcasts
      .filter((p) => {
        if (p.url) return true
        report.podcastsSkipped.push(`${rec.title}: ${p.episode_title ?? p.title ?? '(untitled)'}`)
        return false
      })
      .map((p) => ({
        title: p.title || undefined,
        episodeTitle: p.episode_title || undefined,
        url: p.url!,
      }))

    const articleLinks = rec.articles.map((a) => {
      const internal = a.internal_link === 'yes'
      if (internal) {
        const [wpId] = parseSerialisedIds(a.post_link)
        const resolved = wpId ? wpPostToPayloadId.get(wpId) : undefined
        if (resolved) report.internalLinksResolved++
        else report.internalLinksUnresolved++
        return { internalLink: true, post: resolved ?? undefined }
      }
      // Article images are WordPress attachment ids. Media has not been
      // migrated, so the link is imported without its image for now and the
      // id is recorded for a later pass.
      if (a.image) report.imagesDeferred++
      return {
        internalLink: false,
        url: a.url || undefined,
        title: a.title || undefined,
      }
    })

    report.videos += videoEmbeds.length
    report.podcasts += podcasts.length
    report.articleLinks += articleLinks.length
    report.matched[collection]++

    if (!DRY) {
      await payload.update({
        collection,
        id: target.id,
        data: { videoEmbeds, podcasts, articles: articleLinks } as never,
        depth: 0,
      })
    }
  }

  /* ---------------- the image backlog, for a later pass ---------------- */

  const imageBacklog: Array<{ tmdbId: number; type: string; attachmentId: string; title?: string }> =
    []
  for (const rec of editorial) {
    for (const a of rec.articles) {
      if (a.image && rec.tmdbId) {
        imageBacklog.push({
          tmdbId: rec.tmdbId,
          type: rec.type ?? 'unknown',
          attachmentId: a.image,
          title: a.title,
        })
      }
    }
  }
  if (!DRY) {
    await writeFile('./data/article-images-todo.json', JSON.stringify(imageBacklog, null, 2))
    await writeFile(
      './data/inline-images-todo.json',
      JSON.stringify(droppedInlineImages, null, 2),
    )
  }

  console.log(`
${DRY ? 'DRY RUN — nothing written\n' : ''}Posts        created ${report.posts.created}   already present ${report.posts.skipped}
Pages        created ${report.pages.created}   already present ${report.pages.skipped}

Editorial attached to:
  movies     ${report.matched.movies}
  tv-shows   ${report.matched['tv-shows']}
  people     ${report.matched.people}
  unmatched  ${report.unmatched.length}

  video embeds   ${report.videos}
  podcasts       ${report.podcasts}${report.podcastsSkipped.length ? `  (${report.podcastsSkipped.length} skipped, no URL)` : ''}
  article links  ${report.articleLinks}
    internal resolved   ${report.internalLinksResolved}
    internal unresolved ${report.internalLinksUnresolved}
    images deferred     ${report.imagesDeferred} → data/article-images-todo.json

  inline images stripped from post content: ${droppedInlineImages.length} → data/inline-images-todo.json
`)

  if (report.rescuedPeople.length) {
    console.log(`Fetched from TMDB because they were absent from the catalogue:`)
    for (const n of report.rescuedPeople) console.log(`  ${n}`)
    console.log()
  }
  if (report.unmatched.length) {
    console.log('Unmatched records:')
    for (const u of report.unmatched.slice(0, 20)) {
      console.log(`  [${u.type}] ${u.title} (tmdb ${u.tmdbId})`)
    }
  }
  if (report.podcastsSkipped.length) {
    console.log('\nPodcasts skipped for having no URL:')
    for (const p of [...new Set(report.podcastsSkipped)]) console.log(`  ${p}`)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
