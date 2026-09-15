export function RoleLayout({
  roleName,
  children,
}: {
  roleName: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <p className="text-sm font-medium text-slate-600">{roleName}</p>
      </header>
      <div className="px-6 py-8">{children}</div>
    </main>
  );
}
