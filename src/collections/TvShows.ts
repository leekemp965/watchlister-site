import type { CollectionConfig } from 'payload'
import { editorialFields, tmdbId, tmdbImagePath, legacySlug } from '../fields/editorial'
import { publicRead, signedIn } from './Users'
import { revalidateAfterChange, revalidateAfterDelete } from '../lib/revalidate'

/** 1,050 shows in the old dump. */
export const TvShows: CollectionConfig = {
  slug: 'tv-shows',
  labels: { singular: 'TV Show', plural: 'TV Shows' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'firstAirDate', 'numberOfSeasons'],
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
    { name: 'overview', type: 'textarea' },
    tmdbImagePath('posterPath', 'Poster'),
    tmdbImagePath('backdropPath', 'Cover artwork'),
    {
      type: 'row',
      fields: [
        { name: 'firstAirDate', type: 'date', index: true },
        { name: 'lastAirDate', type: 'date' },
        {
          name: 'status',
          type: 'text',
          admin: { description: 'e.g. Returning Series, Ended, Canceled.' },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'numberOfSeasons', type: 'number' },
        { name: 'numberOfEpisodes', type: 'number' },
        { name: 'episodeRuntime', type: 'number', label: 'Typical episode length (minutes)' },
      ],
    },
    { name: 'popularity', type: 'number', index: true },
    { name: 'youtubeUrl', type: 'text', label: 'Trailer URL' },
    {
      name: 'genres',
      type: 'relationship',
      relationTo: 'genres',
      hasMany: true,
      index: true,
      // The old site kept genre and tv_genre as two separate taxonomies with
      // overlapping terms. One vocabulary with a `medium` flag is simpler and
      // lets a genre page span both media if you ever want that.
    },
    {
      name: 'networks',
      type: 'relationship',
      relationTo: 'networks',
      hasMany: true,
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
    {
      name: 'credits',
      type: 'join',
      collection: 'credits',
      on: 'tvShow',
      admin: { defaultColumns: ['role', 'person', 'character', 'order'] },
    },
    ...editorialFields,
  ],
}
