/**
 * Shown while a title page renders.
 *
 * Matters most on first view of a film that is not in the catalogue yet: the
 * page blocks while it is imported from TMDB, which takes 20-40 seconds on a
 * cold serverless invocation. Without this the browser shows nothing at all
 * and the site looks broken.
 */
export default function Loading() {
  return (
    <div className="container mx-auto px-8 py-16 sm:px-16">
      <div className="grid grid-cols-12 gap-8 md:gap-16">
        <div className="col-span-12 md:col-span-3">
          <div className="bg-cod-gray aspect-[2/3] w-full animate-pulse" />
        </div>
        <div className="col-span-12 space-y-4 md:col-span-9">
          <div className="bg-cod-gray h-10 w-2/3 animate-pulse" />
          <div className="bg-cod-gray h-6 w-24 animate-pulse" />
          <div className="space-y-2 pt-4">
            <div className="bg-cod-gray h-4 w-full animate-pulse" />
            <div className="bg-cod-gray h-4 w-11/12 animate-pulse" />
            <div className="bg-cod-gray h-4 w-9/12 animate-pulse" />
          </div>
          <p className="pt-6 text-sm text-gray-500">
            Fetching this title from The Movie Database — this only happens the first time
            anyone opens it.
          </p>
        </div>
      </div>
    </div>
  )
}
