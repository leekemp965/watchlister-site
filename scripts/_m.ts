import { getPayload } from 'payload'
import config from '../src/payload.config'
async function main() {
  const p = await getPayload({ config })
  const r = await p.find({ collection: 'posts', limit: 2, depth: 1, where: { _status: { equals: 'published' } } })
  for (const post of r.docs) {
    const f: any = post.featuredImage
    console.log(post.title)
    console.log('  featuredImage type:', typeof f, f ? Object.keys(f).slice(0,12).join(',') : 'null')
    if (f && typeof f === 'object') console.log('  url:', JSON.stringify(f.url), ' filename:', f.filename)
  }
  const m = await p.find({ collection: 'media', limit: 1 })
  console.log('\nmedia doc url:', JSON.stringify((m.docs[0] as any)?.url))
  process.exit(0)
}
main()
