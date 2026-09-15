import type { ReactNode } from 'react';

export function AppShell({ children }: { children: ReactNode }) {
  return <main className="min-h-screen bg-slate-50 text-slate-950">{children}</main>;
}
