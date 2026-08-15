# Deploying Watchlister

**Live at https://watchlister-zeta.vercel.app** — not yet on watchlister.co.

Project: `watch-lister/watchlister`. Environment variables are set for both
Production and Preview. Note the first `vercel deploy` was assigned to the
production target automatically, which is Vercel's behaviour for a project's
first deployment; subsequent ones are previews unless given `--prod`.

Verified live: every route 200s, all redirects resolve, Dune renders its
credits and 16 video essays, TMDB posters load, and `/sitemap/1.xml` returns
5,757 URLs without timing out.

**Outstanding: object storage.** `/api/media/file/…` returns 500, so blog
featured images and article thumbnails are missing. This is the expected gap
described below, not a regression.

Stack at deploy time:

| layer | what | status |
|---|---|---|
| database | Neon Postgres, `eu-west-2` | already live |
| app | Next.js on Vercel | to do |
| media | S3-compatible object storage | **to do, and required** |

---

## 1. Object storage is not optional

Payload currently writes uploads to `media/` on local disk. On Vercel that
fails in two ways:

- The filesystem is **read-only**, so new uploads error.
- The 619 existing files are **not included in the deployment**. Next only
  bundles files its build traces through imports, and Payload reads media by
  path at runtime, so nothing pulls them in. Blog featured images and article
  thumbnails would 404.

So storage must be configured *before or alongside* the first deploy, not after.

### Choosing a provider

The S3 adapter is already installed and wired, so anything speaking the S3 API
works.

- **Cloudflare R2** — no egress fees, 10 GB free. Set `S3_ENDPOINT` to
  `https://<account-id>.r2.cloudflarestorage.com` and `S3_REGION=auto`.
- **AWS S3** — set `S3_REGION` to a real region (`eu-west-2`) and leave
  `S3_ENDPOINT` blank.
- **Vercel Blob** — simplest integration, but needs a different adapter
  (`@payloadcms/storage-vercel-blob`) swapped into `src/payload.config.ts`.

At 35 MB, every one of these is free.

### Moving the existing files

Once the variables are set locally:

```bash
npm run upload-media -- --dry-run   # check first
npm run upload-media
```

It uploads under the same bare filenames, because that is what the database
rows reference. Idempotent — safe to re-run.

---

## 2. Environment variables

Set every one of these in the Vercel dashboard, for Production **and** Preview.

| variable | notes |
|---|---|
| `DATABASE_URL` | Neon connection string. Use the **pooled** one here — serverless functions open many short connections, which is the opposite of the migration case. |
| `PAYLOAD_SECRET` | Same value as local, or any long random string. Changing it invalidates existing sessions. |
| `TMDB_API_KEY` | **Rotate before launch.** The old site hardcoded it in plugin source and it has sat in a plaintext archive. |
| `NEXT_PUBLIC_SITE_URL` | `https://watchlister.co`. Feeds canonical URLs and the sitemap — wrong value means a sitemap full of wrong domains. |
| `S3_BUCKET` | |
| `S3_REGION` | `auto` for R2 |
| `S3_ACCESS_KEY_ID` | |
| `S3_SECRET_ACCESS_KEY` | |
| `S3_ENDPOINT` | R2/B2 only; blank for AWS |

Note the pooled/direct distinction. Migrations need the **direct** string;
the running app wants the **pooled** one.

---

## 3. Deploy

```bash
cd watchlister
vercel login      # browser
vercel            # preview deploy, gives a temporary URL
vercel --prod     # production
```

There is no repo connected, so each deploy is a manual command. That is the
trade for skipping GitHub; adding it later is `git remote add` and a push,
since the commits already exist.

---

## 4. Check after the first deploy

Order matters — a failure early makes the later ones meaningless.

```
/                              home renders, posters load
/movies/dune-438631            hero, credits table, 16 video essays
/people/christopher-nolan-525  23 credits, biography
/search?q=villeneuve           Denis above Lee
/6-new-horror-movies-2023      post at root, featured image visible  ← proves storage
/movie/badlands-1974           308 → /movies/badlands-3133           ← proves redirects
/robots.txt                    200 text/plain
/sitemap.xml                   200, index of 7 chunks
/sitemap/3.xml                 20,000 URLs, no timeout
/admin                         login works
```

The featured image on the post is the one that actually tests object storage.
Everything else can pass with storage broken.

---

## 5. Domain

Point `watchlister.co` at Vercel once the checks pass. The site has been down
for a while, so there is no downtime pressure — take the time to verify first.

---

## Known gaps

**Schema changes need migrations.** `push` is disabled when
`NODE_ENV=production`, so the running app will not alter the database. The
schema is already in place, so this is fine as-is; future field changes need
`payload migrate:create` then `payload migrate` against the **direct** URL.

**Search indexes are outside Payload's schema.** `scripts/create-search-indexes.mjs`
creates the pg_trgm GIN indexes, and drizzle may drop indexes it does not know
about on a schema push. If search suddenly slows, re-run `npm run search-indexes`.

**TMDB data goes stale.** Nothing refreshes it on a schedule. `npm run sync`
re-fetches everything and is idempotent; a monthly cron would keep popularity
and new releases current.

**No error tracking.** Worth adding something before the site takes real
traffic.
