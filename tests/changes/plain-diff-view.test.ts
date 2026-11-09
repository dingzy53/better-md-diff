// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, WorkspaceLeaf } from 'obsidian';
import type { ChangesController } from '../../src/changes/controller';
import { PlainDiffView } from '../../src/changes/plain-diff-view';
import type { ChangeSet, ChangedFile, ChangesState } from '../../src/changes/types';
import { DEFAULT_SETTINGS } from '../../src/options';
import { installObsidianDom } from '../helpers/obsidian-dom';

installObsidianDom(document);

function changed(path: string, status: ChangedFile['status'], extra: Partial<ChangedFile> = {}): ChangedFile {
  return { path, status, binary: false, added: 1, deleted: 1, ...extra };
}
function readySet(files: ChangedFile[]): ChangeSet {
  return { files, added: 1, deleted: 1, head: 'abc', updatedAt: 1 };
}

function makeView(file: ChangedFile, options: {
  head?: Buffer | null;
  content?: string;
  size?: number;
  missing?: boolean;
  state?: ChangesState;
} = {}) {
  const state: ChangesState = options.state ?? { status: 'ready', set: readySet([file]) };
  const controller = {
    getState: () => state,
    subscribe: () => () => {},
    headBlob: async () => options.head ?? null,
  } as unknown as ChangesController;
  const target = options.missing ? null : { path: file.path, stat: { size: options.size ?? Buffer.byteLength(options.content ?? '') } };
  const app = {
    vault: { getFileByPath: () => target, cachedRead: async () => options.content ?? '' },
  } as unknown as App;
  const settings = { ...DEFAULT_SETTINGS };
  const view = new PlainDiffView({} as WorkspaceLeaf, { controller, app, settings: () => settings });
  document.body.append(view.contentEl);
  return { view, settings };
}

let view: PlainDiffView | undefined;
afterEach(() => { view?.unload(); view = undefined; document.body.replaceChildren(); });

describe('plain diff view', () => {
  it('renders a unified text diff with the header and counts', async () => {
    const file = changed('notes/a.md', 'M', { added: 1, deleted: 1 });
    const setup = makeView(file, { head: Buffer.from('one\ntwo\n'), content: 'one\nchanged\n' });
    view = setup.view;
    await view.onOpen();
    await view.setPath('notes/a.md');

    expect(view.contentEl.querySelector('.unc-plain-name')?.textContent).toBe('a.md');
    expect(view.contentEl.querySelector('.unc-plain-folder')?.textContent).toBe('notes');
    expect(view.contentEl.querySelector('.unc-plain-counts')?.textContent).toBe('+1 −1');
    expect(view.contentEl.querySelector('.unc-badge-m')?.textContent).toBe('M');
    expect(view.contentEl.querySelectorAll('.unc-diff-deleted')).toHaveLength(1);
    expect(view.contentEl.querySelectorAll('.unc-diff-added')).toHaveLength(1);
    expect(view.contentEl.querySelector('.unc-diff-deleted .unc-diff-text')?.textContent).toBe('two');
    expect(view.contentEl.querySelector('.unc-diff-added .unc-diff-text')?.textContent).toBe('changed');
    expect(view.getState().path).toBe('notes/a.md');
  });

  it('renders every line as deleted for a removed file', async () => {
    const file = changed('gone.md', 'D', { added: 0, deleted: 2 });
    const setup = makeView(file, { head: Buffer.from('one\ntwo\n'), missing: true });
    view = setup.view;
    await view.onOpen();
    await view.setPath('gone.md');
    expect(view.contentEl.querySelectorAll('.unc-diff-deleted')).toHaveLength(2);
    expect(view.contentEl.querySelectorAll('.unc-diff-added')).toHaveLength(0);
  });

  it('reports binary files with both sizes', async () => {
    const file = changed('image.png', 'M', { binary: true, added: 0, deleted: 0 });
    const setup = makeView(file, { head: Buffer.from([0, 1, 2]), size: 6 });
    view = setup.view;
    await view.onOpen();
    await view.setPath('image.png');
    expect(view.contentEl.querySelector('.unc-plain-notice')?.textContent).toBe('Binary file changed');
    expect(view.contentEl.querySelector('.unc-plain-sizes')?.textContent).toBe('HEAD 3 B → current 6 B');
  });

  it('reports a deleted binary file and an added binary file', async () => {
    const deleted = changed('image.png', 'D', { binary: true, added: 0, deleted: 0 });
    const deletedSetup = makeView(deleted, { head: Buffer.from([1, 2, 3, 4]), missing: true });
    view = deletedSetup.view;
    await view.onOpen();
    await view.setPath('image.png');
    expect(view.contentEl.querySelector('.unc-plain-notice')?.textContent).toBe('Binary file deleted');
    expect(view.contentEl.querySelector('.unc-plain-sizes')?.textContent).toBe('HEAD 4 B');
    view.unload();

    const added = changed('new.png', 'U', { binary: true, added: 0, deleted: 0 });
    const addedSetup = makeView(added, { head: null, size: 5 });
    view = addedSetup.view;
    await view.onOpen();
    await view.setPath('new.png');
    expect(view.contentEl.querySelector('.unc-plain-notice')?.textContent).toBe('Binary file added');
    expect(view.contentEl.querySelector('.unc-plain-sizes')?.textContent).toBe('Current 5 B');
  });

  it('shows a size notice instead of computing an oversized diff', async () => {
    const file = changed('big.txt', 'M');
    const setup = makeView(file, { head: null, content: 'small', size: 2 * 1024 * 1024 });
    setup.settings.maxFileMiB = 1;
    view = setup.view;
    await view.onOpen();
    await view.setPath('big.txt');
    expect(view.contentEl.querySelector('.unc-plain-notice')?.textContent).toBe('File is too large to diff');
    expect(view.contentEl.querySelector('.unc-plain-sizes')?.textContent).toBe('HEAD 0 B → current 2.0 MiB');
  });

  it('shows that a file is no longer changed', async () => {
    const file = changed('note.md', 'M');
    const setup = makeView(file, { state: { status: 'ready', set: readySet([]) } });
    view = setup.view;
    await view.onOpen();
    await view.setPath('note.md');
    expect(view.contentEl.querySelector('.unc-empty')?.textContent).toBe('No longer changed');
  });

  it('asks for a file when no state path is present', async () => {
    const file = changed('note.md', 'M');
    const setup = makeView(file);
    view = setup.view;
    await view.onOpen();
    expect(view.contentEl.querySelector('.unc-state')?.textContent).toBe('No file selected');
    await view.setState({ path: 'note.md' }, {} as never);
    expect(view.contentEl.querySelector('.unc-plain-name')?.textContent).toBe('note.md');
  });
});
