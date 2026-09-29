import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { accountContextKeys } from '../services/account-context';

const root = join(__dirname, '..');

describe('account context switcher', () => {
  it('mounts the validated switcher in desktop and mobile sidebars', () => {
    expect(read('components/layout/AppSidebar.tsx')).toContain('AccountContextSwitcher');
    expect(read('components/layout/MobileSidebar.tsx')).toContain('AccountContextSwitcher');
  });

  it('uses server validated context endpoints instead of local-only switching', () => {
    const service = read('services/account-context.ts');
    const store = read('stores/session.ts');

    expect(service).toContain('/account-context/switch');
    expect(service).toContain('/account-context/return');
    expect(service).toContain('/account-context/validate');
    expect(store).toContain('switchAccountContext');
    expect(store).toContain('returnAccountContext');
    expect(store).toContain('validateAccountContext');
    expect(store).toContain('zea-play-tenant-changing');
  });

  it('keys Agency and Subaccount searches by selected parent context', () => {
    expect(accountContextKeys.agencies('super-1', 'agency')).toEqual([
      'account-context',
      'agencies',
      'super-1',
      'agency',
    ]);
    expect(accountContextKeys.subaccounts('agency-1', 'sub')).toEqual([
      'account-context',
      'subaccounts',
      'agency-1',
      'sub',
    ]);
  });
});

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}
