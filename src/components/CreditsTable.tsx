import Link from 'next/link'

type Person = { id: number | string; name?: string | null; slug?: string | null }
type Credit = { id: number | string; person?: Person | number | string | null }
type Named = { name?: string | null; slug?: string | null; id?: number | string }

const people = (credits: Credit[] = []) =>
  credits
    .map((c) => (typeof c.person === 'object' ? c.person : null))
    .filter((p): p is Person => Boolean(p))

function PeopleLinks({ credits }: { credits: Credit[] }) {
  const list = people(credits)
  return (
    <>
      {list.map((p, i) => (
        <span key={p.id}>
          <Link href={`/people/${p.slug}`}>{p.name?.trim()}</Link>
          {i < list.length - 1 ? ', ' : ''}
        </span>
      ))}
    </>
  )
}

/**
 * The credits table from the old single-movie template: director, writers,
 * composers, genres, certificate, release date, production companies.
 * Rows are omitted entirely when empty, as before.
 */
export function CreditsTable({
  directors = [],
  writers = [],
  composers = [],
  creators = [],
  genres = [],
  certificate,
  releaseDate,
  releaseLabel = 'Release Date',
  productionCompanies = [],
  networks = [],
  extra,
}: {
  directors?: Credit[]
  writers?: Credit[]
  composers?: Credit[]
  creators?: Credit[]
  genres?: (Named | number | string)[]
  certificate?: string | null
  releaseDate?: string | null
  releaseLabel?: string
  productionCompanies?: (Named | number | string)[]
  networks?: (Named | number | string)[]
  extra?: Array<{ label: string; value: React.ReactNode }>
}) {
  const named = (list: (Named | number | string)[]) =>
    list.filter((g): g is Named => typeof g === 'object' && g !== null)

  const year = releaseDate ? new Date(releaseDate).getFullYear() : null

  const rows: Array<{ label: string; value: React.ReactNode }> = []

  if (directors.length)
    rows.push({
      label: directors.length > 1 ? 'Directors' : 'Director',
      value: <PeopleLinks credits={directors} />,
    })
  if (creators.length)
    rows.push({
      label: creators.length > 1 ? 'Creators' : 'Creator',
      value: <PeopleLinks credits={creators} />,
    })
  if (writers.length) rows.push({ label: 'Writers', value: <PeopleLinks credits={writers} /> })
  if (composers.length)
    rows.push({ label: 'Composer(s)', value: <PeopleLinks credits={composers} /> })

  const g = named(genres)
  if (g.length)
    rows.push({
      label: 'Genres',
      value: g.map((x, i) => (
        <span key={x.id ?? i}>
          <Link href={`/genres/${x.slug}`}>{x.name}</Link>
          {i < g.length - 1 ? ', ' : ''}
        </span>
      )),
    })

  if (certificate) rows.push({ label: 'Certificate', value: certificate })
  if (year) rows.push({ label: releaseLabel, value: String(year) })

  const n = named(networks)
  if (n.length)
    rows.push({
      label: n.length > 1 ? 'Networks' : 'Network',
      value: n.map((x, i) => (
        <span key={x.id ?? i}>
          {x.name}
          {i < n.length - 1 ? ', ' : ''}
        </span>
      )),
    })

  const pc = named(productionCompanies)
  if (pc.length)
    rows.push({
      label: 'Production Company(s)',
      value: pc.map((x, i) => (
        <span key={x.id ?? i}>
          {x.name}
          {i < pc.length - 1 ? ', ' : ''}
        </span>
      )),
    })

  for (const e of extra ?? []) if (e.value) rows.push(e)

  if (!rows.length) return null

  return (
    <table className="table-head-none text-sm text-white">
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <th>{r.label}</th>
            <td>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
