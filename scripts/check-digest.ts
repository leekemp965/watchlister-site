/**
 * Renders the digest to the terminal without sending it.
 *
 * Run with: npm run check-digest
 *
 * The cron route can do this too (`?preview=1`), but that needs a server
 * running and returns JSON. This exercises the same code paths and prints the
 * email as a person would read it, which is what you want when checking whether
 * a number looks right.
 */
import { buildDigest, renderDigest } from '../src/lib/digest'

const digest = await buildDigest()
const { subject, text } = renderDigest(digest)

console.log('subject: ' + subject)
console.log('─'.repeat(72))
console.log(text)
console.log('─'.repeat(72))
console.log('analytics collecting: ' + digest.analytics.collecting)

process.exit(0)
