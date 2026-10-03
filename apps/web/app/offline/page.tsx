export const metadata = {
  title: 'Offline | Zea Play',
  description: 'Zea Play offline fallback',
};

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[hsl(var(--background))] px-6 py-10 text-[hsl(var(--foreground))]">
      <section className="grid max-w-xl gap-4 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          Zea Play
        </p>
        <h1 className="text-3xl font-semibold">You're offline</h1>
        <p className="text-base text-[hsl(var(--muted-foreground))]">
          Some functionality requires internet. Reconnect to continue.
        </p>
        <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-elevated))] px-4 py-3 text-sm">
          <p>நீங்கள் ஆஃப்லைனில் உள்ளீர்கள்.</p>
          <p>தொடர இணையத்தை மீண்டும் இணைக்கவும்.</p>
        </div>
      </section>
    </main>
  );
}
