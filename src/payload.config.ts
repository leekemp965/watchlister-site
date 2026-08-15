import path from 'path'
import { fileURLToPath } from 'url'
import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { s3Storage } from '@payloadcms/storage-s3'
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
    ...(process.env.S3_BUCKET
      ? [
          s3Storage({
            collections: { media: true },
            bucket: process.env.S3_BUCKET,
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
        ]
      : []),
  ],
})
