#!/usr/bin/env node
/**
 * Works out exactly which uploaded files the editorial layer needs, and writes
 * a list for tar to extract.
 *
 * The uploads folder is 1.1 GB across 60,290 files, almost all of it TMDB
 * artwork that is now served from their CDN. Only a couple of hundred files are
 * genuinely yours: article thumbnails, post featured images, and images inline
 * in post content.
 *
 * Usage: node scripts/prepare-media.mjs
 */

import { readFile, writeFile } from 'node:fs/promises'

const read = async (p) => JSON.parse(await readFile(p, 'utf8'))

const { attachedFile, thumbnails, attachments } = await read('./data/attachments.json')
const articles = await read('./data/articles.json')
const articleImages = await read('./data/article-images-todo.json')

/** attachment id -> what references it, so the upload step can label things */
const needed = new Map()

const want = (id, kind) => {
  const key = String(id)
  const file = attachedFile[key]
  if (!file) return false
  if (!needed.has(key)) {
    needed.set(key, {
      attachmentId: key,
      file,
      title: attachments[key]?.title ?? null,
      mime: attachments[key]?.mime ?? null,
      kinds: [],
    })
  }
  needed.get(key).kinds.push(kind)
  return true
}

// 1. Article thumbnails, referenced by ACF as a bare attachment id.
for (const a of articleImages) want(a.attachmentId, 'article')

// 2. Featured images for posts and pages.
const featuredFor = {} // wpPostId -> attachmentId
for (const a of articles) {
  const t = thumbnails[a.wpId]
  if (t && want(t, 'featured')) featuredFor[a.wpId] = String(t)
}

// 3. Images inline in post content. WordPress rewrites <img src> to a sized
//    variant (foo-768x512.jpg); we want the original so Payload can generate
//    its own sizes.
const byFile = new Map()
for (const [id, f] of Object.entries(attachedFile)) byFile.set(f, id)

const inlineFor = {} // wpPostId -> [{ src, attachmentId }]
for (const a of articles) {
  const found = []
  for (const m of String(a.content ?? '').matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    const src = m[1]
    const rel = decodeURIComponent(src).split('/wp-content/uploads/')[1]
    if (!rel) continue
    const original = rel.replace(/-\d+x\d+(\.[a-z]+)$/i, '$1')
    const id = byFile.get(rel) ?? byFile.get(original)
    if (id && want(id, 'inline')) found.push({ src, attachmentId: String(id) })
  }
  if (found.length) inlineFor[a.wpId] = found
}

const manifest = {
  files: [...needed.values()],
  featuredFor,
  inlineFor,
}

await writeFile('./data/media-manifest.json', JSON.stringify(manifest, null, 2))

// tar include list, paths as they appear inside the archive
const paths = manifest.files.map((f) => `./app/wp-content/uploads/${f.file}`)
await writeFile('./data/media-files.txt', paths.join('\n') + '\n')

const byKind = {}
for (const f of manifest.files) for (const k of new Set(f.kinds)) byKind[k] = (byKind[k] ?? 0) + 1

console.log(`
Distinct files to extract  ${manifest.files.length}
  used as article image    ${byKind.article ?? 0}
  used as featured image   ${byKind.featured ?? 0}
  used inline in content   ${byKind.inline ?? 0}

Posts/pages with a featured image  ${Object.keys(featuredFor).length} of ${articles.length}
Posts with inline images           ${Object.keys(inlineFor).length}

Wrote data/media-manifest.json and data/media-files.txt
`)
