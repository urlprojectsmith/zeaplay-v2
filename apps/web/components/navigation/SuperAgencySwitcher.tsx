'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from '@zea-play/ui';
import { useLanguage } from '../../contexts/language-provider';
import { useSessionStore } from '../../stores/session';

export function SuperAgencySwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, t } = useLanguage();
  const { selectedSuperAgencyId, setSuperAgency, superAgencies } = useSessionStore();
  if (superAgencies.length === 0) return null;
  return (
    <Select value={selectedSuperAgencyId ?? ''} onValueChange={setSuperAgency}>
      <SelectTrigger
        className={compact ? 'w-44' : 'w-56'}
        label={compact ? undefined : t(locale, 'common.superAgency')}
      >
        <SelectValue placeholder={t(locale, 'common.switchSuperAgency')} />
      </SelectTrigger>
      <SelectContent>
        <SelectViewport>
          {superAgencies.map((superAgency) => (
            <SelectItem key={superAgency.id} value={superAgency.id}>
              {superAgency.name}
            </SelectItem>
          ))}
        </SelectViewport>
      </SelectContent>
    </Select>
  );
}
