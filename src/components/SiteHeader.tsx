'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const NAV = [
  { href: '/movies', label: 'Movies' },
  { href: '/tv-shows', label: 'TV Shows' },
  { href: '/blog', label: 'Blog' },
  { href: '/our-mission', label: 'About' },
]

export function SiteHeader() {
  const [searchOpen, setSearchOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const router = useRouter()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setSearchOpen(false)
    router.push(`/search?q=${encodeURIComponent(query.trim())}`)
  }

  return (
    <header>
      <div className="container mx-auto flex items-center justify-between px-8 py-6 sm:px-16">
        <Link href="/" className="block" aria-label="Watchlister home">
          <Image
            src="/img/watchlister-logo.svg"
            alt="Watchlister"
            width={320}
            height={40}
            className="w-48 sm:w-64 lg:w-80"
            priority
          />
        </Link>

        <div className="flex items-center text-white">
          <nav className="hidden lg:block">
            <ul className="flex items-center space-x-12">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="hover:text-vermilion transition">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <button
            onClick={() => setSearchOpen(true)}
            aria-label="Search movies"
            className="ml-6 lg:ml-12"
          >
            <svg width="35" height="35" viewBox="0 0 35 35" fill="none" aria-hidden="true">
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M16 10.4994C14.5413 10.4994 13.1424 11.0789 12.1109 12.1103C11.0795 13.1418 10.5 14.5407 10.5 15.9994C10.5 17.4581 11.0795 18.857 12.1109 19.8885C13.1424 20.9199 14.5413 21.4994 16 21.4994C17.4587 21.4994 18.8576 20.9199 19.8891 19.8885C20.9205 18.857 21.5 17.4581 21.5 15.9994C21.5 14.5407 20.9205 13.1418 19.8891 12.1103C18.8576 11.0789 17.4587 10.4994 16 10.4994ZM9 15.9994C9.00009 14.8801 9.26861 13.7771 9.78303 12.783C10.2974 11.7889 11.0428 10.9326 11.9565 10.286C12.8701 9.63943 13.9256 9.22138 15.0342 9.06695C16.1428 8.91251 17.2723 9.02619 18.3279 9.39843C19.3836 9.77068 20.3345 10.3906 21.101 11.2063C21.8676 12.022 22.4273 13.0096 22.7333 14.0863C23.0393 15.163 23.0827 16.2974 22.8597 17.3943C22.6368 18.4912 22.154 19.5186 21.452 20.3904L24.78 23.7194C24.8537 23.7881 24.9128 23.8709 24.9538 23.9629C24.9948 24.0549 25.0168 24.1542 25.0186 24.2549C25.0204 24.3556 25.0018 24.4556 24.9641 24.549C24.9264 24.6424 24.8703 24.7272 24.799 24.7984C24.7278 24.8697 24.643 24.9258 24.5496 24.9635C24.4562 25.0013 24.3562 25.0198 24.2555 25.018C24.1548 25.0162 24.0555 24.9942 23.9635 24.9532C23.8715 24.9122 23.7887 24.8531 23.72 24.7794L20.391 21.4514C19.3625 22.2798 18.1207 22.8004 16.809 22.953C15.4973 23.1056 14.1691 22.8841 12.9779 22.3139C11.7868 21.7438 10.7812 20.8484 10.0773 19.731C9.37338 18.6137 8.99991 17.32 9 15.9994Z"
                fill="white"
              />
              <circle cx="17.5" cy="17.5" r="16.5" stroke="#FF4400" />
            </svg>
          </button>

          <button
            onClick={() => setMenuOpen(true)}
            className="ml-4 lg:hidden"
            aria-label="Open menu"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Full-screen search overlay */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center bg-gray-950/90"
          onClick={() => setSearchOpen(false)}
        >
          <div className="mx-auto w-full px-8 md:w-3/4" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={submit}>
              <input
                autoFocus
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search films, shows and people…"
                className="border-vermilion focus:ring-vermilion w-full border-b-2 bg-transparent px-2 py-4 text-2xl text-white placeholder-gray-500 focus:outline-none md:text-4xl"
              />
              <p className="mt-4 text-sm text-gray-400">Press Enter to search · Esc to close</p>
            </form>
          </div>
        </div>
      )}

      {/* Mobile navigation */}
      {menuOpen && (
        <div className="bg-vermilion fixed inset-0 z-50 h-screen w-screen overflow-y-auto px-6">
          <button
            onClick={() => setMenuOpen(false)}
            className="absolute top-5 right-8 text-5xl text-white transition hover:text-amber-500"
            aria-label="Close menu"
          >
            &times;
          </button>

          <Link href="/" className="my-6 block" onClick={() => setMenuOpen(false)}>
            <Image
              src="/img/watchlister-reversed-logo.svg"
              alt="Watchlister"
              width={192}
              height={24}
              className="w-48"
            />
          </Link>

          <nav className="my-16">
            <ul className="flex flex-col space-y-4 text-2xl text-white">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} onClick={() => setMenuOpen(false)}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}
    </header>
  )
}
