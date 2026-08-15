/**
 * Moves the existing media library into object storage.
 *
 * Payload's S3 adapter handles *new* uploads once the S3_* variables are set,
 * but it does not migrate what is already on disk. The 619 files in media/ —
 * 222 originals plus the thumbnail and card sizes Payload generated — need
 * putting into the bucket under the same filenames, because that is what the
 * database rows reference.
 *
 * Idempotent: files already in the bucket at the same size are skipped, so an
 * interrupted run can simply be repeated.
 *
 * Run with:  node --env-file=.env.local scripts/upload-media-to-s3.mjs [--dry-run]
 */
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const DRY = process.argv.includes('--dry-run')
const DIR = path.resolve('./media')

const {
  S3_BUCKET,
  S3_REGION = 'auto',
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
  S3_ENDPOINT,
} = process.env

if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
  console.error(`Object storage is not configured. Set these in .env.local:

  S3_BUCKET             bucket name
  S3_REGION             e.g. eu-west-2, or "auto" for Cloudflare R2
  S3_ACCESS_KEY_ID
  S3_SECRET_ACCESS_KEY
  S3_ENDPOINT           only for non-AWS providers (R2, B2)
`)
  process.exit(1)
}

const client = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  forcePathStyle: Boolean(S3_ENDPOINT),
  credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
})

const CONTENT_TYPE = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
}

/** Payload stores a bare filename, so the bucket is flat — no directory prefix. */
async function collect(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await collect(full)))
    else out.push(full)
  }
  return out
}

const files = await collect(DIR)
console.log(`${files.length} files in media/\n`)

let uploaded = 0
let skipped = 0
let failed = []
let bytes = 0

const CONCURRENCY = 8
let cursor = 0

async function worker() {
  while (cursor < files.length) {
    const full = files[cursor++]
    const key = path.basename(full)
    const ext = path.extname(key).toLowerCase()

    try {
      const info = await stat(full)

      // Already there at the same size? Leave it.
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }))
        if (head.ContentLength === info.size) {
          skipped++
          continue
        }
      } catch {
        // Not found — fall through and upload.
      }

      if (DRY) {
        uploaded++
        bytes += info.size
        continue
      }

      await client.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          Body: await readFile(full),
          ContentType: CONTENT_TYPE[ext] ?? 'application/octet-stream',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      )
      uploaded++
      bytes += info.size
    } catch (err) {
      failed.push(`${key}: ${err.message}`)
    }

    const done = uploaded + skipped + failed.length
    if (done % 50 === 0) process.stdout.write(`\r  ${done}/${files.length}`)
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))
process.stdout.write('\r')

console.log(`
${DRY ? 'DRY RUN — nothing uploaded\n' : ''}  uploaded  ${uploaded}
  skipped   ${skipped} (already present, same size)
  failed    ${failed.length}
  transfer  ${(bytes / 1024 / 1024).toFixed(1)} MB
`)

if (failed.length) {
  console.log('Failures:')
  for (const f of failed.slice(0, 10)) console.log(`  ${f}`)
  process.exit(1)
}
