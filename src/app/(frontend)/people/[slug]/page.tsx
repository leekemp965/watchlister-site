import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { RichText } from '@payloadcms/richtext-lexical/react'
import { getPersonBySlug, getCreditsForPerson } from '@/lib/queries'
import { profileUrl, posterUrl, year, PLACEHOLDER } from '@/lib/tmdb'
import { Videos, Podcasts, Articles, Section } from '@/components/Editorial'

/**
 * One page for every person, replacing the old site's five near-identical
 * templates (single-actor, single-director, single-writer, single-composer,
 * single-creator). What someone did is a property of each credit, so the
 * filmography groups itself.
 */

export const revalidate = 3600

type Props = { params: Promise<{ slug: string }> }

const ROLE_LABEL: Record<string, string> = {
  actor: 'Acting',
  director: 'Directing',
  writer: 'Writing',
  composer: 'Music',
  creator: 'Created',
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const person = await getPersonBySlug(slug)
  if (!person) return { title: 'Not found' }
  return {
    title: person.name,
    description: person.biography?.slice(0, 300) ?? `Films and shows featuring ${person.name}.`,
    openGraph: {
      title: person.name ?? undefined,
      images: profileUrl(person.profileImagePath, 'h632')
        ? [profileUrl(person.profileImagePath, 'h632')!]
        : undefined,
    },
  }
}

export default async function PersonPage({ params }: Props) {
  const { slug } = await params
  const person = await getPersonBySlug(slug)
  if (!person) notFound()

  const credits = await getCreditsForPerson(person.id)

  // Group by role, then sort each group newest first.
  const byRole = new Map<string, typeof credits>()
  for (const c of credits) {
    const role = String(c.role)
    if (!byRole.has(role)) byRole.set(role, [])
    byRole.get(role)!.push(c)
  }

  /** A credit points at exactly one of the two, enforced by a hook on the collection. */
  type LinkedTitle = {
    slug?: string | null
    title?: string | null
    posterPath?: string | null
    releaseDate?: string | null
    firstAirDate?: string | null
  }

  const titleOf = (c: (typeof credits)[number]): LinkedTitle | null =>
    (typeof c.movie === 'object' && c.movie) ||
    (typeof c.tvShow === 'object' && c.tvShow) ||
    null

  const dateOf = (t: LinkedTitle | null) => t?.releaseDate ?? t?.firstAirDate ?? ''

  for (const list of byRole.values()) {
    list.sort((a, b) => dateOf(titleOf(b)).localeCompare(dateOf(titleOf(a))))
  }

  const profile = profileUrl(person.profileImagePath, 'h632')
  const born = person.birthDate ? new Date(person.birthDate).getFullYear() : null
  const died = person.deathDate ? new Date(person.deathDate).getFullYear() : null

  return (
    <div className="container mx-auto px-8 text-white sm:px-16">
      <article className="grid grid-cols-12 gap-8 py-8 md:gap-12 md:py-12">
        <figure className="col-span-12 md:col-span-3">
          <Image
            src={profile ?? PLACEHOLDER.profile}
            alt={person.name ?? ''}
            width={300}
            height={450}
            className="w-full max-w-xs object-cover"
            priority
            unoptimized={!profile}
          />
        </figure>

        <div className="col-span-12 md:col-span-9">
          <h1 className="mb-2 text-4xl font-semibold">{person.name}</h1>
          {person.knownForDepartment && (
            <p className="text-vermilion mb-4">{person.knownForDepartment}</p>
          )}

          <table className="table-head-none mb-6 max-w-md text-sm">
            <tbody>
              {born && (
                <tr>
                  <th>Born</th>
                  <td>
                    {born}
                    {died ? ` — died ${died}` : ''}
                  </td>
                </tr>
              )}
              {person.placeOfBirth && (
                <tr>
                  <th>Place of birth</th>
                  <td>{person.placeOfBirth}</td>
                </tr>
              )}
              <tr>
                <th>Credits</th>
                <td>{credits.length}</td>
              </tr>
            </tbody>
          </table>

          {person.biography && (
            <div className="max-w-3xl leading-relaxed whitespace-pre-line text-gray-300">
              {person.biography}
            </div>
          )}
        </div>
      </article>

      {person.customContent && (
        <div className="prose-watchlister mb-12">
          <RichText data={person.customContent} />
        </div>
      )}

      <Videos items={person.videoEmbeds} />
      <Podcasts items={person.podcasts} />
      <Articles items={person.articles} />

      {[...byRole.entries()].map(([role, list]) => (
        <Section key={role} title={ROLE_LABEL[role] ?? role}>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {list.map((c) => {
              const t = titleOf(c)
              if (!t) return null
              const isMovie = typeof c.movie === 'object' && c.movie
              const href = `${isMovie ? '/movies' : '/tv-shows'}/${t.slug}`
              const poster = posterUrl(t.posterPath, 'w185')
              return (
                <li key={String(c.id)} className="group">
                  <Link href={href} className="block">
                    <Image
                      src={poster ?? PLACEHOLDER.poster}
                      alt={String(t.title ?? '')}
                      width={185}
                      height={278}
                      className="h-auto w-full object-cover transition group-hover:ring-2 group-hover:ring-neutral-50"
                      unoptimized={!poster}
                    />
                    <h3 className="group-hover:text-vermilion mt-2 text-sm font-medium transition">
                      {String(t.title ?? '')}
                    </h3>
                    {year(dateOf(t)) && <p className="text-xs opacity-50">{year(dateOf(t))}</p>}
                    {c.character && <p className="text-xs opacity-50">as {c.character}</p>}
                  </Link>
                </li>
              )
            })}
          </ul>
        </Section>
      ))}
    </div>
  )
}
