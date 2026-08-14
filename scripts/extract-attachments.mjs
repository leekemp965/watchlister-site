#!/usr/bin/env node
/**
 * Second pass over the WordPress dump, for the media the first pass skipped.
 *
 * The original extract deliberately ignored attachments — TMDB artwork comes
 * from their CDN, so there was no reason to care about the 1.1 GB uploads
 * folder. But the editorial layer references uploads of its own: article
 * thumbnails, post featured images, and images inline in post content. Those
 * are yours, not TMDB's, so they need to come across.
 *
 * Collects:
 *   - attachment id -> file path, from `_wp_attached_file`
 *   - post id -> attachment id, from `_thumbnail_id` (featured images)
 *   - attachment id -> guid/url, for matching inline <img> sources
 *
 * Usage: node scripts/extract-attachments.mjs ../watchlisterco.sql ./data
 */

import { createReadStream } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import path from 'node:path'

const [, , dumpPath, outDir = './data'] = process.argv
if (!dumpPath) {
  console.error('Usage: node scripts/extract-attachments.mjs <dump.sql> [outDir]')
  process.exit(1)
}

/* Same tokeniser as the main extract — post_content is full of apostrophes and
 * escaped backslashes, so a regex would quietly mangle rows. */
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
          const next = body[i + 1]
          const map = { n: '\n', r: '\r', t: '\t', 0: '\0', b: '\b', Z: '\x1a' }
          out += map[next] ?? next
          i += 2
          continue
        }
        if (ch === "'") {
          if (body[i + 1] === "'") { out += "'"; i += 2; continue }
          i++
          break
        }
        out += ch
        i++
      }
      values.push(out)
      continue
    }
    const start = i
    while (i < n && body[i] !== ',') i++
    const raw = body.slice(start, i).trim()
    if (raw === 'NULL') values.push(null)
    else if (raw !== '' && !Number.isNaN(Number(raw))) values.push(Number(raw))
    else values.push(raw)
  }
  return values
}

function hasOpenString(line) {
  let open = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\') { i++; continue }
    if (ch === "'") open = !open
  }
  return open
}

const POSTS_PREFIX = 'INSERT INTO `wp_posts`'
const META_PREFIX = 'INSERT INTO `wp_postmeta`'

const attachedFile = {} // attachmentId -> '2023/11/foo.jpg'
const thumbnails = {} // postId -> attachmentId
const attachments = {} // attachmentId -> { title, guid, mime }

let statement = ''
let lineNo = 0

const rl = createInterface({
  input: createReadStream(dumpPath, { encoding: 'utf8', highWaterMark: 4 * 1024 * 1024 }),
  crlfDelay: Infinity,
})

process.stdout.write('Scanning dump')

for await (const line of rl) {
  lineNo++
  if (lineNo % 250_000 === 0) process.stdout.write('.')

  if (statement === '' && !line.startsWith(POSTS_PREFIX) && !line.startsWith(META_PREFIX)) continue
  statement += (statement ? '\n' : '') + line
  if (!statement.trimEnd().endsWith(');') || hasOpenString(statement)) continue

  const isPosts = statement.startsWith(POSTS_PREFIX)
  const open = statement.indexOf(' VALUES (')
  if (open === -1) { statement = ''; continue }
  const body = statement.slice(open + ' VALUES ('.length, statement.trimEnd().length - 2)
  const v = parseTuple(body)
  statement = ''

  if (isPosts) {
    const id = v[0]
    const title = v[5]
    const guid = v[18]
    const type = v[20]
    const mime = v[21]
    if (type === 'attachment') attachments[id] = { title, guid, mime }
  } else {
    const [, postId, key, value] = v
    if (key === '_wp_attached_file' && value) attachedFile[postId] = value
    else if (key === '_thumbnail_id' && value) thumbnails[postId] = Number(value)
  }
}

process.stdout.write('\n')

const write = (name, data) => writeFile(path.join(outDir, name), JSON.stringify(data, null, 2))
await write('attachments.json', { attachedFile, thumbnails, attachments })

console.log(`
Lines read           ${lineNo.toLocaleString()}
Attachments          ${Object.keys(attachments).length.toLocaleString()}
With a file path     ${Object.keys(attachedFile).length.toLocaleString()}
Featured-image links ${Object.keys(thumbnails).length.toLocaleString()}

Written to ${path.resolve(outDir, 'attachments.json')}
`)
