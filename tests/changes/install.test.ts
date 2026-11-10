// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, Plugin } from 'obsidian';
import { installChanges } from '../../src/changes';
import { CHANGES_VIEW } from '../../src/changes/changes-view';
import { PLAIN_DIFF_VIEW } from '../../src/changes/plain-diff-view';
import { DEFAULT_CHANGES_SETTINGS } from '../../src/changes/settings';
import type { ChangesSettings } from '../../src/changes/types';
import { DEFAULT_SETTINGS } from '../../src/options';
import { installObsidianDom } from '../helpers/obsidian-dom';

installObsidianDom(document);

interface FakeCommand {
  id: string;
  name: string;
  hotkeys?: unknown;
  callback?: () => void;
  checkCallback?: (checking: boolean) => boolean;
}

function makePlugin(changesOverrides: Partial<ChangesSettings> = {}) {
  const views = new Map<string, (leaf: unknown) => unknown>();
  const commands: FakeCommand[] = [];
  const ribbon: { icon: string; title: string }[] = [];
  const cleanups: (() => void)[] = [];
  const status = document.createElement('div');
  const ensureSideLeaf = vi.fn(async (type: string) => ({ view: { getViewType: () => type } }));
  const events = new Map<string, ((...args: unknown[]) => void)[]>();

  const app = {
    vault: {
      on(type: string, handler: (...args: unknown[]) => void) {
        const list = events.get(type) ?? [];
        list.push(handler);
        events.set(type, list);
        return { dispose() {} };
      },
      getFileByPath: () => null,
    },
    workspace: {
      onLayoutReady: () => {},
      ensureSideLeaf,
      activeEditor: null,
    },
  } as unknown as App;

  const plugin = {
    app,
    manifest: { id: 'uncommitted', name: 'Uncommitted' },
    settings: { ...DEFAULT_SETTINGS },
    changesSettings: { ...DEFAULT_CHANGES_SETTINGS, ...changesOverrides },
    saveChangesSettings: vi.fn(async () => {}),
    saveCollapsedFolders: vi.fn(async () => {}),
    addChild: <T extends { load(): void }>(child: T): T => { child.load(); return child; },
    registerView: (type: string, factory: (leaf: unknown) => unknown) => { views.set(type, factory); },
    addRibbonIcon: (icon: string, title: string) => { ribbon.push({ icon, title }); return document.createElement('div'); },
    addCommand: (command: FakeCommand) => { commands.push(command); return command; },
    addStatusBarItem: () => status,
    register: (cleanup: () => void) => { cleanups.push(cleanup); },
    registerDomEvent: (target: EventTarget, type: string, listener: EventListener) => {
      target.addEventListener(type, listener);
      cleanups.push(() => target.removeEventListener(type, listener));
    },
  };

  return { plugin, views, commands, ribbon, status, ensureSideLeaf, cleanups };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 10; index++) await Promise.resolve();
}

let cleanup: (() => void) | undefined;
beforeEach(() => { document.body.replaceChildren(); });
afterEach(() => { cleanup?.(); cleanup = undefined; document.body.replaceChildren(); });

describe('installChanges wiring', () => {
  it('registers both views, the ribbon icon and five commands without hotkeys', () => {
    const { plugin, views, commands, ribbon } = makePlugin();
    installChanges(plugin as unknown as Plugin, {
      openDiff: vi.fn(async () => {}),
      vaultRoot: '/vault',
      settings: () => plugin.settings,
      changesSettings: () => plugin.changesSettings,
      saveChangesSettings: plugin.saveChangesSettings,
      saveCollapsedFolders: plugin.saveCollapsedFolders,
    });

    expect([...views.keys()]).toEqual([CHANGES_VIEW, PLAIN_DIFF_VIEW]);
    expect(ribbon).toEqual([{ icon: 'git-compare', title: 'Open changes list' }]);
    expect(commands.map((command) => command.id)).toEqual([
      'open-changes-list',
      'refresh-changes-list',
      'open-next-changed-file',
      'open-previous-changed-file',
      'discard-current-file',
    ]);
    for (const command of commands) expect(command.hotkeys).toBeUndefined();
    expect(commands.find((command) => command.id === 'open-next-changed-file')?.checkCallback?.(true)).toBe(false);
    expect(commands.find((command) => command.id === 'discard-current-file')?.checkCallback?.(true)).toBe(false);
  });

  it('creates an accessible status bar item and opens the left view from it', async () => {
    const { plugin, status, ensureSideLeaf } = makePlugin();
    installChanges(plugin as unknown as Plugin, {
      openDiff: vi.fn(async () => {}),
      vaultRoot: '/vault',
      settings: () => plugin.settings,
      changesSettings: () => plugin.changesSettings,
      saveChangesSettings: plugin.saveChangesSettings,
      saveCollapsedFolders: plugin.saveCollapsedFolders,
    });

    expect(status.classList.contains('unc-status')).toBe(true);
    expect(status.classList.contains('mod-clickable')).toBe(true);
    expect(status.dataset.tooltip).toBe('Open changes list');
    expect(status.getAttribute('role')).toBe('button');
    expect(status.getAttribute('tabindex')).toBe('0');
    expect(status.textContent).toBe('Git: loading');
    expect(status.getAttribute('aria-label')).toBe('Git: loading. Open changes list.');

    status.click();
    await flush();
    expect(ensureSideLeaf).toHaveBeenCalledWith(CHANGES_VIEW, 'left', { active: true, reveal: true });
  });

  it('hides the status bar item when the setting is off', () => {
    const { plugin, status } = makePlugin({ showStatusBar: false });
    installChanges(plugin as unknown as Plugin, {
      openDiff: vi.fn(async () => {}),
      vaultRoot: '/vault',
      settings: () => plugin.settings,
      changesSettings: () => plugin.changesSettings,
      saveChangesSettings: plugin.saveChangesSettings,
      saveCollapsedFolders: plugin.saveCollapsedFolders,
    });
    expect(status.classList.contains('unc-status-hidden')).toBe(true);
  });
});
