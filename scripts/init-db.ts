/**
 * Boots Payload against the configured database, which creates the schema, and
 * reports what landed. Also creates the first admin user if there isn't one.
 *
 * Run with:  npx payload run scripts/init-db.ts
 *
 * Note: `payload run` transpiles to CommonJS, so everything lives inside main()
 * rather than using top-level await.
 */

import { getPayload } from 'payload'
// Relative rather than the @payload-config alias: the script runner resolves
// through tsx/CJS, which does not read tsconfig paths. The Next.js app files
// still use the alias, where it resolves correctly.
import config from '../src/payload.config'

async function main() {
  const payload = await getPayload({ config })

  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD

  const existing = await payload.count({ collection: 'users' })

  if (existing.totalDocs === 0 && email && password) {
    await payload.create({
      collection: 'users',
      data: { email, password, name: 'Admin', roles: ['admin'] },
    })
    console.log(`Created admin user: ${email}`)
  } else if (existing.totalDocs === 0) {
    console.log('No admin user yet. Set ADMIN_EMAIL and ADMIN_PASSWORD, or sign up at /admin.')
  } else {
    console.log(`${existing.totalDocs} user(s) already exist.`)
  }

  const collections = Object.keys(payload.collections).sort()
  console.log(`\n${collections.length} collections registered:`)
  for (const slug of collections) {
    const { totalDocs } = await payload.count({ collection: slug as never })
    console.log(`  ${slug.padEnd(24)} ${totalDocs}`)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
