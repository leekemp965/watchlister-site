# Watchlister — WordPress to Next.js migration

Reference notes for rebuilding watchlister.co. Written as raw material for a
guide: everything established so far, with the reasoning behind each decision
and the numbers that justify it.

Last updated during the initial TMDB import.

---

## 1. What the old site was

A WordPress film and television database at `watchlister.co`, built on a
Tailwind + Docker boilerplate by Accent Design. It is currently offline; the
domain is still owned.

**Archive contents** — `watchlisterco.tar.gz`, 2.4 GB compressed, 8 GB
uncompressed, 313,203 files:

| Component | Size | Files |
|---|---|---|
| Breeze page cache | 6.8 GB | 237,254 |
| Media uploads | 1.1 GB | 60,290 |
| Third-party plugins | 101 MB | 12,064 |
| WordPress core + default theme | ~60 MB | ~3,500 |
| **Custom code** | **4 MB** | **186** |

99.95% of the archive was disposable. The actual project was two pieces:

- **Theme `accent1990`** — 3,640 lines. Registered eleven custom post types
  (movie, tv_show, actor, director, writer, composer, creator,
  production_company, network, country, language) plus genre taxonomies, with
  matching `single-*.php` templates.
- **Plugin `wp_tmdb_plugin`** — 3,527 lines. Custom TMDB integration: bulk
  import, AJAX manager, and a REST API with JWT auth.

Plus a separate 1.7 GB MariaDB dump (`watchlisterco.sql`, 5,188,674 lines).

**Third-party plugins in use:** Advanced Custom Fields Pro, Wordfence, Gravity
Forms, Admin Columns Pro, Yoast SEO, WP Mail SMTP, Imagify, Breeze, Object
Cache Pro, Redirection.

---

## 2. Why move off WordPress

Not preference — a structural limit the old site had already hit.

Every entity was a WordPress post, and every relationship between them lived in
`wp_postmeta` as key-value strings. A cast list was an ACF repeater flattened
into rows named `cast_0_actor`, `cast_0_character`, `cast_1_actor` and so on.

`cast_N_actor` appears **168,117 times**. ACF writes a shadow `_`-prefixed row
alongside every value, so that single structure is **336,234 rows** of strings
with no foreign keys and no useful index. Rendering one film page meant dozens
of meta lookups.

That is why the database reached 1.7 GB and why 6.8 GB of page cache existed —
the cache was hiding the cost, not solving it. Roughly 137,000 entities across
~2.3 million `postmeta` rows.

The same data as proper tables with foreign keys is roughly 200 MB and needs no
page cache at all.

---

## 3. The new stack

| Layer | Choice | Version |
|---|---|---|
| Framework | Next.js, App Router | 16.3 |
| UI | React | 19.2 |
| CMS | Payload | 3.88 |
| Database | Postgres on Neon (`eu-west-2`, London) | 18.4 |
| Styling | Tailwind | 4 |
| Language | TypeScript | 5 |

**Why Payload:** it gives a WordPress-like admin UI for editorial work while
storing everything in real relational tables. Role-based access is built in, so
adding editors later is an invite and a dropdown — no re-architecture.

**Why Neon:** no local install (this machine has no Docker, Homebrew or
Postgres), no disk used, and it doubles as the production database so there is
no second migration at deploy time.

Live schema: **36 tables, 208 indexes**.

---

## 4. Data model: old to new

### The people collapse

The old site had five separate post types for humans — actor, director, writer,
composer, creator. Anyone who both wrote and directed a film existed as two
unrelated posts with different ids and no link between them.

TMDB issues **one person id** regardless of role, so keying on it collapses
these automatically. What someone *did* is a property of the credit, not of the
person.

### Credits

The single most important change. One `credits` table:

| column | purpose |
|---|---|
| `person` | FK to people |
| `role` | actor / director / writer / composer / creator |
| `movie` / `tvShow` | exactly one is set, enforced by a hook |
| `character` | actors only |
| `order` | billing order |

Indexed on `(movie, role, order)`, `(tvShow, role, order)` and `(person, role)`.
"Who was in this film" and "what was this person in" are the same cheap query.

