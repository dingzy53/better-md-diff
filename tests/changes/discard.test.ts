// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import { MarkdownView, TFolder } from '../helpers/obsidian';
import { DiscardModal, performDiscard, type Snapshot } from '../../src/changes/discard';
import type { ChangedFile } from '../../src/changes/types';
import { installObsidianDom } from '../helpers/obsidian-dom';

installObsidianDom(document);

function changed(path: string, status: ChangedFile['status'], extra: Partial<ChangedFile> = {}): ChangedFile {
  return { path, status, binary: false, added: 1, deleted: 1, staged: false, ...extra };
}

class FakeVault {
  files = new Map<string, { data: Buffer; mtime: number }>();
  folders = new Set<string>();
  trashed: string[] = [];
  private clock = 10;

  add(path: string, content: string | Buffer): void {
    this.files.set(path, { data: Buffer.from(content), mtime: ++this.clock });
  }
  getFileByPath(path: string): TFile | null {
    const entry = this.files.get(path);
    if (!entry) return null;
    return { path, stat: { size: entry.data.length, mtime: entry.mtime }, extension: path.split('.').pop() } as unknown as TFile;
  }
  getAbstractFileByPath(path: string): unknown {
    const file = this.getFileByPath(path);
    if (file) return file;
    if (this.folders.has(path)) return new TFolder(path);
    return null;
  }
  async read(file: TFile): Promise<string> { return this.entry(file.path).data.toString('utf8'); }
  async process(file: TFile, update: (data: string) => string): Promise<string> {
    const next = update(this.entry(file.path).data.toString('utf8'));
    this.write(file.path, Buffer.from(next));
    return next;
  }
  async modifyBinary(file: TFile, data: ArrayBuffer): Promise<void> { this.write(file.path, Buffer.from(data)); }
  async readBinary(file: TFile): Promise<ArrayBuffer> {
    const data = this.entry(file.path).data;
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  }
  async create(path: string, text: string): Promise<TFile> {
    if (this.files.has(path)) throw new Error('File already exists.');
    this.write(path, Buffer.from(text));
    return this.getFileByPath(path)!;
  }
  async createBinary(path: string, data: ArrayBuffer): Promise<TFile> {
    this.write(path, Buffer.from(data));
    return this.getFileByPath(path)!;
  }
  async createFolder(path: string): Promise<TFolder> {
    this.folders.add(path);
    return new TFolder(path);
  }
  statOf(path: string): { size: number; mtime: number } {
    const file = this.getFileByPath(path)!;
    return { size: file.stat.size, mtime: file.stat.mtime };
  }
  private entry(path: string): { data: Buffer; mtime: number } {
    const entry = this.files.get(path);
    if (!entry) throw new Error(`Missing file: ${path}`);
    return entry;
  }
  private write(path: string, data: Buffer): void {
    this.files.set(path, { data, mtime: ++this.clock });
  }
}

function makeApp(vault: FakeVault, views: { view: MarkdownView }[] = []): App {
  return {
    vault,
    fileManager: {
      trashFile: async (file: TFile) => {
        vault.files.delete(file.path);
        vault.trashed.push(file.path);
      },
    },
    workspace: { getLeavesOfType: () => views },
  } as unknown as App;
}

function deps(app: App, head: Buffer | null, refresh = vi.fn()) {
  return { app, headBlob: async () => head, refresh };
}

function openEditor(vault: FakeVault, path: string, content: string) {
  const view = new MarkdownView();
  view.file = { path };
  let text = content;
  const editor = {
    getValue: () => text,
    offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
    transaction: vi.fn((transaction: { changes: { text: string }[] }) => { text = transaction.changes[0]!.text; }),
  };
  Object.assign(view, { containerEl: { isShown: () => true }, getViewData: () => text, editor });
  return { leaf: { view }, editor, text: () => text };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 10; index++) await Promise.resolve();
}

let modal: DiscardModal | undefined;
afterEach(() => { modal?.close(); modal = undefined; document.body.replaceChildren(); });

describe('discard effects', () => {
  it('restores a closed text file to HEAD through Vault.process', async () => {
    const vault = new FakeVault();
    vault.add('note.md', 'working\n');
    const head = Buffer.from('HEAD\n');
    const app = makeApp(vault);
    await performDiscard(changed('note.md', 'M'), { head, text: 'working\n' }, deps(app, head));
    expect(await vault.read(vault.getFileByPath('note.md')!)).toBe('HEAD\n');
  });

  it('replaces an open note through one editor transaction', async () => {
    const vault = new FakeVault();
    vault.add('note.md', 'working\n');
    const head = Buffer.from('HEAD\n');
    const open = openEditor(vault, 'note.md', 'working\n');
    const app = makeApp(vault, [open.leaf]);
    await performDiscard(changed('note.md', 'M'), { head, text: 'working\n' }, deps(app, head));
    expect(open.editor.transaction).toHaveBeenCalledTimes(1);
    expect(open.editor.transaction.mock.calls[0]![0].changes).toHaveLength(1);
    expect(open.editor.transaction.mock.calls[0]![0].changes[0]!.text).toBe('HEAD\n');
    expect(open.text()).toBe('HEAD\n');
  });

  it('restores a binary file byte for byte', async () => {
    const vault = new FakeVault();
    vault.add('image.bin', Buffer.from([9, 9, 9]));
    const head = Buffer.from([1, 2, 3]);
    const app = makeApp(vault);
    await performDiscard(changed('image.bin', 'M', { binary: true }), { head, stat: vault.statOf('image.bin') }, deps(app, head));
    expect([...vault.files.get('image.bin')!.data]).toEqual([1, 2, 3]);
  });

  it('recreates a deleted file and its missing parent folders', async () => {
    const vault = new FakeVault();
    const head = Buffer.from('restored\n');
    const app = makeApp(vault);
    await performDiscard(changed('a/b/note.md', 'D'), { head }, deps(app, head));
    expect([...vault.folders]).toEqual(['a', 'a/b']);
    expect(await vault.read(vault.getFileByPath('a/b/note.md')!)).toBe('restored\n');
  });

  it.each(['U', 'A'] as const)('moves %s files to trash', async (status) => {
    const vault = new FakeVault();
    vault.add('new.md', 'new\n');
    const head = status === 'A' ? null : null;
    const app = makeApp(vault);
    await performDiscard(changed('new.md', status), { head, stat: vault.statOf('new.md') }, deps(app, head));
    expect(vault.trashed).toEqual(['new.md']);
    expect(vault.getFileByPath('new.md')).toBeNull();
  });

  it('refuses renames and conflicts', async () => {
    const vault = new FakeVault();
    const app = makeApp(vault);
    for (const status of ['R', '!'] as const) {
      await expect(performDiscard(changed('note.md', status), { head: null }, deps(app, null)))
        .rejects.toThrow("Discard isn't available for this file.");
    }
  });
});

