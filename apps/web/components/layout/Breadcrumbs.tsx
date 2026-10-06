export function Breadcrumbs({ items }: { items: string[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 text-sm text-[hsl(var(--muted-foreground))]">
      <ol className="flex min-w-0 items-center gap-1 overflow-hidden sm:gap-2">
        {items.map((item, index) => (
          <li
            key={`${item}-${index}`}
            className={index === 0 ? 'hidden truncate sm:inline' : 'min-w-0 truncate'}
          >
            {index > 0 ? <span className="mr-1 hidden sm:inline">/</span> : null}
            {item}
          </li>
        ))}
      </ol>
    </nav>
  );
}
