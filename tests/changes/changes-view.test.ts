// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, WorkspaceLeaf } from 'obsidian';
import { Menu } from '../helpers/obsidian';
import { ChangesView } from '../../src/changes/changes-view';
import type { ChangesController } from '../../src/changes/controller';
import { DEFAULT_CHANGES_SETTINGS } from '../../src/changes/settings';
import type { ChangeSet, ChangedFile, ChangesSettings, ChangesState } from '../../src/changes/types';
import { installObsidianDom } from '../helpers/obsidian-dom';

installObsidianDom(document);

function changed(path: string, status: ChangedFile['status'], extra: Partial<ChangedFile> = {}): ChangedFile {
  return { path, status, binary: false, added: 1, deleted: 0, ...extra };
}
function readySet(files: ChangedFile[], added = 1, deleted = 0): ChangeSet {
  return { files, added, deleted, head: 'abc', updatedAt: 1 };
}

function makeView(state: ChangesState, options: { activePath?: string; settings?: ChangesSettings } = {}) {
  const listeners = new Set<(next: ChangesState) => void>();
  const settings: ChangesSettings = options.settings ?? { ...DEFAULT_CHANGES_SETTINGS };
  let current = state;
  const controller = {
    getState: () => current,
    subscribe: (listener: (next: ChangesState) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    activePath: () => options.activePath,
    refreshNow: vi.fn(async () => {}),
    saveCollapsedFolders: vi.fn(async () => {}),
    changesSettings: () => settings,
  } as unknown as ChangesController;
  const open = vi.fn();
  const discard = vi.fn();
  const openSettings = vi.fn();
  const view = new ChangesView({} as WorkspaceLeaf, { controller, open, discard, openSettings });
  view.app = { workspace: { on: () => ({ dispose() {} }) } } as unknown as App;
  document.body.append(view.contentEl);
  const emit = (next: ChangesState): void => {
    current = next;
    for (const listener of listeners) listener(next);
  };
  return { view, controller, open, discard, openSettings, settings, listeners, emit };
}

function row(view: ChangesView, path: string): HTMLElement {
  return view.contentEl.querySelector<HTMLElement>(`button[data-path="${path}"]`)!;
}

let view: ChangesView | undefined;
beforeEach(() => { Menu.instances = []; });
afterEach(() => { view?.unload(); view = undefined; document.body.replaceChildren(); vi.useRealTimers(); });

describe('changes view', () => {
  it('renders a summary, folder tree, badges and an active row', async () => {
    const files = [
      changed('a/b.md', 'M', { added: 2, deleted: 1 }),
      changed('a/c.md', 'U'),
      changed('root.md', 'D'),
      changed('renamed.md', 'R', { oldPath: 'old.md' }),
      changed('conflict.md', '!'),
    ];
    const setup = makeView({ status: 'ready', set: readySet(files, 9, 4) }, { activePath: 'a/b.md' });
    view = setup.view;
    await view.onOpen();

    expect(view.contentEl.querySelector('.unc-summary')?.textContent).toBe('5 changes · +9 −4');
    expect(view.contentEl.querySelectorAll('.unc-folder')).toHaveLength(1);
    expect(view.contentEl.querySelector('.unc-folder-count')?.textContent).toBe('2');
    expect(view.contentEl.querySelector('.unc-badge-m')?.textContent).toBe('M');
    expect(view.contentEl.querySelector('.unc-badge-conflict')?.textContent).toBe('!');
    expect(view.contentEl.querySelector('.unc-badge-r')?.getAttribute('aria-label')).toBe('Renamed');
    expect(row(view, 'a/b.md').closest('.unc-file')?.classList.contains('is-active')).toBe(true);
    expect(row(view, 'a/b.md').dataset.tooltip).toBe('a/b.md');
    expect(row(view, 'renamed.md').dataset.tooltip).toBe('old.md → renamed.md');

    row(view, 'a/b.md').click();
    expect(setup.open).toHaveBeenCalledWith(expect.objectContaining({ path: 'a/b.md' }));
  });

  it('collapses a folder and saves the collapsed state', async () => {
    vi.useFakeTimers();
    const setup = makeView({
      status: 'ready',
      set: readySet([changed('a/b.md', 'M'), changed('a/c.md', 'M')]),
    });
    view = setup.view;
    await view.onOpen();
    expect(view.contentEl.querySelector('button[data-path="a/b.md"]')).not.toBeNull();

    row(view, 'a').click();
    expect(view.contentEl.querySelector('button[data-path="a/b.md"]')).toBeNull();
    expect(row(view, 'a').getAttribute('aria-expanded')).toBe('false');
    await vi.advanceTimersByTimeAsync(500);
    expect(setup.controller.saveCollapsedFolders).toHaveBeenCalledWith(['a']);
  });

  it('renders empty and error states, and opens settings for a missing Git binary', async () => {
    const empty = makeView({ status: 'ready', set: readySet([]) });
    view = empty.view;
    await view.onOpen();
    expect(view.contentEl.querySelector('.unc-empty')?.textContent).toBe('No changes since last commit');
    view.unload();

    const missing = makeView({ status: 'error', kind: 'git-missing', message: 'Git was not found.' });
    view = missing.view;
    await view.onOpen();
    expect(view.contentEl.querySelector('.unc-error-message')?.textContent).toBe('Git was not found.');
    const button = view.contentEl.querySelector<HTMLButtonElement>('.unc-settings-button')!;
    button.click();
    expect(missing.openSettings).toHaveBeenCalledTimes(1);
  });

  it('offers discard for modified files and explains why renames and conflicts are blocked', async () => {
    const modified = changed('note.md', 'M');
    const setup = makeView({ status: 'ready', set: readySet([modified, changed('renamed.md', 'R', { oldPath: 'old.md' }), changed('conflict.md', '!')]) });
    view = setup.view;
    await view.onOpen();

    row(view, 'note.md').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    let menu = Menu.instances.at(-1)!;
    expect(menu.items[0]).toMatchObject({ title: 'Discard all changes', disabled: false, warning: true, icon: 'undo-2' });
    menu.items[0]!.callback?.();
    expect(setup.discard).toHaveBeenCalledWith(modified);

    row(view, 'renamed.md').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    menu = Menu.instances.at(-1)!;
    expect(menu.items[0]).toMatchObject({ title: 'Discard all changes', disabled: true });
    expect(menu.items[1]).toMatchObject({ isLabel: true, title: "Discard isn't available for renames. Use Git in a terminal." });

    row(view, 'conflict.md').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    menu = Menu.instances.at(-1)!;
    expect(menu.items[1]).toMatchObject({ isLabel: true, title: 'Resolve the conflict first.' });
  });

  it('re-renders from controller updates and restores a collapsed folder from settings', async () => {
    const setup = makeView(
      { status: 'ready', set: readySet([changed('a/b.md', 'M')]) },
      { settings: { ...DEFAULT_CHANGES_SETTINGS, collapsedFolders: ['a'] } },
    );
    view = setup.view;
    await view.onOpen();
    expect(view.contentEl.querySelector('button[data-path="a/b.md"]')).toBeNull();

    setup.emit({ status: 'ready', set: readySet([changed('a/b.md', 'M'), changed('root.md', 'M')], 2, 0) });
    expect(view.contentEl.querySelector('.unc-summary')?.textContent).toBe('2 changes · +2 −0');
    expect(view.contentEl.querySelector('button[data-path="root.md"]')).not.toBeNull();
  });
});
