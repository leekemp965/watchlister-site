/**
 * Removes the WordPress pages that no longer have a purpose.
 *
 *   blog      the old listing page; /blog is a real route now
 *   search    the old results page; /search is a real route now
 *   homepage  the old front page, stranded at /homepage
 *
 * The first two were actively shadowing their real routes. Uses the Payload
 * API rather than SQL so related rows are cleaned up properly.
 *
 * Run with:  npx tsx scripts/delete-pages.ts [--dry-run]
 */
import { getPayload } from 'payload'
import config from '../src/payload.config'

const DRY = process.argv.includes('--dry-run')
const SLUGS = ['blog', 'search', 'homepage']

async function main() {
  const payload = await getPayload({ config })

  for (const slug of SLUGS) {
    const found = await payload.find({
      collection: 'pages',
      where: { slug: { equals: slug } },
      limit: 1,
      depth: 0,
    })

    if (!found.docs.length) {
      console.log(`  not found   /${slug}`)
      continue
    }

    const doc = found.docs[0]
    if (DRY) {
      console.log(`  would delete /${slug}  ("${doc.title}")`)
      continue
    }

    await payload.delete({ collection: 'pages', id: doc.id })
    console.log(`  deleted     /${slug}  ("${doc.title}")`)
  }

  const remaining = await payload.find({ collection: 'pages', limit: 100, depth: 0 })
  console.log(`\n  ${remaining.totalDocs} pages remain:`)
  for (const p of remaining.docs) console.log(`    /${p.slug}  (${p.title})`)

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