describe('discard freshness', () => {
  it('aborts when HEAD changed since the dialog opened', async () => {
    const vault = new FakeVault();
    vault.add('note.md', 'working\n');
    const app = makeApp(vault);
    await expect(performDiscard(changed('note.md', 'M'), { head: Buffer.from('old\n'), text: 'working\n' }, deps(app, Buffer.from('new\n'))))
      .rejects.toThrow('The file changed since the dialog opened. Nothing was discarded.');
    expect(await vault.read(vault.getFileByPath('note.md')!)).toBe('working\n');
  });

  it('aborts when the working file changed since the dialog opened', async () => {
    const vault = new FakeVault();
    vault.add('note.md', 'changed meanwhile\n');
    const head = Buffer.from('HEAD\n');
    const app = makeApp(vault);
    await expect(performDiscard(changed('note.md', 'M'), { head, text: 'working\n' }, deps(app, head)))
      .rejects.toThrow('The file changed since the dialog opened. Nothing was discarded.');
  });

  it('aborts when an untracked file changed before trashing', async () => {
    const vault = new FakeVault();
    vault.add('new.md', 'one\n');
    const stat = vault.statOf('new.md');
    vault.add('new.md', 'two\n');
    const app = makeApp(vault);
    await expect(performDiscard(changed('new.md', 'U'), { head: null, stat }, deps(app, null)))
      .rejects.toThrow('The file changed since the dialog opened. Nothing was discarded.');
    expect(vault.trashed).toEqual([]);
  });
});

describe('discard modal', () => {
  it('starts with cancel focused and discard enabled only after preparation', async () => {
    const vault = new FakeVault();
    vault.add('note.md', 'working\n');
    const head = Buffer.from('HEAD\n');
    const app = makeApp(vault);
    modal = new DiscardModal(app, changed('note.md', 'M'), deps(app, head));
    modal.open();
    expect(modal.titleEl.textContent).toBe('Discard all changes?');
    expect(modal.contentEl.querySelector('.unc-discard-target')?.textContent).toBe('note.md');
    expect(modal.contentEl.querySelector('.unc-discard-effect')?.textContent).toBe('The file returns to its content in the last commit.');
    const discard = modal.contentEl.querySelector<HTMLButtonElement>('.mod-warning')!;
    expect(discard.disabled).toBe(true);
    expect(document.activeElement).toBe(modal.contentEl.querySelector('button'));
    await flush();
    expect(discard.disabled).toBe(false);
  });

  it('shows the staged note and discards on confirmation', async () => {
    const vault = new FakeVault();
    vault.add('note.md', 'working\n');
    const head = Buffer.from('HEAD\n');
    const app = makeApp(vault);
    const refresh = vi.fn();
    modal = new DiscardModal(app, changed('note.md', 'M', { staged: true }), deps(app, head, refresh));
    modal.open();
    expect(modal.contentEl.querySelector('.unc-discard-note')?.textContent).toBe('Staged changes stay staged.');
    await flush();
    modal.contentEl.querySelector<HTMLButtonElement>('.mod-warning')!.click();
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vault.files.get('note.md')!.data.toString('utf8')).toBe('HEAD\n');
  });

  it('keeps the dialog open with an explanation when the file changed', async () => {
    const vault = new FakeVault();
    vault.add('note.md', 'working\n');
    let head = Buffer.from('HEAD\n');
    const app = makeApp(vault);
    const refresh = vi.fn();
    modal = new DiscardModal(app, changed('note.md', 'M'), { app, headBlob: async () => head, refresh });
    modal.open();
    await flush();
    head = Buffer.from('OTHER\n');
    modal.contentEl.querySelector<HTMLButtonElement>('.mod-warning')!.click();
    await flush();
    expect(modal.contentEl.querySelector('.unc-error-message')?.textContent).toBe('The file changed since the dialog opened. Nothing was discarded.');
    expect(refresh).not.toHaveBeenCalled();
    expect(await vault.read(vault.getFileByPath('note.md')!)).toBe('working\n');
  });

  it('explains when a file is not indexed by Obsidian', async () => {
    const vault = new FakeVault();
    const app = makeApp(vault);
    modal = new DiscardModal(app, changed('hidden/note.md', 'M'), deps(app, Buffer.from('HEAD\n')));
    modal.open();
    await flush();
    expect(modal.contentEl.querySelector('.unc-error-message')?.textContent).toBe('This file is not indexed by Obsidian. Use Git in a terminal for this file.');
    expect(modal.contentEl.querySelector<HTMLButtonElement>('.mod-warning')!.disabled).toBe(true);
  });
});
