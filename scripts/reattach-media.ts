/**
 * Uploads the extracted editorial images into Payload and reattaches them.
 *
 * Three destinations:
 *   1. article thumbnails on movies / tv-shows / people
 *   2. featured images on posts and pages
 *   3. images inline in post content, which need real Lexical upload nodes
 *
 * Idempotent: media is matched by filename, so re-running updates rather than
 * duplicating.
 *
 * Run with:  npx tsx scripts/reattach-media.ts [--dry-run]
 */

import { getPayload } from 'payload'
import config from '../src/payload.config'
import { convertHTMLToLexical, editorConfigFactory } from '@payloadcms/richtext-lexical'
import { JSDOM } from 'jsdom'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const DRY = process.argv.includes('--dry-run')
const SRC = path.resolve('./media-src/app/wp-content/uploads')

type Manifest = {
  files: Array<{
    attachmentId: string
    file: string
    title: string | null
    mime: string | null
    kinds: string[]
  }>
  featuredFor: Record<string, string>
  inlineFor: Record<string, Array<{ src: string; attachmentId: string }>>
}

type LexicalNode = { type?: string; children?: LexicalNode[]; text?: string; [k: string]: unknown }

const MARKER = /^@@IMG:(\d+)@@$/

/**
 * Swap the placeholder paragraphs back for Lexical upload nodes.
 *
 * Images are replaced with markers *before* conversion rather than after,
 * because the HTML converter turns <img> into upload nodes with no usable
 * value — it has no way to know which Payload media a WordPress URL refers to.
 * Going via markers keeps each image in its original position.
 */
function replaceMarkers(
  node: LexicalNode,
  mediaFor: (attachmentId: string) => number | string | undefined,
  stats: { replaced: number; missing: number },
): LexicalNode {
  if (!Array.isArray(node.children)) return node

  node.children = node.children.map((child) => {
    const text = child?.children?.length === 1 ? child.children[0]?.text : undefined
    const m = typeof text === 'string' ? text.trim().match(MARKER) : null

    if (m) {
      const id = mediaFor(m[1])
      if (id === undefined) {
        stats.missing++
        return child
      }
      stats.replaced++
      return {
        type: 'upload',
        relationTo: 'media',
        value: id,
        fields: null,
        format: '',
        version: 3,
      }
    }
    replaceMarkers(child, mediaFor, stats)
    return child
  })
  return node
}

async function main() {
  const payload = await getPayload({ config })
  const editorConfig = await editorConfigFactory.default({ config: payload.config })

  const manifest: Manifest = JSON.parse(await readFile('./data/media-manifest.json', 'utf8'))
  const editorial = JSON.parse(await readFile('./data/editorial.json', 'utf8'))
  const articles = JSON.parse(await readFile('./data/articles.json', 'utf8'))

  /* ---------------- 1. upload ---------------- */

  const mediaByAttachment = new Map<string, number | string>()
  let uploaded = 0
  let reused = 0
  let failedUploads: string[] = []

  for (const f of manifest.files) {
    const filename = path.basename(f.file)

    const existing = await payload.find({
      collection: 'media',
      where: { filename: { equals: filename } },
      limit: 1,
      depth: 0,
    })
    if (existing.docs.length) {
      mediaByAttachment.set(f.attachmentId, existing.docs[0].id)
      reused++
      continue
    }
    if (DRY) continue

    try {
      const created = await payload.create({
        collection: 'media',
        data: { alt: f.title || filename.replace(/\.[a-z]+$/i, '').replace(/[-_]+/g, ' ') },
        filePath: path.join(SRC, f.file),
      })
      mediaByAttachment.set(f.attachmentId, created.id)
      uploaded++
    } catch (err) {
      failedUploads.push(`${filename}: ${(err as Error).message}`)
    }
  }

  const mediaFor = (id: string) => mediaByAttachment.get(String(id))

  /* ---------------- 2. article thumbnails ---------------- */

  const collectionFor = (type: string | null) =>
    type === 'movie'
      ? ('movies' as const)
      : type === 'tv_show'
        ? ('tv-shows' as const)
        : ('people' as const)

  let articlesUpdated = 0
  let imagesAttached = 0

  for (const rec of editorial) {
    if (!rec.articles.some((a: { image?: string }) => a.image)) continue
    if (rec.tmdbId === null) continue

    const collection = collectionFor(rec.type)
    const found = await payload.find({
      collection,
      where: { tmdbId: { equals: rec.tmdbId } },
      limit: 1,
      depth: 0,
    })
    if (!found.docs.length) continue

    const doc = found.docs[0] as unknown as {
      id: number | string
      articles?: Array<Record<string, unknown>>
    }
    const current = doc.articles ?? []

    // editorial.json and the stored array are in the same order.
    const merged = current.map((existing, i) => {
      const source = rec.articles[i]
      const media = source?.image ? mediaFor(source.image) : undefined
      if (media !== undefined) imagesAttached++
      return { ...existing, image: media ?? (existing.image as unknown) ?? undefined }
    })

    if (!DRY) {
      await payload.update({
        collection,
        id: doc.id,
        data: { articles: merged } as never,
        depth: 0,
      })
    }
    articlesUpdated++
  }

  /* ---------------- 3. featured images + inline content ---------------- */

  let featuredSet = 0
  const inlineStats = { replaced: 0, missing: 0 }
  let postsRewritten = 0

  for (const a of articles) {
    const collection = a.type === 'page' ? 'pages' : 'posts'
    const slug = a.slug && a.slug.trim() ? a.slug.trim() : `item-${a.wpId}`

    const found = await payload.find({
      collection,
      where: { slug: { equals: slug } },
      limit: 1,
      depth: 0,
    })
    if (!found.docs.length) continue
    const doc = found.docs[0]

    const data: Record<string, unknown> = {}

    const featuredAttachment = manifest.featuredFor[String(a.wpId)]
    if (featuredAttachment && collection === 'posts') {
      const media = mediaFor(featuredAttachment)
      if (media !== undefined) {
        data.featuredImage = media
        featuredSet++
      }
    }

    const inline = manifest.inlineFor[String(a.wpId)]
    if (inline?.length && a.content) {
      // Replace each <img> with a marker paragraph before conversion.
      let html = a.content
      for (const { src, attachmentId } of inline) {
        const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        html = html.replace(
          new RegExp(`<img[^>]+src=["']${escaped}["'][^>]*>`, 'gi'),
          `<p>@@IMG:${attachmentId}@@</p>`,
        )
      }
      const state = convertHTMLToLexical({ editorConfig, html, JSDOM }) as unknown as {
        root: LexicalNode
      }
      replaceMarkers(state.root, mediaFor, inlineStats)
      data.content = state
      postsRewritten++
    }

    if (Object.keys(data).length && !DRY) {
      await payload.update({ collection, id: doc.id, data: data as never, depth: 0 })
    }
  }

  console.log(`
${DRY ? 'DRY RUN — nothing written\n' : ''}Media
  uploaded            ${uploaded}
  already present     ${reused}
  failed              ${failedUploads.length}

Article thumbnails
  records updated     ${articlesUpdated}
  images attached     ${imagesAttached}

Posts
  featured images set ${featuredSet}
  content rewritten   ${postsRewritten}
  inline images placed ${inlineStats.replaced}${inlineStats.missing ? `  (${inlineStats.missing} markers left unresolved)` : ''}
`)

  if (failedUploads.length) {
    console.log('Upload failures:')
    for (const f of failedUploads.slice(0, 10)) console.log(`  ${f}`)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
