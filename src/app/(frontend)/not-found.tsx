import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="container mx-auto px-8 py-24 text-center sm:px-16">
      <h1 className="text-vermilion mb-4 text-5xl font-semibold">404</h1>
      <p className="mb-8 text-gray-400">
        That page has left the building. Try searching, or start from the top.
      </p>
      <Link
        href="/"
        className="bg-vermilion inline-block px-6 py-3 font-semibold text-white transition hover:opacity-90"
      >
        Back to Watchlister
      </Link>
    </div>
  )
}
