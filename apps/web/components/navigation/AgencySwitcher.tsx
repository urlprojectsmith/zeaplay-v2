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

export function AgencySwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, t } = useLanguage();
  const { agencies, selectedAgencyId, setAgency } = useSessionStore();
  if (agencies.length === 0) return null;
  return (
    <Select value={selectedAgencyId ?? ''} onValueChange={setAgency}>
      <SelectTrigger
        className={compact ? 'w-40' : 'w-52'}
        label={compact ? undefined : t(locale, 'common.agency')}
      >
        <SelectValue placeholder={t(locale, 'common.agency')} />
      </SelectTrigger>
      <SelectContent>
        <SelectViewport>
          {agencies.map((agency) => (
            <SelectItem key={agency.id} value={agency.id}>
              {agency.name}
            </SelectItem>
          ))}
        </SelectViewport>
      </SelectContent>
    </Select>
  );
}
