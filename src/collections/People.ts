import type { CollectionConfig } from 'payload'
import { editorialFields, tmdbId, tmdbImagePath, legacySlug } from '../fields/editorial'
import { publicRead, signedIn } from './Users'

/**
 * One row per human being.
 *
 * The old site had five separate post types — actor, director, writer,
 * composer, creator — so anyone who both wrote and directed a film existed as
 * two unrelated posts with two different ids. That is why the dump holds
 * 95,133 actors plus 9,975 crew: the same people counted repeatedly.
 *
 * TMDB issues one person id regardless of what they did on a given title, so
 * keying on it collapses those duplicates automatically. What someone *did* is
 * a property of the credit, not of the person, and lives in Credits.
 */
export const People: CollectionConfig = {
  slug: 'people',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'knownForDepartment', 'birthDate'],
    group: 'Catalogue',
  },
  access: { read: publicRead, create: signedIn, update: signedIn, delete: signedIn },
  fields: [
    tmdbId,
    {
      name: 'name',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
    },
    legacySlug,
    tmdbImagePath('profileImagePath', 'Profile image'),
    {
      name: 'knownForDepartment',
      type: 'text',
      label: 'Known for',
      index: true,
    },
    {
      name: 'gender',
      type: 'select',
      options: [
        { label: 'Not specified', value: '0' },
        { label: 'Female', value: '1' },
        { label: 'Male', value: '2' },
        { label: 'Non-binary', value: '3' },
      ],
    },
    { name: 'birthDate', type: 'date' },
    { name: 'deathDate', type: 'date' },
    { name: 'placeOfBirth', type: 'text' },
    {
      name: 'biography',
      type: 'textarea',
      admin: { description: 'Sourced from TMDB; overwritten on refresh unless edited below.' },
    },
    ...editorialFields,
  ],
}
