export function Breadcrumbs({ items }: { items: string[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-[hsl(var(--muted-foreground))]">
      <ol className="flex min-w-0 items-center gap-2">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="truncate">
            {index > 0 ? <span className="mr-2">/</span> : null}
            {item}
          </li>
        ))}
      </ol>
    </nav>
  );
}
