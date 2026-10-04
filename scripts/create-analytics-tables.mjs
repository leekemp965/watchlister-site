/**
 * Creates the first-party analytics table.
 *
 * Run with: npm run analytics-tables
 *
 * ## Why this lives in its own Postgres schema
 *
 * Not tidiness — survival. Payload runs a Drizzle schema push on boot whenever
 * NODE_ENV is not production, which introspects the database and offers to
 * reconcile anything that does not appear in the Payload config. A plain table
 * in `public` is, to that process, an unexplained object to be removed:
 *
 *     · You're about to delete analytics_events table with 15 items
 *     DATA LOSS WARNING: Possible data loss detected if schema is pushed.
 *
 * Every dev-server boot would put that prompt in front of whoever is working,
 * one keystroke away from deleting the analytics history. This project has been
 * here before — a schema push silently dropped the pg_trgm search indexes, and
 * search returned nothing until they were rebuilt.
 *
 * Drizzle's introspection is limited to the `public` schema, so a table in its
 * own schema is invisible to the push and cannot be offered up for deletion.
 *
 * ## Why not a Payload collection
 *
 * This holds one row per pageview, so it will outgrow every other table on the
 * site within months. A collection would put that behind the admin UI and wrap
 * each insert in the full document lifecycle — hooks, validation, access control
 * — for data nobody will ever edit by hand.
 *
 * Kept deliberately narrow. There is no cookie, no localStorage and no
 * persistent identifier, and the raw IP address is never stored: `visitor` is a
 * hash that re-salts every day, so it can count the same person twice in one day
 * but cannot follow them into tomorrow. That is what keeps this outside the
 * consent regime — see src/lib/analytics.ts for the reasoning in full.
 */
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const statements = [
  `create schema if not exists analytics`,

  `create table if not exists analytics.events (
     id      bigserial   primary key,
     at      timestamptz not null default now(),
     kind    text        not null,
     path    text        not null default '',
     label   text,
     target  text,
     results integer,
     visitor char(16)    not null
   )`,

  // Every digest query is "yesterday, by kind", so lead with both.
  `create index if not exists events_kind_at_idx on analytics.events (kind, at desc)`,

  // Retention sweeps and any ad-hoc "what happened on X" query.
  `create index if not exists events_at_idx on analytics.events (at desc)`,

  // Popular pages: partial, because pageviews are the overwhelming majority and
  // a full index on path would mostly duplicate the above.
  `create index if not exists events_path_idx on analytics.events (path) where kind = 'pageview'`,
]

for (const sql of statements) {
  await pool.query(sql)
  console.log('ok  ' + sql.trim().split('\n')[0].slice(0, 72))
}

/**
 * Carry over anything written while the table briefly lived in `public`, then
 * remove it so the schema push has nothing to object to.
 */
const { rows: legacy } = await pool.query(`
  select count(*)::int n from information_schema.tables
   where table_schema = 'public' and table_name = 'analytics_events'`)

if (legacy[0].n === 1) {
  const { rowCount } = await pool.query(`
    insert into analytics.events (at, kind, path, label, target, results, visitor)
    select at, kind, path, label, target, results, visitor from public.analytics_events`)
  await pool.query(`drop table public.analytics_events`)
  console.log(`\nmoved ${rowCount} row(s) out of public.analytics_events and dropped it`)
}

// Verify against the database rather than trusting that the statements ran —
// `create ... if not exists` succeeds whether or not anything was created.
const { rows } = await pool.query(`
  select column_name, data_type from information_schema.columns
   where table_schema = 'analytics' and table_name = 'events'
   order by ordinal_position`)

if (!rows.length) {
  console.error('\nanalytics.events does not exist after running. Nothing was created.')
  process.exit(1)
}

console.log('\nanalytics.events:')
for (const r of rows) console.log(`  ${r.column_name.padEnd(9)} ${r.data_type}`)

const { rows: idx } = await pool.query(
  `select indexname from pg_indexes where schemaname = 'analytics' order by indexname`,
)
console.log('indexes: ' + idx.map((i) => i.indexname).join(', '))

await pool.end()
