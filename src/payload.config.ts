import path from 'path'
import { fileURLToPath } from 'url'
import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { s3Storage } from '@payloadcms/storage-s3'
import { resendAdapter } from '@payloadcms/email-resend'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Movies } from './collections/Movies'
import { TvShows } from './collections/TvShows'
import { People } from './collections/People'
import { Credits } from './collections/Credits'
import { Genres, ProductionCompanies, Networks, Countries, Languages } from './collections/reference'
import { Posts, Pages, Media } from './collections/editorial'
import { Submissions } from './collections/Submissions'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildConfig({
  /**
   * Outbound mail: password resets, and editor invitations later.
   *
   * Without an adapter Payload writes these to the server console, which on a
   * serverless host means they vanish into the function logs — a password reset
   * that cannot be received is the same as no password reset at all.
   *
   * Left undefined when RESEND_API_KEY is absent so local development keeps the
   * console behaviour rather than failing to send. Unlike the storage plugin
   * below, an email adapter contributes no admin components, so this condition
   * cannot desynchronise the importMap.
   *
   * The from address defaults to Resend's shared `onboarding@resend.dev`, which
   * only delivers to the Resend account owner. Set EMAIL_FROM_ADDRESS to a
   * verified domain to reach anyone else.
   */
  email: process.env.RESEND_API_KEY
    ? resendAdapter({
        apiKey: process.env.RESEND_API_KEY,
        defaultFromAddress: process.env.EMAIL_FROM_ADDRESS ?? 'onboarding@resend.dev',
        defaultFromName: process.env.EMAIL_FROM_NAME ?? 'Watchlister',
      })
    : undefined,
  admin: {
    user: Users.slug,
    meta: {
      titleSuffix: ' · Watchlister',
    },
  },
  collections: [
    Movies,
    TvShows,
    People,
    Credits,
    Genres,
    ProductionCompanies,
    Networks,
    Countries,
    Languages,
    Posts,
    Pages,
    Media,
    Submissions,
    Users,
  ],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL || '',
    },
    // Neon pools connections through a pgbouncer-style proxy; Payload's
    // migrations need to run outside a transaction pool.
    push: process.env.NODE_ENV !== 'production',
  }),
  sharp,
  upload: {
    limits: { fileSize: 10_000_000 },
  },
  /**
   * Media goes to object storage when it is configured, and to local disk
   * otherwise.
   *
   * Local disk is fine in development but fails on any serverless host — the
   * filesystem is read-only and ephemeral, so uploads would appear to succeed
   * and then vanish. Setting the S3_* variables switches this over without a
   * code change; it works with S3 proper, Cloudflare R2, Backblaze B2 and
   * anything else speaking the S3 API.
   */
  plugins: [
    /**
     * Always in the array, switched off by `enabled` rather than omitted.
     *
     * Adding the plugin conditionally made the resolved config — and so the
     * generated importMap — depend on which S3_* variables happened to be set.
     * An importMap generated without them omitted the plugin's client
     * component, and the admin then rendered a blank page in every environment
     * that did have them. Keeping the shape constant makes the importMap
     * deterministic. `alwaysInsertFields` does the same for the collection
     * schema, and becomes the Payload v4 default.
     */
    s3Storage({
      enabled: Boolean(process.env.S3_BUCKET),
      alwaysInsertFields: true,
      collections: { media: true },
      bucket: process.env.S3_BUCKET ?? '',
      config: {
        region: process.env.S3_REGION ?? 'auto',
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle: Boolean(process.env.S3_ENDPOINT),
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
        },
      },
    }),
  ],
})
