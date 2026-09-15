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

export function WorkspaceSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, t } = useLanguage();
  const { agencies, selectedAgencyId, selectedWorkspaceId, setWorkspace } = useSessionStore();
  const agency = agencies.find((item) => item.id === selectedAgencyId);
  if (!agency || agency.workspaces.length === 0) return null;
  return (
    <Select value={selectedWorkspaceId ?? ''} onValueChange={setWorkspace}>
      <SelectTrigger
        className={compact ? 'w-40' : 'w-52'}
        label={compact ? undefined : t(locale, 'common.workspace')}
      >
        <SelectValue placeholder={t(locale, 'common.workspace')} />
      </SelectTrigger>
      <SelectContent>
        <SelectViewport>
          {agency.workspaces.map((workspace) => (
            <SelectItem key={workspace.id} value={workspace.id}>
              {workspace.name}
            </SelectItem>
          ))}
        </SelectViewport>
      </SelectContent>
    </Select>
  );
}
