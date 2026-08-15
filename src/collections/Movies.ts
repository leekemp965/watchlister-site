import type { CollectionConfig } from 'payload'
import { editorialFields, tmdbId, tmdbImagePath, legacySlug } from '../fields/editorial'
import { publicRead, signedIn } from './Users'
import { revalidateAfterChange, revalidateAfterDelete } from '../lib/revalidate'

/** 11,282 films in the old dump. */
export const Movies: CollectionConfig = {
  slug: 'movies',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'releaseDate', 'certificate'],
    group: 'Catalogue',
  },
  access: { read: publicRead, create: signedIn, update: signedIn, delete: signedIn },
  // Long cache windows are only safe if edits invalidate immediately.
  hooks: {
    afterChange: [revalidateAfterChange],
    afterDelete: [revalidateAfterDelete],
  },
  fields: [
    tmdbId,
    { name: 'title', type: 'text', required: true, index: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    legacySlug,
    {
      name: 'overview',
      type: 'textarea',
      admin: { description: 'TMDB synopsis. Refreshed on sync — use Custom content for your own writing.' },
    },
    tmdbImagePath('posterPath', 'Poster'),
    tmdbImagePath('backdropPath', 'Cover artwork'),
    {
      type: 'row',
      fields: [
        { name: 'releaseDate', type: 'date', index: true },
        {
          name: 'runtime',
          type: 'number',
          label: 'Running time (minutes)',
          admin: { description: 'Stored as minutes; formatted as hours and minutes on the page.' },
        },
        { name: 'certificate', type: 'text' },
      ],
    },
    {
      name: 'popularity',
      type: 'number',
      index: true,
      admin: { description: 'TMDB popularity score, used for default ordering.' },
    },
    {
      name: 'adult',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      label: 'Adult',
      admin: {
        readOnly: true,
        description:
          "TMDB's own adult flag. The old site's importer ran without filtering, so a large " +
          'share of the inherited catalogue is pornographic. Indexed so it can be excluded ' +
          'from browse, search and sitemaps.',
      },
    },
    {
      name: 'youtubeUrl',
      type: 'text',
      label: 'Trailer URL',
    },
    {
      name: 'genres',
      type: 'relationship',
      relationTo: 'genres',
      hasMany: true,
      index: true,
    },
    {
      name: 'productionCompanies',
      type: 'relationship',
      relationTo: 'production-companies',
      hasMany: true,
    },
    {
      name: 'originalLanguage',
      type: 'relationship',
      relationTo: 'languages',
    },
    {
      name: 'countries',
      type: 'relationship',
      relationTo: 'countries',
      hasMany: true,
    },
    // Cast and crew are not stored here — see the Credits collection. Payload
    // exposes them as a reverse lookup so the admin UI still shows them inline.
    {
      name: 'credits',
      type: 'join',
      collection: 'credits',
      on: 'movie',
      admin: { defaultColumns: ['role', 'person', 'character', 'order'] },
    },
    ...editorialFields,
  ],
}
