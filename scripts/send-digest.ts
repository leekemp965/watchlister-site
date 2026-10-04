/**
 * Builds and sends a digest for a chosen day.
 *
 * Run with:
 *   npm run send-digest            # yesterday, as the cron would
 *   npm run send-digest -- --today # today so far
 *   npm run send-digest -- --day=3 # three days ago
 *   npm run send-digest -- --dry   # render it here, send nothing
 *
 * Uses the same buildDigest/sendDigest path as the cron route, so what arrives
 * is what the 08:00 email would look like — not an approximation of it.
 */
import { buildDigest, renderDigest, sendDigest } from '../src/lib/digest'

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const dayArg = args.find((a) => a.startsWith('--day='))
const offset = args.includes('--today') ? 0 : dayArg ? Number(dayArg.split('=')[1]) : 1

if (!Number.isFinite(offset) || offset < 0) {
  console.error(`Not a valid day offset: ${dayArg ?? offset}`)
  process.exit(1)
}

console.log(`building the digest for ${offset === 0 ? 'today so far' : `${offset} day(s) ago`}…`)

const digest = await buildDigest(offset)
const { subject, text } = renderDigest(digest)

console.log(`\nsubject: ${subject}`)
console.log('─'.repeat(72))
console.log(text)
console.log('─'.repeat(72))

if (!digest.analytics.collecting) {
  console.log('\nnote: no analytics events exist at all yet, so the visitor sections are empty.')
} else if (digest.analytics.pageviews === 0) {
  console.log(
    `\nnote: events exist, but none fall inside ${digest.date}. Collection may have started after that day.`,
  )
}

if (dry) {
  console.log('\n--dry: nothing sent.')
  process.exit(0)
}

const result = await sendDigest(digest)

if (!result.sent) {
  console.error(`\nNOT SENT: ${result.reason}${result.status ? ` (status ${result.status})` : ''}`)
  process.exit(1)
}

console.log(`\nsent to ${result.to}`)
console.log(`subject: ${result.subject}`)
console.log(
  '\nThe sending domain is not verified in Resend yet, so check spam if it does not arrive.',
)
process.exit(0)
