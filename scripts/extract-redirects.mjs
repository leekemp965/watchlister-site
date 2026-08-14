#!/usr/bin/env node
/**
 * Pulls the old site's Redirection plugin rules out of the dump.
 *
 * 326 rules accumulated over the site's life — mostly dated permalinks
 * (/2023/10/28/some-post/) pointing at the flat structure it later moved to.
 * They represent real inbound links that still exist on the web, so they are
 * worth carrying across rather than 404ing.
 *
 * Usage: node scripts/extract-redirects.mjs ../watchlisterco.sql ./data
 */

import { createReadStream } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import path from 'node:path'

const [, , dumpPath, outDir = './data'] = process.argv
if (!dumpPath) {
  console.error('Usage: node scripts/extract-redirects.mjs <dump.sql> [outDir]')
  process.exit(1)
}

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

const PREFIX = 'INSERT INTO `wp_redirection_items`'
const rules = []

const rl = createInterface({
  input: createReadStream(dumpPath, { encoding: 'utf8', highWaterMark: 4 * 1024 * 1024 }),
  crlfDelay: Infinity,
})

for await (const line of rl) {
  if (!line.startsWith(PREFIX)) continue
  const open = line.indexOf(' VALUES (')
  if (open === -1) continue
  const body = line.slice(open + ' VALUES ('.length, line.trimEnd().length - 2)
  const v = parseTuple(body)

  // (id, url, match_url, match_data, regex, position, last_count, last_access,
  //  group_id, status, action_type, action_code, action_data, match_type, title)
  const [, url, , , regex, , lastCount, , , status, actionType, actionCode, actionData] = v

  rules.push({
    source: url,
    destination: actionData,
    code: actionCode || 301,
    regex: Boolean(regex),
    enabled: status === 'enabled',
    actionType,
    hits: lastCount ?? 0,
  })
}

/**
 * Only rules worth keeping: enabled, a real URL redirect, both ends present,
 * and not a self-redirect. Rules that never fired in the site's lifetime are
 * kept too — a zero hit count means nobody followed that link recently, not
 * that the link does not exist.
 */
const usable = rules.filter(
  (r) =>
    r.enabled &&
    r.actionType === 'url' &&
    r.source &&
    r.destination &&
    r.source !== r.destination &&
    !r.regex, // regex rules need hand translation; reported separately
)

const regexRules = rules.filter((r) => r.enabled && r.regex)
const skipped = rules.length - usable.length - regexRules.length

/**
 * Next parses redirect sources with path-to-regexp, where `:` introduces a
 * named parameter and `(){}*+?` are pattern syntax. The old plugin's data has
 * sources like `/https:/watchlister.co/...` — someone pasted a whole URL into
 * the source field — which blow up the build with "Missing parameter name".
 */
const PATH_TO_REGEXP_SYNTAX = /[:(){}*+?[\]\\]/
const malformed = []

// Normalise: Next matches without a trailing slash, and sources must be absolute paths.
const normalised = []
const seen = new Set()
for (const r of usable) {
  let source = r.source.trim()

  if (PATH_TO_REGEXP_SYNTAX.test(source)) {
    malformed.push(r)
    continue
  }
  let destination = r.destination.trim()
  if (!source.startsWith('/')) source = '/' + source
  source = source.replace(/\/+$/, '') || '/'
  if (destination.startsWith('http')) {
    // Some rules point at the absolute old domain; make them relative.
    try {
      const u = new URL(destination)
      if (u.hostname.includes('watchlister')) destination = u.pathname + u.search
    } catch {
      /* leave as-is */
    }
  }
  destination = destination.replace(/\/+$/, '') || '/'
  if (source === destination) continue
  if (seen.has(source)) continue // first rule wins, as in the plugin's ordering
  seen.add(source)
  normalised.push({ source, destination, permanent: Number(r.code) === 301, hits: r.hits })
}

normalised.sort((a, b) => b.hits - a.hits)

await writeFile(path.join(outDir, 'legacy-redirects.json'), JSON.stringify(normalised, null, 2))

console.log(`
Rules in dump        ${rules.length}
  usable             ${normalised.length}
  regex (manual)     ${regexRules.length}
  malformed source   ${malformed.length}
  skipped            ${skipped}${
    malformed.length
      ? `\n\nDropped for unparseable sources (a URL pasted into the source field):\n` +
        malformed.map((m) => `  ${m.source}`).join('\n')
      : ''
  }

Most-followed rules:`)
for (const r of normalised.slice(0, 8)) {
  console.log(`  ${String(r.hits).padStart(5)} hits  ${r.source.slice(0, 46).padEnd(48)} → ${r.destination}`)
}
if (regexRules.length) {
  console.log('\nRegex rules needing manual translation:')
  for (const r of regexRules.slice(0, 5)) console.log(`  ${r.source} → ${r.destination}`)
}
console.log(`\nWritten to ${path.resolve(outDir, 'legacy-redirects.json')}`)