### Full mapping

| WordPress | New |
|---|---|
| `movie` CPT | `movies` |
| `tv_show` CPT | `tv-shows` |
| `actor`/`director`/`writer`/`composer`/`creator` CPTs | `people` (unified) |
| ACF `cast` repeater + `directors`/`writers`/`composers` | `credits` |
| `production_company`, `network` CPTs | `production-companies`, `networks` |
| `country`, `language` CPTs | `countries`, `languages` |
| `genre` + `tv_genre` taxonomies | `genres` with a `medium` field |
| `post`, `page` | `posts`, `pages` |
| Uploaded media | `media` (own uploads only) |

### Images

TMDB artwork is referenced by CDN path (`/abc123.jpg`) and optimised by Next.js
at request time, rather than downloaded locally. This is what replaces the
1.1 GB / 60,290-file uploads directory. Only images you upload yourself go in
`media`.

### Genres

TMDB numbers film and television genres in **separate spaces** — id 18 is Drama
for films and also Drama for shows. So `tmdbId` on genres is *not* unique; the
pair `(tmdbId, medium)` identifies a genre.

---

## 5. What the old database actually contained

Extracted by streaming the 1.7 GB dump. Post-type counts were verified twice by
independent methods.

### Catalogue, with data quality

| type | records | unique TMDB ids | no id | ids used twice+ |
|---|---|---|---|---|
| actor | 95,133 | 93,036 | 201+ | 1,893 |
| movie | 11,282 | 10,892 | 238 | 70 |
| production_company | 6,562 | 6,518 | 2 | 33 |
| director | 5,209 | 4,895 | 2 | 194 |
| writer | 2,690 | 2,671 | — | 19 |
| composer | 1,261 | 1,249 | — | 12 |
| tv_show | 1,050 | 821 | 162 | 20 |
| creator | 815 | 810 | — | 5 |
| network | 240 | 237 | — | 3 |
| language | 59 | — | — | — |
| post | 18 | — | — | — |
| page | 8 | — | — | — |

**The old database carried significant duplication.** One film (TMDB 792307)
existed as **eleven separate records**. Because everything is keyed on `tmdbId`,
these collapse automatically on import rather than needing a cleanup pass.

**Records with no TMDB id** split two ways:
- Films: every one sampled had an **empty title** — junk rows, safely discarded.
- Shows and actors: real and recoverable by name search (*Murder, She Wrote*,
  *Elif*, the Monty Python cast). Outstanding work.

### The editorial layer

The part TMDB cannot give back, and the reason the migration is careful:

| content | count |
|---|---|
| titles with any editorial content | **409** |
| with videos | 408 |
| with podcasts | 33 |
| with linked articles | 42 |
| **with custom copy** | **0** |
| posts and pages | 26 |

Out of ~137,000 entities, only **409 carry hand-written content**.

**There is no custom content anywhere.** All 465 `custom_content` rows are empty
strings — the ACF field group was attached to those titles but the field was
never once filled in. Worth double-checking against your own memory of the site,
but the data is unambiguous.

### There is no generic `tmdb_id` key

Each post type used its own, named after the old CPT: `tmdb_movie_id`,
`tmdb_tv_show_id`, `tmdb_actor_id`, `tmdb_director_id`, `tmdb_writer_id`,
`tmdb_composer_id`, `tmdb_creator_id`, `tmdb_company_id`, `tmdb_network_id`.
Crew are inconsistent — some rows use the role-specific key, some use
`tmdb_person_id`. Both are read.

---

## 6. Project layout

```
watchlisterco/
├── watchlisterco.tar.gz        original archive (untouched)
├── watchlisterco.sql           original 1.7 GB dump (untouched)
├── site/                       old custom code only, extracted for reference
└── watchlister/                the new application
    ├── src/
    │   ├── payload.config.ts   collection registry, DB adapter
    │   ├── collections/        Movies, TvShows, People, Credits, reference, editorial, Users
    │   ├── fields/editorial.ts shared editorial fields, tmdbId, image paths
    │   └── app/
    │       ├── (frontend)/     the public site
    │       └── (payload)/      admin UI and API routes
    ├── scripts/
    │   ├── extract-wordpress.mjs   streams the dump, writes JSON
    │   ├── sync-tmdb.ts            populates the catalogue from TMDB
    │   └── init-db.ts              creates schema, reports collections
    └── data/                   extraction output (see below)
```

