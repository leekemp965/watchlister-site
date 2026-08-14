import Link from 'next/link'
import Image from 'next/image'

const SOCIAL = [
  { href: 'https://www.facebook.com/watchlistertrailers', icon: '/img/facebook.svg', label: 'Facebook', w: 25 },
  { href: 'https://twitter.com/watch_lister', icon: '/img/x.svg', label: 'X', w: 25 },
  {
    href: 'https://www.youtube.com/channel/UCyMu0WLwnNbP2OlUTNiCeqQ',
    icon: '/img/youtube.svg',
    label: 'YouTube',
    w: 36,
  },
]

const FOOTER_NAV = [
  { href: '/our-mission', label: 'Our Mission' },
  { href: '/privacy-policy', label: 'Privacy Policy' },
  { href: '/terms-conditions', label: 'Terms & Conditions' },
  { href: '/accessibility', label: 'Accessibility' },
  { href: '/contribute-your-movie-insights', label: 'Contribute' },
]

export function SiteFooter() {
  return (
    <footer className="bg-cod-gray mt-16">
      <div className="container mx-auto px-8 py-12 sm:px-16">
        <Link href="/" className="mb-8 block w-48">
          <Image
            src="/img/watchlister-reversed-logo.svg"
            alt="Watchlister"
            width={192}
            height={24}
          />
        </Link>

        <div className="flex flex-col text-white lg:flex-row lg:flex-wrap lg:items-end lg:justify-between">
          <div className="my-4 flex flex-row justify-start space-x-6 lg:my-0 lg:space-x-8">
            {SOCIAL.map((s) => (
              <a key={s.href} href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label}>
                <Image src={s.icon} alt={s.label} width={s.w} height={25} />
              </a>
            ))}
          </div>

          <nav className="my-4 lg:my-0">
            <ul className="flex flex-col space-y-4 text-sm lg:flex-row lg:space-y-0 lg:space-x-8">
              {FOOTER_NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="hover:text-vermilion transition">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="my-4 text-left text-xs text-white lg:my-0 lg:text-right">
            <p>&copy; {new Date().getFullYear()} All Rights Reserved</p>
            <p>Registered in England &amp; Wales (12560430)</p>
          </div>
        </div>

        <p className="mt-8 text-xs text-gray-500">
          Film and television metadata from{' '}
          <a
            href="https://www.themoviedb.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-vermilion underline"
          >
            TMDB
          </a>
          . This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
      </div>
    </footer>
  )
}
