import type { Field } from 'payload'

/**
 * The hand-written layer that sat on top of TMDB data in the old site.
 *
 * In WordPress these were ACF repeaters flattened into wp_postmeta as
 * `video_embeds_0_video_url`, `podcasts_1_title` and so on. Only ~465 of
 * ~137,000 entities carry any of it, but it is the part that cannot be
 * re-fetched from TMDB, so it is the part worth migrating carefully.
 */
export const editorialFields: Field[] = [
  {
    name: 'customContent',
    type: 'richText',
    label: 'Custom content',
    admin: {
      description: 'Free-form editorial copy shown above the TMDB summary.',
    },
  },
  {
    name: 'videoEmbeds',
    type: 'array',
    label: 'Videos',
    labels: { singular: 'Video', plural: 'Videos' },
    fields: [
      {
        name: 'videoUrl',
        type: 'text',
        required: true,
        label: 'Video URL',
      },
      {
        name: 'videoTitle',
        type: 'text',
        label: 'Title',
      },
    ],
  },
  {
    name: 'podcasts',
    type: 'array',
    label: 'Podcasts',
    fields: [
      {
        name: 'title',
        type: 'text',
        label: 'Show title',
      },
      {
        name: 'episodeTitle',
        type: 'text',
        label: 'Episode title',
      },
      {
        name: 'url',
        type: 'text',
        required: true,
      },
    ],
  },
  {
    name: 'articles',
    type: 'array',
    label: 'Articles',
    fields: [
      {
        name: 'internalLink',
        type: 'checkbox',
        label: 'Links to a post on this site',
        defaultValue: false,
      },
      {
        name: 'post',
        type: 'relationship',
        relationTo: 'posts',
        label: 'Linked post',
        admin: {
          condition: (_, siblingData) => Boolean(siblingData?.internalLink),
        },
      },
      {
        name: 'url',
        type: 'text',
        label: 'External URL',
        admin: {
          condition: (_, siblingData) => !siblingData?.internalLink,
        },
      },
      {
        name: 'title',
        type: 'text',
        admin: {
          condition: (_, siblingData) => !siblingData?.internalLink,
        },
      },
      {
        name: 'image',
        type: 'upload',
        relationTo: 'media',
        admin: {
          condition: (_, siblingData) => !siblingData?.internalLink,
        },
      },
    ],
  },
]

/**
 * Every entity that originates from TMDB carries its upstream id. This is the
 * join key for both the initial import and every subsequent refresh, so it is
 * unique and indexed rather than being just another meta value.
 */
export const tmdbId: Field = {
  name: 'tmdbId',
  type: 'number',
  required: true,
  unique: true,
  index: true,
  label: 'TMDB ID',
  admin: {
    description: 'Upstream identifier. Used to match records on every sync.',
    readOnly: true,
  },
}

/**
 * The slug this record had on the old WordPress site.
 *
 * Old URLs were /movie/dune-2021; new ones are /movies/dune-438631 — the old
 * slug carried a year, the new one carries the TMDB id. Redirecting therefore
 * needs a lookup rather than a pattern, and this indexed column is it.
 *
 * Not unique: the old site had duplicate records (one film existed eleven
 * times), so several old slugs can point at the same record. First one wins.
 */
export const legacySlug: Field = {
  name: 'legacySlug',
  type: 'text',
  index: true,
  label: 'Legacy slug',
  admin: {
    readOnly: true,
    position: 'sidebar',
    description: 'Path on the old site, used to redirect inbound links.',
  },
}

/**
 * TMDB serves images from its own CDN. The old site downloaded them into
 * wp-content/uploads, which is how that folder reached 1.1 GB across 60,290
 * files. Storing the path and letting Next optimise from the CDN avoids that
 * entirely.
 */
export const tmdbImagePath = (name: string, label: string): Field => ({
  name,
  type: 'text',
  label,
  admin: {
    description: 'Path on the TMDB image CDN, e.g. /abc123.jpg',
  },
})
