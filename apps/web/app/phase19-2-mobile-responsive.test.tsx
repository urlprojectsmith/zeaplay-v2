import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const repoRoot = join(root, '..', '..');

describe('Phase 19.2 mobile responsive application experience', () => {
  it('keeps one responsive app instead of a separate mobile route tree', () => {
    expect(existsSync(join(root, 'app', 'mobile'))).toBe(false);
    expect(
      allSourceFiles(join(root, 'app')).some((file) => file.split(/[\\/]/).includes('mobile')),
    ).toBe(false);
  });

  it('preserves browser zoom and enables standalone safe-area rendering', () => {
    const layout = read('app/layout.tsx');
    expect(layout).toContain("width: 'device-width'");
    expect(layout).toContain('initialScale: 1');
    expect(layout).toContain("viewportFit: 'cover'");
    expect(layout).not.toContain('userScalable');
    expect(layout).not.toContain('maximumScale');

    const globals = read('app/globals.css');
    expect(globals).toContain('env(safe-area-inset-top)');
    expect(globals).toContain('env(safe-area-inset-bottom)');
    expect(globals).toContain('env(safe-area-inset-left)');
    expect(globals).toContain('env(safe-area-inset-right)');
    expect(globals).toContain('overflow-x: hidden');
  });

  it('uses the shared navigation source for mobile drawer RBAC and route-close behavior', () => {
    const shell = read('components/layout/DashboardShell.tsx');
    const mobileSidebar = read('components/layout/MobileSidebar.tsx');
    const appHeader = read('components/layout/AppHeader.tsx');

    expect(shell).toContain('filteredConfig');
    expect(shell).toContain('<MobileSidebar config={filteredConfig}');
    expect(mobileSidebar).toContain('NavigationGroup');
    expect(mobileSidebar).toContain('AccountContextSwitcher');
    expect(mobileSidebar).toContain('usePathname');
    expect(mobileSidebar).toContain('onOpenChange(false)');
    expect(mobileSidebar).toContain('id="mobile-navigation-drawer"');
    expect(appHeader).toContain('aria-controls="mobile-navigation-drawer"');
    expect(appHeader).toContain('aria-expanded={mobileOpen}');
  });

  it('keeps mobile header access to search, notifications, profile, install, and logout', () => {
    const appHeader = read('components/layout/AppHeader.tsx');
    const profileMenu = read('components/navigation/ProfileMenu.tsx');

    expect(appHeader).toContain('<GlobalSearch scope={config.scope} />');
    expect(appHeader).toContain('<NotificationCenter />');
    expect(appHeader).toContain('<ProfileMenu />');
    expect(profileMenu).toContain('PwaInstallDialog');
    expect(profileMenu).toContain("t(locale, 'common.logout')");
  });

  it('keeps dialogs, dropdowns, forms, and tabs touch friendly on narrow screens', () => {
    expect(readUi('components/button.tsx')).toContain('min-h-11');
    expect(readUi('components/dialog.tsx')).toContain('100dvh');
    expect(readUi('components/dropdown-menu.tsx')).toContain('max-h-[min(28rem');
    expect(readUi('components/input.tsx')).toContain('min-h-11');
    expect(readUi('components/select.tsx')).toContain('min-h-11');
    expect(readUi('components/tabs.tsx')).toContain('overflow-x-auto');
  });

  it('keeps PWA install/offline UI mobile safe without implementing full web push', () => {
    const pwaProvider = read('contexts/pwa-provider.tsx');
    const installDialog = read('components/pwa/PwaInstallDialog.tsx');
    const serviceWorker = read('public/sw.js');

    expect(pwaProvider).toContain('safe-area-bottom');
    expect(installDialog).toContain('PwaInstallDialog');
    expect(installDialog).toContain('safe-area-bottom');
    expect(serviceWorker).toContain('push');
    expect(serviceWorker).not.toContain('pushManager.subscribe');
    expect(serviceWorker).not.toContain('Notification.requestPermission');
  });

  it('keeps the offline fallback readable in EN and TA', () => {
    const offline = read('app/offline/page.tsx');
    expect(offline).toContain("You're offline");
    expect(offline).toContain('நீங்கள் ஆஃப்லைனில் உள்ளீர்கள்.');
    expect(offline).toContain('safe-area-bottom');
  });

  it('records representative mobile, tablet, and desktop overflow coverage', () => {
    const e2e = readFromRepo('tests/e2e/app.spec.ts');
    for (const width of [
      '320',
      '360',
      '375',
      '390',
      '412',
      '430',
      '768',
      '820',
      '1024',
      '1280',
      '1440',
    ]) {
      expect(e2e).toContain(width);
    }
    expect(e2e).toContain('document.documentElement.scrollWidth - window.innerWidth');
    expect(e2e).toContain(
      'authenticated workspace shell supports tenant, theme, language, and mobile navigation',
    );
    expect(e2e).toContain('authenticated task Kanban supports status columns, fallback move');
  });
});

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

function readUi(path: string) {
  return readFileSync(join(repoRoot, 'packages', 'ui', 'src', path), 'utf8');
}

function readFromRepo(path: string) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

function allSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) return allSourceFiles(fullPath);
    return /\.(tsx?|jsx?)$/.test(entry) ? [relative(root, fullPath)] : [];
  });
}
