/**
 * Seeds synthetic analytics events dated to yesterday, so the digest can be
 * checked against known numbers before any real traffic exists.
 *
 * Run with: npm run analytics-sample
 * Clears analytics.events first — do not run against a database holding real
 * events you care about.
 */
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const rows = [
  // kind,      path,                                label,                            target,                   results
  ['pageview', '/', null, null, null],
  ['pageview', '/', null, null, null],
  ['pageview', '/movies/the-social-network-37799', null, null, null],
  ['pageview', '/movies/the-social-network-37799', null, null, null],
  ['pageview', '/movies/the-social-network-37799', null, null, null],
  ['pageview', '/search', null, null, null],
  ['pageview', '/people/david-fincher-7467', null, null, null],
  ['search', '/search', 'the social network', null, 12],
  ['search', '/search', 'the social network', null, 12],
  ['search', '/search', 'obscure student film 1994', null, 0],
  ['search', '/search', 'obscure student film 1994', null, 0],
  ['video', '/movies/the-social-network-37799', 'Why the opening scene works', 'abc123', null],
  ['video', '/movies/the-social-network-37799', 'Why the opening scene works', 'abc123', null],
  ['podcast', '/movies/the-social-network-37799', 'Blank Check: The Social Network', 'https://example.com/ep', null],
  ['article', '/movies/the-social-network-37799', 'Sorkin on dialogue', 'https://example.com/a', null],
]

const visitors = ['v0000000000000a1', 'v0000000000000a2', 'v0000000000000a3']

await pool.query('delete from analytics.events')

for (const [i, [kind, path, label, target, results]] of rows.entries()) {
  await pool.query(
    `insert into analytics.events (at, kind, path, label, target, results, visitor)
     values (current_date - interval '14 hours', $1, $2, $3, $4, $5, $6)`,
    [kind, path, label, target, results, visitors[i % visitors.length]],
  )
}

const { rows: counts } = await pool.query(
  `select kind, count(*)::int n, count(distinct visitor)::int v
     from analytics.events group by kind order by kind`,
)
console.log('seeded:')
for (const c of counts) console.log(`  ${c.kind.padEnd(9)} ${c.n} events, ${c.v} visitors`)

await pool.end()
