import { getPayload } from 'payload'
import config from '../src/payload.config'

async function main() {
  const payload = await getPayload({ config })
  const db: any = payload.db
  console.log('db keys       :', Object.keys(db).filter(k => /pool|drizzle|client|sql/i.test(k)).join(', ') || '(none matching)')
  console.log('db.pool       :', typeof db.pool)
  console.log('db.pool.query :', typeof db.pool?.query)
  if (typeof db.pool?.query === 'function') {
    const r = await db.pool.query("select count(*)::int n from movies where title ilike '%dune%'")
    console.log('raw query ok  :', r.rows[0].n, 'matches')
  }
  process.exit(0)
}
main().catch(e => { console.log('THREW:', e.message); process.exit(1) })
