'use client';

import { Badge } from '@zea-play/ui';
import { useLanguage } from '../../contexts/language-provider';
import { getOfflineResultMeta, type OfflineResultMeta } from '../../services/offline-cache';

export function OfflineReadIndicator({ data }: { data: unknown }) {
  const meta = getOfflineResultMeta(data);
  if (!meta) return null;
  return <OfflineReadBadge meta={meta} />;
}

export function OfflineReadBadge({ meta }: { meta: OfflineResultMeta }) {
  const { locale, t } = useLanguage();
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" role="status">
      <Badge variant="neutral">{t(locale, 'offlineRead.offline')}</Badge>
      <span>{t(locale, 'offlineRead.cachedData')}</span>
      <span>
        {t(locale, 'offlineRead.lastUpdated')} {formatCachedAt(meta.cachedAt, locale)}
      </span>
      <span>{t(locale, 'offlineRead.readOnly')}</span>
    </div>
  );
}

function formatCachedAt(value: number, locale: string) {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return new Date(value).toISOString();
  }
}
