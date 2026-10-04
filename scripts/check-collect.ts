/**
 * Exercises the /collect endpoint and the analytics helpers.
 *
 * Run with: npm run check-collect
 *
 * The handler takes a Request and returns a Response, so it can be called
 * directly — no server, no browser. Writes to analytics.events and cleans up
 * after itself.
 */
import { POST } from '../src/app/(frontend)/collect/route'
import { isBot, normalisePath, visitorHash, EVENT_KINDS } from '../src/lib/analytics'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const MARK = '/__check_collect__'

let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)})`}`)
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request('https://watchlister.co/collect', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: {
        origin: 'https://watchlister.co',
        host: 'watchlister.co',
        'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/131 Safari/537.36',
        'x-forwarded-for': '203.0.113.9, 10.0.0.1',
        'content-type': 'application/json',
        ...headers,
      },
    }),
  )

const stored = async () => {
  const { rows } = await pool.query(
    `select kind, path, label, target, results, visitor from analytics.events
      where path like $1 || '%' order by id`,
    [MARK],
  )
  return rows
}

console.log('\npure helpers')
check('normalisePath strips the query string', normalisePath('/movies/x?q=1#a'), '/movies/x')
check('normalisePath forces a leading slash', normalisePath('movies/x'), '/movies/x')
check('normalisePath defaults empty to /', normalisePath(''), '/')
check('normalisePath rejects a non-string', normalisePath(null), '/')
check('isBot catches a declared crawler', isBot('Googlebot/2.1'), true)
check('isBot catches a missing user agent', isBot(null), true)
check('isBot passes a real browser', isBot('Mozilla/5.0 Chrome/131 Safari/537.36'), false)

// The daily rotation is what keeps this outside the consent regime, so assert it.
const a = visitorHash('203.0.113.9', 'UA', '2026-10-04')
const b = visitorHash('203.0.113.9', 'UA', '2026-10-05')
check('visitorHash is stable within a day', visitorHash('203.0.113.9', 'UA', '2026-10-04'), a)
check('visitorHash differs across days', a === b, false)
check('visitorHash is 16 chars', a.length, 16)
check('visitorHash differs by IP', visitorHash('203.0.113.8', 'UA', '2026-10-04') === a, false)

console.log('\naccepted')
await pool.query(`delete from analytics.events where path like $1 || '%'`, [MARK])

check('a valid pageview returns 204', (await post({ kind: 'pageview', path: MARK })).status, 204)
check(
  'a search carries its query and result count',
  (await post({ kind: 'search', path: MARK, label: 'the social network', results: 12 })).status,
  204,
)
check(
  'an article click carries its target',
  (await post({ kind: 'article', path: MARK, label: 'Sorkin on dialogue', target: 'https://example.com/a' })).status,
  204,
)

let rows = await stored()
check('three events were stored', rows.length, 3)
check('kinds stored', rows.map((r) => r.kind), ['pageview', 'search', 'article'])
check('search label stored', rows[1]?.label, 'the social network')
check('search results stored', rows[1]?.results, 12)
check('article target stored', rows[2]?.target, 'https://example.com/a')
check('visitor is a 16-char hash, not an IP', rows[0]?.visitor?.length, 16)
check('the raw IP is nowhere in the row', JSON.stringify(rows[0]).includes('203.0.113.9'), false)

console.log('\nrejected')
await pool.query(`delete from analytics.events where path like $1 || '%'`, [MARK])

const before = (await stored()).length
await post({ kind: 'pageview', path: MARK }, { origin: 'https://evil.example.com' })
await post({ kind: 'pageview', path: MARK }, { origin: '' })
await post({ kind: 'pageview', path: MARK }, { 'user-agent': 'Googlebot/2.1' })
await post({ kind: 'not-a-kind', path: MARK })
await post({ kind: 'pageview; drop table users', path: MARK })
await post('not json at all')
await post({ path: MARK })
await post([{ kind: 'pageview', path: MARK }])
await post({ kind: 'pageview', path: MARK, label: 'x'.repeat(10000) })

check('nothing from a cross-origin post was stored', (await stored()).length, before)

console.log('\nclamping')
await post({ kind: 'article', path: MARK, label: 'y'.repeat(900), target: 'z'.repeat(2000), results: 9e99 })
rows = await stored()
check('label clamped to 300', rows[0]?.label?.length, 300)
check('target clamped to 1000', rows[0]?.target?.length, 1000)
check('an absurd result count is bounded', rows[0]?.results, 100000)

console.log('\nkinds declared:', EVENT_KINDS.join(', '))

await pool.query(`delete from analytics.events where path like $1 || '%'`, [MARK])
await pool.end()

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed')
process.exit(failures ? 1 : 0)
