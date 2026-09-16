'use client';

import { Sparkles } from 'lucide-react';
import { useBrand } from './BrandProvider';

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  const { brand } = useBrand();
  return (
    <div className="flex min-w-0 items-center gap-2">
      {brand.logoUrl ? (
        // Arbitrary white-label logo hosts are intentionally supported without next/image remote allowlists.
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className="h-8 w-8 rounded-md object-contain" src={brand.logoUrl} />
      ) : (
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]">
          <Sparkles aria-hidden="true" className="h-4 w-4" />
        </span>
      )}
      {compact ? null : (
        <span className="truncate text-sm font-bold">{brand.brandName ?? 'Zea Play'}</span>
      )}
    </div>
  );
}
