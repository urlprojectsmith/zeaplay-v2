import React from 'react';

export function PublicPlaceholder({ title }: { title: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <section className="w-full max-w-sm rounded border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-normal text-slate-950">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Authentication contract placeholder.
        </p>
      </section>
    </main>
  );
}