### Extraction output (`data/`)

| file | contents |
|---|---|
| `editorial.json` | the 409 records of hand-written content |
| `articles.json` | the 26 posts and pages |
| `tmdb-seeds.json` | every TMDB id to import, per type |
| `id-map.json` | WordPress post id → TMDB id, for reattaching relationships |
| `data-quality.json` | duplicates and missing ids, per type |
| `sync-checkpoint.json` | ids already synced; makes the import resumable |
| `sync-failures.json` | written only if something fails |

---

## 7. Commands

All from `watchlister/`.

```bash
npm run dev          # dev server; site on :3000, admin on :3000/admin
npm run extract      # re-parse the WordPress dump into data/
npm run init-db      # push schema, report collection counts
npm run sync         # import from TMDB (resumable)
npm run types        # regenerate payload-types.ts after schema changes
npm run build        # production build
```

Sync flags:

```bash
npm run sync -- --only=movies      # or --only=shows
npm run sync -- --limit=50         # trial run
npm run sync -- --force            # ignore the checkpoint and re-fetch
```

Concurrency is `SYNC_CONCURRENCY` (default 12).

**Scripts must run under `tsx`, not `payload run`** — see gotchas.

---

## 8. Environment and security

`.env.local`, git-ignored. Template in `.env.example`.

| variable | notes |
|---|---|
| `DATABASE_URL` | Neon **direct** connection string, not the pooled one |
| `PAYLOAD_SECRET` | any long random value; generated already |
| `TMDB_API_KEY` | v3 key |
| `NEXT_PUBLIC_SITE_URL` | canonical URLs and sitemaps |

### Outstanding security items

1. **Rotate the TMDB key.** The old site hardcoded it in plugin source at
   `site/app/wp-content/plugins/wp_tmdb_plugin/classes/class-wp_tmdb_plugin_manager.php:74`.
   It is currently reused in `.env.local` so the pipeline could be proven.
   It has sat in plaintext inside an archive — replace it.
2. **The old `wp-config.php` and `wp-salt.php` contain live production
   credentials** and auth salts. The SQL dump contains user emails and password
   hashes, and its header names the old Cloudways host and IP. Do not commit
   `site/` to a public repository without scrubbing.
3. Neon Auth was deliberately **not** enabled — Payload owns authentication.
   Turning it on would create a second, unrelated user system in the same
   database.

---

## 9. Gotchas

Things that broke, and why, so they don't cost time again.

**`create-next-app` does not set `"type": "module"`.** Payload 3 is ESM-only.
Without it everything falls back to CommonJS, which breaks top-level `await`
*and* module resolution, with misleading errors about both.

**`payload run` fails silently.** It exits with code 0, prints nothing, and does
nothing. Discovered only by querying the database directly instead of trusting
the exit code. Use `tsx` for all scripts. **Verify outcomes against the
database, not against exit codes.**

**Neon's pooled connection string breaks migrations.** Payload creates tables
and indexes in a transaction; connection poolers break that and can leave a
half-applied schema. Use the direct string — the hostname without `-pooler`.

**Concurrent upserts race.** Two films sharing an actor both check for that
person, both find nothing, both insert, and one dies on the unique constraint.
Caching the resolved id is not enough — the window is *during* the await. The
fix is caching the **in-flight promise**, plus catching the constraint violation
and re-reading. This cost 7 of the first 50 films.

**One `find` per cast member is the throughput ceiling.** 30 sequential lookups
per film capped the import at 0.4 titles/sec — seven hours. Batching them into
one `in` query, and letting the person cache warm, took it to 1.8/sec.

