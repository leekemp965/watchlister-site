import type { CollectionConfig } from 'payload'
import { publicRead, signedIn } from './Users'

/**
 * The small reference vocabularies. In WordPress these were a mix of custom
 * post types (production_company, network, country, language) and taxonomies
 * (genre, tv_genre) for no particular reason — the distinction was an artefact
 * of how each was added, not a real difference. They behave identically here.
 */
const reference = (
  slug: string,
  labels: { singular: string; plural: string },
  extraFields: CollectionConfig['fields'] = [],
): CollectionConfig => ({
  slug,
  labels,
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug'],
    group: 'Reference',
  },
  access: { read: publicRead, create: signedIn, update: signedIn, delete: signedIn },
  fields: [
    { name: 'name', type: 'text', required: true, index: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    ...extraFields,
  ],
})

export const Genres = reference('genres', { singular: 'Genre', plural: 'Genres' }, [
  {
    name: 'tmdbId',
    type: 'number',
    index: true,
    admin: { readOnly: true },
    // Not unique: TMDB numbers film and television genres in separate spaces,
    // so id 18 is Drama for films and 18 is also Drama for shows. The pair
    // (tmdbId, medium) is what identifies a genre.
  },
  {
    name: 'medium',
    type: 'select',
    required: true,
    defaultValue: 'movie',
    options: [
      { label: 'Film', value: 'movie' },
      { label: 'Television', value: 'tv' },
      { label: 'Both', value: 'both' },
    ],
  },
])

export const ProductionCompanies = reference(
  'production-companies',
  { singular: 'Production Company', plural: 'Production Companies' },
  [
    { name: 'tmdbId', type: 'number', unique: true, index: true, admin: { readOnly: true } },
    { name: 'logoPath', type: 'text' },
    { name: 'originCountry', type: 'text' },
  ],
)

export const Networks = reference('networks', { singular: 'Network', plural: 'Networks' }, [
  { name: 'tmdbId', type: 'number', unique: true, index: true, admin: { readOnly: true } },
  { name: 'logoPath', type: 'text' },
])

export const Countries = reference('countries', { singular: 'Country', plural: 'Countries' }, [
  {
    name: 'iso',
    type: 'text',
    unique: true,
    index: true,
    label: 'ISO 3166-1 code',
  },
])

export const Languages = reference('languages', { singular: 'Language', plural: 'Languages' }, [
  {
    name: 'iso',
    type: 'text',
    unique: true,
    index: true,
    label: 'ISO 639-1 code',
  },
  { name: 'englishName', type: 'text' },
])
