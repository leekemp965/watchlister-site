import Link from 'next/link'

export function Pagination({
  page,
  totalPages,
  basePath,
}: {
  page: number
  totalPages: number
  basePath: string
}) {
  if (totalPages <= 1) return null

  const href = (p: number) => (p === 1 ? basePath : `${basePath}?page=${p}`)

  // A compact window around the current page rather than 480 links.
  const around = [page - 1, page, page + 1].filter((p) => p > 1 && p < totalPages)
  const pages = [...new Set([1, ...around, totalPages])].sort((a, b) => a - b)

  return (
    <nav className="my-12 flex items-center justify-center gap-2" aria-label="Pagination">
      {page > 1 && (
        <Link href={href(page - 1)} className="hover:text-vermilion px-3 py-2 text-sm transition">
          &larr; Previous
        </Link>
      )}

      {pages.map((p, i) => (
        <span key={p} className="flex items-center gap-2">
          {i > 0 && pages[i - 1] !== p - 1 && <span className="text-gray-600">…</span>}
          <Link
            href={href(p)}
            aria-current={p === page ? 'page' : undefined}
            className={
              p === page
                ? 'bg-vermilion px-3 py-2 text-sm font-semibold text-white'
                : 'hover:text-vermilion px-3 py-2 text-sm transition'
            }
          >
            {p}
          </Link>
        </span>
      ))}

      {page < totalPages && (
        <Link href={href(page + 1)} className="hover:text-vermilion px-3 py-2 text-sm transition">
          Next &rarr;
        </Link>
      )}
    </nav>
  )
}