**npm's `allow-scripts` setting** blocks install scripts for `esbuild` and
`unrs-resolver`. Harmless so far, but the first thing to check if the toolchain
misbehaves.

**MySQL dumps cannot be parsed with regex.** `post_content` is full of
apostrophes, escaped backslashes and commas. The extractor uses a hand-written
tokeniser, and statements can wrap across lines when content contains raw
newlines.

---

## 10. Design carry-over

The old theme's Tailwind design transfers, but not verbatim: it was Tailwind 3,
the new project is Tailwind 4, where theme config moves out of
`tailwind.config.js` and into CSS.

Palette in use: `vermilion` (accent, headings, hover), `cod-gray` (cards),
`gray-950` (page background). The site is dark-themed throughout.

Templates to port, from `site/app/wp-content/themes/accent1990/`:
`single-movie.php` (337 lines, the most complex), `single-actor.php`,
`single-tv_show.php`, the four other `single-*` crew templates, `header.php`,
`footer.php`, `home.php`, `front-page.php`, `search.php`, `search-shows.php`,
`archive.php`.

Movie page sections, in display order: cover artwork with gradient, poster,
title and year, synopsis, running time, credits table (director, writers,
composers, genres, certificate, release date, production companies), custom
content, video embeds, podcasts, articles, trailer, cast carousel.

---

## 11. The adult content problem

Discovered while investigating why 1,525 films had no director credit. The
answer was that TMDB holds no crew for them at all — but the reason it holds no
crew turned out to matter more than the missing directors.

A random sample of 40 films from the **whole catalogue** found **23 flagged
adult by TMDB itself** — roughly 57%. In the no-director subset it was 73%.

This was inherited, not introduced. The old WordPress bulk importer evidently
ran without `include_adult=false`, so this content has been in the database
since the original import.

The initial sync discarded TMDB's `adult` boolean. It is now stored on `movies`,
indexed, and backfilled by `scripts/backfill-adult.mjs`, which writes the full
flagged list to `data/adult-titles.json` for review before anything is deleted.

**Caveats on the flag:** it is imperfect in both directions. Some clearly
non-adult titles appear unflagged in the no-director set (*Sesame Street: Get Up
and Dance*), and the sample of 40 puts the true share somewhere around half to
two-thirds rather than exactly 57%. Review the list rather than trusting the
percentage.

### Outcome

The backfill flagged **5,067 of 10,824 films (46.8%)** — below the 57% sample
estimate, well within sampling error at n=40.

Before deleting, three false-positive checks were run
(`scripts/review-adult.mjs`). The decisive one: **not a single one of the 409
editorial titles was flagged.** Every film with hand-written content sat on the
keep side, which tests the flag against your own judgement rather than TMDB's.

Note that 3,700 flagged films *do* have a director credit, so crew presence is
**not** a safety signal — *Pirates II: Stagnetti's Revenge* has a director and is
a pornographic parody.

Deleted (`scripts/delete-adult.mjs`, one transaction, verified before commit):

| | before | after | change |
|---|---|---|---|
| movies | 10,824 | 5,757 | −5,067 |
| credits | 167,862 | 110,607 | −57,255 |
| people | 82,398 | 68,099 | −14,299 |
| tv_shows | 816 | 816 | — |
| size | 105 MB | **72 MB** | after `vacuum full` |

Post-deletion verification: all 405 editorial titles present (379 films, 26
shows), zero orphaned credits, zero orphaned rels rows.

**Deletion order matters.** `credits.movie_id` and `credits.person_id` are
`SET NULL`, not `CASCADE`. Deleting films first would have left 57,255 credits
pointing at nothing instead of removing them. Credits must go first, explicitly.

**Still reversible.** `data/tmdb-seeds.json` holds every id and the sync is
idempotent, so re-running restores anything removed.

**Edge cases left in place by this rule:** some erotic arthouse was removed along
with the pornography — Tinto Brass's *Monamour* and *Intimità anale*, plus
ambiguous titles like *Faust*, *Inferno* and *The Image*. If any should come
back, they can be re-imported individually by tmdb id.

---

## 12. Status

