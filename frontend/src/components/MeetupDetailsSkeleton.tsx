/** Loading placeholders matching MeetupDetails layout (teams only). */
export function MeetupDetailsSkeleton() {
  const pulse =
    'motion-safe:animate-pulse motion-reduce:animate-none rounded bg-gray-200 dark:bg-gray-700';

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6" aria-busy="true" aria-label="Loading meetup">
      <div className="space-y-3 text-center">
        <div className={`mx-auto h-8 w-48 ${pulse}`} />
        <div className={`mx-auto h-4 w-32 ${pulse}`} />
        <div className={`mx-auto h-4 w-full max-w-md ${pulse}`} />
      </div>

      <div className={`mx-auto max-w-xl rounded-xl border border-gray-200 p-4 dark:border-gray-800`}>
        <div className={`mx-auto mb-3 h-4 w-3/4 max-w-sm ${pulse}`} />
        <div className={`mx-auto h-10 w-40 ${pulse}`} />
      </div>

      <section className="space-y-4">
        <div className={`h-6 w-24 ${pulse}`} />
        <div className={`h-4 w-full max-w-lg ${pulse}`} />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {[0, 1].map((col) => (
            <div
              key={col}
              className="space-y-4 rounded-xl border border-gray-200 p-4 dark:border-gray-800"
            >
              <div className="flex justify-between border-b border-gray-200 pb-2 dark:border-gray-800">
                <div className={`h-6 w-20 ${pulse}`} />
                <div className={`h-4 w-16 ${pulse}`} />
              </div>
              <div className="space-y-2">
                {[0, 1, 2].map((row) => (
                  <div key={row} className={`h-12 w-full ${pulse}`} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="rounded-xl border border-gray-200 dark:border-gray-800">
        <div className={`h-10 border-b border-gray-200 dark:border-gray-800 ${pulse}`} />
        <div className="space-y-3 p-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-2">
              <div className={`h-7 w-7 shrink-0 rounded-full ${pulse}`} />
              <div className="flex-1 space-y-2">
                <div className={`h-3 w-24 ${pulse}`} />
                <div className={`h-10 w-full ${pulse}`} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
