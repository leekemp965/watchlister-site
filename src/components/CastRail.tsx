import Image from 'next/image'
import Link from 'next/link'
import { profileUrl, PLACEHOLDER } from '@/lib/tmdb'
import { Section, Rail } from './Editorial'

type Person = {
  id: number | string
  name?: string | null
  slug?: string | null
  profileImagePath?: string | null
}

type Credit = {
  id: number | string
  character?: string | null
  person?: Person | number | string | null
}

/**
 * The billed cast, as a horizontal rail.
 *
 * On the old site this data lived as an ACF repeater flattened into
 * wp_postmeta — `cast_N_actor` appeared 168,117 times across the database.
 * Here it is one indexed query against the credits table.
 */
export function CastRail({ credits, title = 'Actors' }: { credits: Credit[]; title?: string }) {
  const people = credits
    .map((c) => ({ credit: c, person: typeof c.person === 'object' ? c.person : null }))
    .filter((x): x is { credit: Credit; person: Person } => Boolean(x.person))

  if (!people.length) return null

  return (
    <Section title={title}>
      <Rail>
        {people.map(({ credit, person }) => {
          const img = profileUrl(person.profileImagePath, 'w185')
          return (
            <article key={credit.id} className="group w-32 shrink-0">
              <Link href={`/people/${person.slug}`} className="flex flex-col">
                <Image
                  src={img ?? PLACEHOLDER.profile}
                  alt={person.name ?? ''}
                  width={185}
                  height={278}
                  className="mb-3 h-auto w-full object-cover transition duration-300 ease-in-out group-hover:ring-2 group-hover:ring-neutral-50"
                  unoptimized={!img}
                />
                <h3 className="group-hover:text-vermilion mt-2 mb-1 font-semibold transition duration-300 ease-in-out">
                  {person.name}
                </h3>
                {credit.character && <p className="text-sm opacity-50">{credit.character}</p>}
              </Link>
            </article>
          )
        })}
      </Rail>
    </Section>
  )
}