**Done**
- Old code extracted and understood
- Schema designed and live on Neon
- WordPress dump parsed; editorial layer, seeds and id map extracted
- TMDB sync built and **complete**: 61.8 minutes, 11,463 requests, zero failures
- Credits integrity verified

**Imported**

| collection | rows |
|---|---|
| movies | 10,824 |
| tv_shows | 816 |
| people | 82,398 |
| credits | 167,862 |
| production_companies | 6,388 |
| networks | 230 |
| genres | 36 |
| database size | 105 MB |

Credits by role: actor 143,211 · director 10,356 · writer 9,138 ·
composer 4,314 · creator 843.

- Adult titles removed
- **Editorial layer imported — all 409 records attached, zero unmatched**

### Editorial import

`scripts/import-editorial.ts`. Posts are created first, because a few article
links point at them rather than out to the web.

| | |
|---|---|
| posts | 18 |
| pages | 8 |
| films with editorial | 379 |
| shows with editorial | 26 |
| people with editorial | 4 |
| **unmatched** | **0** |
| video embeds | 1,100 |
| podcasts | 142 (2 skipped — title but no URL) |
| article links | 248 (1 internal, resolved) |

Three things needed handling:

**Emmy Clarke did not exist.** People are only created from the top-30 billed
cast of synced films, so someone written about but never billed that highly is
absent. The importer now falls back to fetching the person from TMDB rather
than dropping their content.

**Inline images broke rich text validation.** WordPress post content contains
`<img>` tags, which the HTML-to-Lexical converter turns into upload nodes
pointing at WordPress attachment ids. Those do not exist in Payload's media
library, so the document fails with *"not a valid upload ID"*. 22 such nodes are
stripped and recorded in `data/inline-images-todo.json`.

**Two podcasts have a title but no URL** (*The Greatest Showman*, duplicated).
Nothing to link to, so they are skipped and reported.

**HTML to Lexical** needs `jsdom` plus a sanitised editor config obtained from
`editorConfigFactory.default({ config: payload.config })` — calling
`convertHTMLToLexical` without it fails with an opaque
`Cannot read properties of undefined (reading 'features')`.

### Editorial images

A second pass over the dump (`scripts/extract-attachments.mjs`), because the
first deliberately ignored attachments — TMDB artwork comes from their CDN, so
the 1.1 GB uploads folder looked irrelevant. It was not: the editorial layer
references uploads of its own.

Of 12,471 attachments, only **222 files (20 MB)** were actually needed. They are
extracted selectively from the archive via a tar include list rather than
unpacking the whole uploads directory.

| | |
|---|---|
| media uploaded | 222 (0 failures) |
| article thumbnails attached | 229 across 38 records |
| post featured images | 17 |
| inline images placed | 22 across 18 posts and 1 page |
| files on disk incl. generated sizes | 619 (35 MB) |

**Inline images needed a marker round-trip.** The HTML converter turns `<img>`
into upload nodes with no usable value — it cannot know which Payload media a
WordPress URL refers to, which is why the first import had to strip them. The
fix is to replace each `<img>` with a placeholder paragraph *before* conversion,
then swap the placeholders for real upload nodes afterwards. This keeps every
image in its original position.

WordPress rewrites `<img src>` to a sized variant (`foo-768x512.jpg`), so the
size suffix is stripped to find the original and let Payload generate its own.

**Counting upload nodes in Postgres is misleading.** A `jsonb_path_query` using
the `$.**` recursive wildcard reported 44 — exactly double — because it visits
array members twice. A recursive walk in JS confirmed the true figure: 22 nodes,
22 distinct media ids, no nulls. Another case where the first number was wrong
and only cross-checking caught it.

### ⚠ Media storage will not survive deployment

The 222 files live on local disk under `./media`. Vercel's filesystem is
ephemeral, so they will vanish on deploy. Before going live this needs a storage
adapter — `@payloadcms/storage-vercel-blob` or `@payloadcms/storage-s3` — and
the media re-uploaded through it. TMDB artwork is unaffected.

### Front end

