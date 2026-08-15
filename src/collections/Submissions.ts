import type { CollectionConfig } from 'payload'
import { signedIn } from './Users'

/**
 * Reader-submitted behind-the-scenes content, awaiting review.
 *
 * The old site had a "Contribute" block, but it was only a call-to-action
 * linking to a general page — there was no way to suggest something against a
 * specific title. This is that, aimed at the 95% of titles carrying no
 * editorial content.
 *
 * Nothing here appears on the site. An editor reviews a submission and, if it
 * is any good, adds it to the title's own videos/podcasts/articles. Keeping
 * that step manual is the whole point: this is a public, unauthenticated form,
 * and anything auto-published would be an open invitation to spammers.
 */
export const Submissions: CollectionConfig = {
  slug: 'submissions',
  admin: {
    useAsTitle: 'itemTitle',
    defaultColumns: ['itemTitle', 'type', 'status', 'createdAt'],
    group: 'Editorial',
    description: 'Suggestions from readers. Review, then add to the title by hand.',
  },
  access: {
    // Anyone may submit; only signed-in users may see or act on submissions.
    create: () => true,
    read: signedIn,
    update: signedIn,
    delete: signedIn,
  },
  fields: [
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      index: true,
      options: [
        { label: 'Pending review', value: 'pending' },
        { label: 'Added to the site', value: 'added' },
        { label: 'Rejected', value: 'rejected' },
        { label: 'Spam', value: 'spam' },
      ],
      access: {
        // A submitter must not be able to mark their own submission approved.
        create: ({ req: { user } }) => Boolean(user),
        update: ({ req: { user } }) => Boolean(user),
      },
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      options: [
        { label: 'Video', value: 'video' },
        { label: 'Podcast', value: 'podcast' },
        { label: 'Article', value: 'article' },
      ],
    },
    { name: 'url', type: 'text', required: true },
    {
      name: 'itemTitle',
      type: 'text',
      label: 'What is it called?',
      required: true,
    },
    {
      name: 'note',
      type: 'textarea',
      label: 'Anything else worth knowing',
    },
    {
      name: 'movie',
      type: 'relationship',
      relationTo: 'movies',
      index: true,
      admin: { description: 'Set for films; empty for television.' },
    },
    {
      name: 'tvShow',
      type: 'relationship',
      relationTo: 'tv-shows',
      index: true,
    },
    {
      type: 'row',
      fields: [
        { name: 'submitterName', type: 'text', label: 'Name (optional)' },
        {
          name: 'submitterEmail',
          type: 'email',
          label: 'Email (optional)',
          admin: { description: 'Only used to follow up on a submission.' },
        },
      ],
    },
  ],
  hooks: {
    beforeValidate: [
      ({ data, req }) => {
        if (!data) return data
        // Same invariant as credits: a submission belongs to exactly one title.
        if (!data.movie && !data.tvShow) {
          throw new Error('A submission must reference a film or a TV show.')
        }
        // Anything arriving unauthenticated is pending, whatever it claims.
        if (!req.user) data.status = 'pending'
        return data
      },
    ],
  },
}
