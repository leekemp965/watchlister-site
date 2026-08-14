import type { CollectionConfig } from 'payload'
import { publicRead, signedIn } from './Users'

/** The 18 editorial posts from the old site, plus anything written from now on. */
export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'publishedAt', '_status'],
    group: 'Editorial',
  },
  access: {
    read: ({ req: { user } }) => {
      if (user) return true
      // Anonymous visitors only ever see published posts.
      return { _status: { equals: 'published' } }
    },
    create: signedIn,
    update: signedIn,
    delete: signedIn,
  },
  versions: { drafts: true },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    { name: 'publishedAt', type: 'date', index: true },
    { name: 'featuredImage', type: 'upload', relationTo: 'media' },
    { name: 'excerpt', type: 'textarea' },
    { name: 'content', type: 'richText' },
    {
      name: 'relatedTitles',
      type: 'relationship',
      relationTo: ['movies', 'tv-shows'],
      hasMany: true,
      admin: { description: 'Surfaces this post on those title pages.' },
    },
  ],
}

/** The 8 static pages. */
export const Pages: CollectionConfig = {
  slug: 'pages',
  admin: { useAsTitle: 'title', group: 'Editorial' },
  access: { read: publicRead, create: signedIn, update: signedIn, delete: signedIn },
  versions: { drafts: true },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    { name: 'content', type: 'richText' },
  ],
}

/**
 * Only for images you upload yourself. TMDB artwork is referenced by CDN path
 * on the title records instead of being copied locally — that is the 1.1 GB
 * uploads folder we are deliberately not recreating.
 */
export const Media: CollectionConfig = {
  slug: 'media',
  admin: { group: 'Editorial' },
  access: { read: publicRead, create: signedIn, update: signedIn, delete: signedIn },
  upload: {
    imageSizes: [
      { name: 'thumbnail', width: 400, height: 300, position: 'centre' },
      { name: 'card', width: 768, height: 512, position: 'centre' },
    ],
    adminThumbnail: 'thumbnail',
    mimeTypes: ['image/*'],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
      admin: { description: 'Describe the image for screen readers.' },
    },
  ],
}