Ported from the old theme: home, film, TV, person, browse listings with
pagination, blog index and post, static pages, 404. Tailwind 4 moves theme
config out of `tailwind.config.js` and into CSS — the palette now lives in an
`@theme` block in `globals.css`.

One page replaces five: the old site had `single-actor`, `single-director`,
`single-writer`, `single-composer` and `single-creator` templates. Since role is
a property of the credit, `/people/[slug]` groups a filmography by itself.

**Images were never broken.** An early screenshot showed blank spaces and I
called it a serving bug; it was `loading="lazy"` doing its job on below-the-fold
images. All three layers check out — file on disk, Payload route (200,
`image/webp`), Next optimiser (200, `image/jpeg`). Diagnose from the response,
not the screenshot.

**6 of 1,100 video embeds were unplayable** — 5 are Vimeo, which the old theme
handled via WordPress oEmbed and the new `videoEmbed()` now supports explicitly.
The 6th is a bare `https://youtu.be/` with no id, broken in the original data.

### Search

`/search`, backed by pg_trgm GIN indexes (`scripts/create-search-indexes.mjs`).
A title lookup runs in **0.057ms**.

Runs as raw SQL rather than through Payload's query builder for one reason:
people need ranking by credit count. Searching "smith" against 68,099 people
alphabetically is useless; ranking by credits puts the right Smith first.
Ordering is exact match, then prefix match, then popularity (or credit count
for people).

Trigram matching means partial and mid-word queries work — "ville" finds
Villeneuve, and "dune" also turns up *Allan Cor**dune**r*.

**Re-run the index script after any Payload schema push** — drizzle may drop
indexes it does not know about.

### On-demand import: the catalogue grows from what people search for

**This is the most important thing to understand about how the site works, and
I initially rebuilt it wrong.**

The old WordPress site never held a fixed catalogue. Its search
(`[search_movies]`) queried TMDB's API directly — not the local database — and
showed results in Movies / TV Shows / Actors tabs. Clicking one POSTed the TMDB
id to `get_or_add_movies()`, which looked for a local post and, finding none,
created it along with cast, crew, companies and genres.

So the 11,282 films it accumulated were **whatever people had looked for**.
That explains the uneven mix, the absence of famous films nobody happened to
search, and the 5,067 adult titles — someone searched for each one.

The first rebuild searched only local Postgres, so the catalogue could not grow
and anything never previously searched was invisible. That was a regression.

**How it works now** (`src/lib/tmdb-import.ts`):

- Search queries the local catalogue *and* TMDB in parallel; local results are
  listed first, since those carry the editorial content
- Slugs end in the TMDB id (`dune-438631`), so a link can be built before the
  record exists
- The title routes import on a miss, then serve the page
- Adult titles are declined at import, so the old problem cannot recur
- The same module backs `scripts/sync-tmdb.ts`, so bulk and on-demand imports
  cannot drift apart

**Performance — two separate problems, both now fixed.**

*The import itself.* Going through `payload.create` per credit meant ~70 round
trips with validation and hooks on each: 47 seconds against a 60-second
serverless ceiling. Rewritten as five set-based statements, a fresh import is
now **3–5 seconds**. A `loading.tsx` covers the wait.

*Every other view.* The title routes had no `generateStaticParams`, so Next
classified them as fully dynamic and **ignored `revalidate` entirely** — every
request re-rendered and re-queried, showing `x-vercel-cache: MISS` on every hit
at a steady 1.2–1.9s. Adding it puts the routes into ISR.

| | before | after |
|---|---|---|
| prerendered popular title | 1.9s MISS | **0.22s HIT** |
| previously imported title | 1.4s MISS | **0.11s HIT** |
| first view, uncatalogued | 19–37s | **3–5s** |

The lesson is that `revalidate` on its own does nothing for a dynamic segment.
Without `generateStaticParams` the route never enters ISR, and the setting is
silently ignored — no warning, no error, just a permanently uncached page.

Note `gender` and `role` are Postgres enums: `unnest` yields text and the
insert will not coerce it, so those arrays need explicit casts.

