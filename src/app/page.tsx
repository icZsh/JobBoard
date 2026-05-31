export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8">
        <header className="flex items-center justify-between border-b border-slate-200 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">
              Local V1
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">
              Personal Job Tracker
            </h1>
          </div>
          <div className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600">
            Scaffold ready
          </div>
        </header>

        <section className="grid flex-1 place-items-center py-16">
          <div className="w-full max-w-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">
              Next.js foundation is in place.
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              The next build step adds the Postgres and Prisma data model that
              will power imports, tracking, and the daily review flow.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
