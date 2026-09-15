export function DashboardPlaceholder({ title }: { title: string }) {
  return (
    <section className="max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-normal">{title}</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
        Structural route foundation only. Product dashboards are deferred.
      </p>
    </section>
  );
}
