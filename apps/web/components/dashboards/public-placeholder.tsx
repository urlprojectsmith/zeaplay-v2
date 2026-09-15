import React from 'react';

export function PublicPlaceholder({ title }: { title: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[hsl(var(--background))] px-6 text-[hsl(var(--foreground))]">
      <section className="w-full max-w-sm rounded border border-[hsl(var(--border))] bg-[hsl(var(--surface-elevated))] p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-normal">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
          Authentication contract placeholder.
        </p>
      </section>
    </main>
  );
}