**Known limitation.** When a URL carries a valid TMDB id but a non-canonical
slug (`/movies/wrongname-11645`), the redirect to the canonical URL is a
client-side RSC hop rather than an HTTP 308 — browsers follow it, `curl` and
crawlers see a 200. Moving the redirect into `generateMetadata` did not change
this; the likely cause is the `loading.tsx` boundary committing the response
before the redirect is known. It affects no real traffic, because search links
always use the canonical slug. Removing the loading state would probably fix
it, at the cost of a blank screen during a 20–40 second import — a worse trade.

### The catalogue is a curated subset, not a complete database

Worth knowing before judging any gap: searching "breaking bad" returns nothing,
because **Breaking Bad appears zero times in the entire WordPress dump.** It was
never on the old site.

The catalogue is exactly what the old bulk importer happened to pull — 5,757
films and 816 shows — not a complete film database. Expanding it is a product
decision, and now a cheap one: add TMDB ids to `data/tmdb-seeds.json` and re-run
the sync.

### People enrichment

The catalogue sync built people from credits, which carry only name, profile
path, department and gender. Biography, birth and death dates and place of birth
come from TMDB's `/person` endpoint and were never fetched, leaving the rebuild
with *less* about each person than the old site had.
`scripts/enrich-people.mjs` fixed that — 68,099 people in 34 minutes, zero
failures.

| field | people with it |
|---|---|
| birth date | 37,528 |
| place of birth | 36,688 |
| biography | 25,079 |
| death date | 13,805 |

Lower than the old site's 48,826 birth dates, but that is the ~20,000 duplicate
person records being gone, not data loss.

**Words are matched independently.** A single `ILIKE '%murder she wrote%'`
needs one contiguous run and misses *Murder, She Wrote* — the comma breaks it.
Each word is matched separately instead, which survives punctuation and word
order: "spider man" finds Spider-Man, "wrote murder" finds Murder, She Wrote.

### Recovering the records with no TMDB id

The earlier "~360" figure was from a truncated sample. The real total is **605**,
of which **214 are named and recoverable** and 391 are empty-title junk —
including every one of the 238 films, so no film was lost.

`scripts/resolve-missing-tmdb.mjs` searches TMDB by name and classifies each
match. It reports by default and only writes with `--apply`.

**Disambiguating same-name people is the hard part.** Sorting by popularity
would pick whoever is most famous, which is wrong: the old site's "Terry Jones"
is the Python, not one of nine others. The resolver instead checks each
candidate's `known_for` credits against titles already in the catalogue — the
person we want appeared in films this site holds. That single signal cut
ambiguity from 52 to 11 and lifted the importable set from 80 to 101.

| | before overlap check | after |
|---|---|---|
| importable | 80 | **101** |
| ambiguous | 52 | **11** |
| not on TMDB | 47 | 47 |

Applied: 23 people inserted, 18 shows seeded and synced (120 new credits).
All 29 missing TV shows recovered — *Murder, She Wrote*, *Elif*, *Siska*,
*Frühling*, *Balzac*, *Billionaire Boys Club*.

The 11 left ambiguous are genuinely obscure (John Case, Brian Ross) or performers
from the adult titles already removed. The 47 not found have no TMDB record at all.

Catalogue after recovery: 5,757 films · 834 shows · 68,177 people ·
110,727 credits · 96 MB.

### URLs and redirects

Three groups, because they need three different mechanisms.

**Per-record** (`/movie/dune-2021` → `/movies/dune-438631`). Old slugs carried a
year, new ones carry a TMDB id, so this is a lookup, not a pattern. Each record
stores its old slug in an indexed `legacySlug` column, populated by
`scripts/populate-legacy-slugs.mjs` joining on TMDB id. Route handlers under
`/movie/[slug]`, `/tv_show/[slug]`, `/actor/[slug]` and the other four old
person types resolve and permanently redirect.

| | coverage |
|---|---|
| films | 100% |
| shows | 97.8% |
| people | 89.2% |

The gaps are records that never existed on the old site — the 18 shows
recovered by name search, and people added from TMDB credits — so no old link
points at them.

