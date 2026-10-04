/**
 * Checks that the crawler block turns away what it should and nothing else.
 *
 * Run with: npm run check-proxy
 *
  * The proxy is a plain function of a NextRequest, so this needs no server.
 * The point of the test is the second half: a list like this is only safe if it
 * provably does not catch Google.
 */
import { NextRequest } from 'next/server'
import proxy from '../src/proxy'

let failures = 0

function expect(label: string, ua: string, blocked: boolean) {
  const res = proxy(
    new NextRequest('https://watchlister.co/movies/dune-438631', {
      headers: ua ? { 'user-agent': ua } : {},
    }),
  )
  const actually = res.status === 403
  const ok = actually === blocked
  if (!ok) failures++
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${blocked ? 'blocks ' : 'allows '} ${label}${ok ? '' : `  (status ${res.status})`}`,
  )
}

console.log('\nturned away')
expect('AhrefsBot', 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)', true)
expect('SemrushBot', 'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)', true)
expect('DataForSeoBot', 'Mozilla/5.0 (compatible; DataForSeoBot/1.0)', true)
expect('MJ12bot', 'Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)', true)
expect('DotBot', 'Mozilla/5.0 (compatible; DotBot/1.2; +https://opensiteexplorer.org/dotbot)', true)
expect('Bytespider', 'Mozilla/5.0 (Linux; Android 5.0) ... Bytespider', true)
expect('PetalBot', 'Mozilla/5.0 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)', true)
expect('BLEXBot', 'Mozilla/5.0 (compatible; BLEXBot/1.0; +http://webmeup-crawler.com/)', true)

console.log('\nlet through — search engines and real people')
expect(
  'Googlebot',
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  false,
)
expect('Googlebot smartphone', 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', false)
expect('Google Image', 'Googlebot-Image/1.0', false)
expect('Bingbot', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', false)
expect('DuckDuckBot', 'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)', false)
expect('YandexBot', 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)', false)
expect('Applebot', 'Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)', false)
expect('Facebook preview', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', false)
expect('Twitterbot', 'Twitterbot/1.0', false)
expect('Slack preview', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)', false)
expect('Chrome on macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', false)
expect('Safari on iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', false)
expect('Firefox', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0', false)
expect('an empty user agent', '', false)

console.log('\nAI crawlers are deliberately NOT blocked — a separate decision')
expect('GPTBot', 'Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)', false)
expect('ClaudeBot', 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', false)

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed')
process.exit(failures ? 1 : 0)
