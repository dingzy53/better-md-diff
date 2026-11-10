// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, WorkspaceLeaf } from 'obsidian';
import { Menu } from '../helpers/obsidian';
import { ChangesView, displayName, extensionTag } from '../../src/changes/changes-view';
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
    canDiscard: (candidate: ChangedFile) => candidate.status !== 'R' && candidate.status !== '!',
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
  return view.contentEl.querySelector<HTMLElement>(`.tree-item-self[data-path="${path}"]`)!;
}

function press(key: string, init: KeyboardEventInit = {}): void {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
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

    expect(view.contentEl.querySelector('.unc-summary-count')?.textContent).toBe('5 changes');
    expect(view.contentEl.querySelector('.unc-summary-added')?.textContent).toBe('+9');
    expect(view.contentEl.querySelector('.unc-summary-deleted')?.textContent).toBe('−4');
    expect(view.contentEl.querySelector('.unc-summary')?.getAttribute('aria-label')).toBe('5 changes, 9 lines added, 4 deleted');
    expect(view.contentEl.querySelectorAll('.nav-header .nav-action-button')).toHaveLength(2);
    expect(view.contentEl.querySelector('button')).toBeNull();

    const folder = row(view, 'a');
    expect(folder.classList.contains('mod-collapsible')).toBe(true);
    expect(folder.querySelector('.collapse-icon')?.getAttribute('data-icon')).toBe('right-triangle');
    expect(folder.querySelector('.tree-item-flair')?.textContent).toBe('2');
    expect(folder.getAttribute('aria-expanded')).toBe('true');

    const modified = row(view, 'a/b.md');
    expect(modified.querySelector('.tree-item-inner')?.textContent).toBe('b');
    expect(modified.querySelector('.unc-status-m')?.textContent).toBe('M');
    expect(modified.classList.contains('is-active')).toBe(true);
    expect(modified.getAttribute('aria-selected')).toBe('true');
    expect(modified.getAttribute('aria-level')).toBe('2');
    expect(modified.dataset.tooltip).toBe('a/b.md\nModified · +2 −1');
    expect(row(view, 'conflict.md').querySelector('.unc-status-conflict')?.textContent).toBe('!');
    expect(row(view, 'renamed.md').querySelector('.unc-status-r')?.getAttribute('aria-label')).toBe('Renamed');
    expect(row(view, 'renamed.md').dataset.tooltip).toBe('old.md → renamed.md\nRenamed · +1 −0');
    expect(row(view, 'root.md').classList.contains('unc-deleted')).toBe(true);
    expect(row(view, 'root.md').classList.contains('is-active')).toBe(false);

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
    const header = view.contentEl.querySelector('.nav-header');
    const folder = row(view, 'a');
    expect(row(view, 'a/b.md')).not.toBeNull();

    folder.click();
    expect(row(view, 'a/b.md')).toBeNull();
    expect(folder.getAttribute('aria-expanded')).toBe('false');
    expect(folder.closest('.tree-item')?.classList.contains('is-collapsed')).toBe(true);
    expect(folder.querySelector('.collapse-icon')?.classList.contains('is-collapsed')).toBe(true);
    expect(folder.closest('.tree-item')?.querySelector('.tree-item-children')).toBeNull();
    expect(view.contentEl.querySelector('.nav-header')).toBe(header);
    expect(view.contentEl.querySelector('[aria-label="Expand all folders"]')).not.toBeNull();

    await vi.advanceTimersByTimeAsync(500);
    expect(setup.controller.saveCollapsedFolders).toHaveBeenCalledWith(['a']);
    folder.click();
    expect(row(view, 'a/b.md')).not.toBeNull();
    expect(folder.querySelector('.collapse-icon')?.classList.contains('is-collapsed')).toBe(false);
  });

  it('renders empty and error states, and opens settings for a missing Git binary', async () => {
    const empty = makeView({ status: 'ready', set: readySet([]) });
    view = empty.view;
    await view.onOpen();
    expect(view.contentEl.querySelector('.pane-empty')?.textContent).toBe('No changes since last commit');
    expect(view.contentEl.querySelector('.unc-summary')?.classList.contains('unc-summary-hidden')).toBe(true);
    const collapseAll = view.contentEl.querySelector('[aria-label="Collapse all folders"]')!;
    expect(collapseAll.classList.contains('is-disabled')).toBe(true);
    expect(collapseAll.getAttribute('aria-disabled')).toBe('true');
    view.unload();

    const missing = makeView({ status: 'error', kind: 'git-missing', message: 'Git was not found.' });
    view = missing.view;
    await view.onOpen();
    expect(view.contentEl.querySelector('.unc-error-message')?.textContent).toBe('Git was not found.');
    const button = view.contentEl.querySelector<HTMLButtonElement>('.pane-empty-actions .unc-settings-button')!;
    button.click();
    expect(missing.openSettings).toHaveBeenCalledTimes(1);
  });

  it('groups the file menu like core panes and explains why renames and conflicts are blocked', async () => {
    const modified = changed('note.md', 'M');
    const setup = makeView({ status: 'ready', set: readySet([modified, changed('renamed.md', 'R', { oldPath: 'old.md' }), changed('conflict.md', '!')]) });
    view = setup.view;
    await view.onOpen();

    row(view, 'note.md').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    let menu = Menu.instances.at(-1)!;
    expect(menu.items.map((item) => [item.section, item.title])).toEqual([
      ['open', 'Show changes'],
      ['action', 'Copy vault location'],
      ['danger', 'Discard all changes'],
    ]);
    expect(menu.items[2]).toMatchObject({ disabled: false, warning: true, icon: 'undo-2' });
    expect(row(view, 'note.md').classList.contains('has-active-menu')).toBe(true);
    menu.hideCallback?.();
    expect(row(view, 'note.md').classList.contains('has-active-menu')).toBe(false);
    menu.items[0]!.callback?.();
    expect(setup.open).toHaveBeenCalledWith(modified);
    menu.items[2]!.callback?.();
    expect(setup.discard).toHaveBeenCalledWith(modified);

    row(view, 'renamed.md').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    menu = Menu.instances.at(-1)!;
    expect(menu.items[2]).toMatchObject({ title: 'Discard all changes', disabled: true });
    expect(menu.items[3]).toMatchObject({ isLabel: true, title: "Discard isn't available for renames. Use Git in a terminal." });

    row(view, 'conflict.md').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    menu = Menu.instances.at(-1)!;
    expect(menu.items[3]).toMatchObject({ isLabel: true, title: 'Resolve the conflict first.' });
  });

  it('copies the vault location and toggles folders from the folder menu', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const setup = makeView({ status: 'ready', set: readySet([changed('café 🎉/b.md', 'M')]) });
    view = setup.view;
    await view.onOpen();

    row(view, 'café 🎉').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    const menu = Menu.instances.at(-1)!;
    expect(menu.items.map((item) => item.title)).toEqual(['Collapse', 'Copy vault location']);
    menu.items[1]!.callback?.();
    expect(writeText).toHaveBeenCalledWith('café 🎉');
    menu.items[0]!.callback?.();
    expect(row(view, 'café 🎉/b.md')).toBeNull();
  });

  it('re-renders from controller updates and restores a collapsed folder from settings', async () => {
    const setup = makeView(
      { status: 'ready', set: readySet([changed('a/b.md', 'M')]) },
      { settings: { ...DEFAULT_CHANGES_SETTINGS, collapsedFolders: ['a'] } },
    );
    view = setup.view;
    await view.onOpen();
    expect(row(view, 'a/b.md')).toBeNull();
    const header = view.contentEl.querySelector('.nav-header');
    const tree = view.contentEl.querySelector<HTMLElement>('.unc-tree')!;

    setup.emit({ status: 'ready', set: readySet([changed('a/b.md', 'M'), changed('root.md', 'M')], 2, 0) });
    expect(view.contentEl.querySelector('.unc-summary-count')?.textContent).toBe('2 changes');
    expect(row(view, 'root.md')).not.toBeNull();
    expect(row(view, 'a/b.md')).toBeNull();
    expect(view.contentEl.querySelector('.nav-header')).toBe(header);
    expect(view.contentEl.querySelector('.unc-tree')).toBe(tree);
  });

  it('collapses and expands every folder from the header', async () => {
    const setup = makeView({ status: 'ready', set: readySet([changed('a/b/c.md', 'M'), changed('d/e.md', 'M')]) });
    view = setup.view;
    await view.onOpen();
    const toggle = view.contentEl.querySelector<HTMLElement>('.nav-action-button[aria-label="Collapse all folders"]')!;
    toggle.click();
    expect(row(view, 'a/b')).toBeNull();
    expect(row(view, 'd/e.md')).toBeNull();
    expect(toggle.getAttribute('aria-label')).toBe('Expand all folders');
    expect(toggle.dataset.icon).toBe('chevrons-up-down');
    toggle.click();
    expect(row(view, 'a/b/c.md')).not.toBeNull();
    expect(toggle.getAttribute('aria-label')).toBe('Collapse all folders');
  });

  it('shows non-Markdown extensions as a tag', async () => {
    const setup = makeView({ status: 'ready', set: readySet([changed('café 🎉.md', 'A'), changed('photo.png', 'U', { binary: true })]) });
    view = setup.view;
    await view.onOpen();
    expect(row(view, 'café 🎉.md').querySelector('.tree-item-inner')?.textContent).toBe('café 🎉');
    expect(row(view, 'café 🎉.md').querySelector('.unc-file-tag')).toBeNull();
    expect(row(view, 'photo.png').querySelector('.tree-item-inner')?.textContent).toBe('photo');
    expect(row(view, 'photo.png').querySelector('.tree-item-flair-outer .unc-file-tag + .unc-flair')).not.toBeNull();
    expect(row(view, 'photo.png').querySelector('.unc-file-tag')?.textContent).toBe('png');
    expect(row(view, 'photo.png').dataset.tooltip).toBe('photo.png\nUntracked · binary');
  });

  it('moves a single tab stop through the tree with the arrow, Home and End keys', async () => {
    const setup = makeView({ status: 'ready', set: readySet([changed('a/b.md', 'M'), changed('a/c.md', 'A'), changed('root.md', 'M')]) });
    view = setup.view;
    await view.onOpen();
    const tabStops = (): string[] => Array.from(view!.contentEl.querySelectorAll<HTMLElement>('[tabindex="0"][data-path]')).map((el) => el.dataset.path!);
    expect(tabStops()).toEqual(['a']);

    row(view, 'a').focus();
    press('ArrowDown');
    expect(document.activeElement).toBe(row(view, 'a/b.md'));
    expect(row(view, 'a/b.md').classList.contains('has-focus')).toBe(true);
    expect(row(view, 'a').classList.contains('has-focus')).toBe(false);
    expect(tabStops()).toEqual(['a/b.md']);
    press('End');
    expect(document.activeElement).toBe(row(view, 'root.md'));
    press('ArrowUp');
    expect(document.activeElement).toBe(row(view, 'a/c.md'));
    press('Home');
    expect(document.activeElement).toBe(row(view, 'a'));
    press('ArrowUp');
    expect(document.activeElement).toBe(row(view, 'a'));
  });

  it('expands, collapses and walks folders with the left and right keys', async () => {
    const setup = makeView({ status: 'ready', set: readySet([changed('a/b/c.md', 'M')]) });
    view = setup.view;
    await view.onOpen();
    row(view, 'a/b/c.md').focus();
    press('ArrowLeft');
    expect(document.activeElement).toBe(row(view, 'a/b'));
    press('ArrowLeft');
    expect(row(view, 'a/b').getAttribute('aria-expanded')).toBe('false');
    expect(row(view, 'a/b/c.md')).toBeNull();
    expect(document.activeElement).toBe(row(view, 'a/b'));
    press('ArrowLeft');
    expect(document.activeElement).toBe(row(view, 'a'));
    press('ArrowDown');
    press('ArrowRight');
    expect(row(view, 'a/b').getAttribute('aria-expanded')).toBe('true');
    press('ArrowRight');
    expect(document.activeElement).toBe(row(view, 'a/b/c.md'));
    press('ArrowRight');
    expect(document.activeElement).toBe(row(view, 'a/b/c.md'));
  });

  it('opens files and toggles folders with Enter and Space, and opens the menu from the keyboard', async () => {
    const setup = makeView({ status: 'ready', set: readySet([changed('a/b.md', 'M'), changed('root.md', 'M')]) });
    view = setup.view;
    await view.onOpen();
    row(view, 'root.md').focus();
    press('Enter');
    expect(setup.open).toHaveBeenCalledWith(expect.objectContaining({ path: 'root.md' }));
    row(view, 'a').focus();
    press(' ');
    expect(row(view, 'a/b.md')).toBeNull();
    row(view, 'root.md').focus();
    press('F10', { shiftKey: true });
    expect(Menu.instances).toHaveLength(1);
    press('ContextMenu');
    expect(Menu.instances).toHaveLength(2);
  });

  it('keeps keyboard focus across refreshes and falls back when the focused file disappears', async () => {
    const setup = makeView({ status: 'ready', set: readySet([changed('a.md', 'M'), changed('b.md', 'M'), changed('c.md', 'M')]) }, { activePath: 'c.md' });
    view = setup.view;
    await view.onOpen();
    expect(row(view, 'c.md').getAttribute('tabindex')).toBe('0');
    row(view, 'b.md').focus();

    setup.emit({ status: 'ready', set: readySet([changed('a.md', 'M'), changed('b.md', 'M'), changed('c.md', 'M'), changed('d.md', 'A')]) });
    expect(document.activeElement).toBe(row(view, 'b.md'));
    expect(row(view, 'b.md').getAttribute('tabindex')).toBe('0');

    setup.emit({ status: 'ready', set: readySet([changed('a.md', 'M'), changed('c.md', 'M')]) });
    expect(document.activeElement).toBe(row(view, 'c.md'));
    expect(row(view, 'c.md').getAttribute('tabindex')).toBe('0');
    expect(row(view, 'a.md').getAttribute('tabindex')).toBe('-1');
  });
});

describe('display names', () => {
  it.each([
    ['café 🎉.md', 'café 🎉', ''],
    ['notes/notes.v2.md', 'notes.v2', ''],
    ['README.MD', 'README', ''],
    ['.md', '.md', ''],
    ['.obsidian/app.json', 'app', 'json'],
    ['Makefile', 'Makefile', ''],
    ['photo.PNG', 'photo', 'png'],
    ['archive.tar.gz', 'archive.tar', 'gz'],
    ['trailing.', 'trailing.', ''],
  ])('%s shows as %s with tag "%s"', (path, name, tag) => {
    expect(displayName(path)).toBe(name);
    expect(extensionTag(path)).toBe(tag);
  });
});