`/production_company/`, `/network/`, `/country/` and `/language/` have no
equivalent page here; those ~6,800 URLs redirect to a search for the name
rather than 404ing.

**The old site's own rules.** 326 accumulated in its Redirection plugin, mostly
dated permalinks from before it moved to a flat structure.
`scripts/extract-redirects.mjs` pulls them out; 319 are usable.

Five were dropped as unparseable — someone had pasted a whole URL into the
source field (`/https:/watchlister.co/...`), and others contained CSS selectors.
Next parses sources with path-to-regexp, where `:` starts a named parameter, so
these fail the build with "Missing parameter name" rather than being ignored.

**Posts stay at the site root.** The old permalink structure was `/%postname%/`,
so every inbound link points at `/artificial-intelligence-movies`, not
`/blog/...`. Moving them would have broken all of it for nothing. `/blog` is the
index; `/blog/{slug}` redirects to the root for a single canonical URL.

### robots.txt and sitemaps

~75,000 URLs, past the 50,000-per-file limit, so the sitemap is chunked: an
index at `/sitemap.xml` and seven chunks at `/sitemap/{n}.xml`.

These are route handlers under `/seo/*` reached via rewrites, not Next's
`robots.ts` / `sitemap.ts` metadata files. Because posts live at the root, a
`[slug]` catch-all owns every single-segment path, and requests for
`/robots.txt` were seen resolving into it and 404ing. Rewrites resolve before
routing, so the catch-all never sees them.

Verified: 30 editorial URLs, 5,757 films, 834 shows, 68,177 people across four
chunks — 74,798 total.

### A debugging lesson worth keeping

Several rounds of the above were spent chasing routing bugs that did not exist.
`pkill -f "next start"` never matched anything, because Next renames its process
to `next-server`. An old server kept serving an old build while I rebuilt and
re-tested against it, "confirming" failures that had already been fixed.

**Check what is actually listening before trusting a result:**

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
ps -eo pid,etime,args | grep '[n]ext-server'
```

An `etime` older than your last build means you are testing the wrong thing.

### Deploy readiness

Done: production build passes, repo committed locally (739 files), S3 storage
adapter wired and switched on by env vars.

**Media storage is the one thing that will break on a serverless host.** Payload
writes uploads to local disk, and that filesystem is read-only and ephemeral —
uploads appear to succeed and then vanish. Setting `S3_BUCKET` and friends
switches it over with no code change; the 222 files in `media/` then need
re-uploading.

`media/` and `data/` are committed deliberately: `media/` is the only copy of
the editorial images outside the 2.3 GB archive, and `data/` holds everything
the import scripts need and cannot re-derive without the dump.

**Outstanding**
- Deploy — note media currently writes to local disk, which will not work on
  Vercel; needs a cloud storage adapter

### Verification

- *Spider-Man: No Way Home* returns correct billing order, character names, the
  `12A` UK certificate, trailer URL and poster path.
- Extractor post-type counts match an independent survey of the dump exactly.
- **People deduplicated as predicted:** 102,661 WordPress person-records became
  82,398 real humans — about 20,000 duplicates collapsed by TMDB id.
- **Credits landed at 167,862 against the old site's 168,117**, strong evidence
  nothing was lost.
- Referential integrity: zero orphaned credits, zero credits attached to neither
  a film nor a show, zero true duplicates.

### A discrepancy worth recording

The sync counted 159,672 credits; the database held 167,862. Timestamps traced
the 8,190 difference to a trial batch run an hour earlier. Because that trial
predated the concurrency fix, those 250 titles were re-synced — and the total
came back **identical**, proving they had been correct all along. Thin credit
counts like *A Quiet Place* (12) are genuine: it is a four-person film.

Worth checking, but the lesson is the general one — **verify against the
database, not against a script's own counters**, in both directions.

### Storage

105 MB imported, against Neon's 500 MB free tier. An early estimate of 745 MB
was wrong: it amortised the 10 MB empty-schema baseline over only 250 films.
Removing the adult titles will reduce this further.
