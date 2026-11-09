import { MarkdownView, Modal, Notice, TFolder, normalizePath, type App, type TFile } from 'obsidian';
import type { ChangedFile } from './types';

export interface DiscardDeps {
  app: App;
  headBlob(path: string): Promise<Buffer | null>;
  refresh(): void;
}

export interface Snapshot {
  head: Buffer | null;
  /** Text content at the moment the dialog opened (open editor buffer or disk). */
  text?: string;
  /** Size and mtime for binary files, and for files that are removed rather than rewritten. */
  stat?: { size: number; mtime: number };
}

const STALE = 'The file changed since the dialog opened. Nothing was discarded.';
const NO_HEAD = 'This file has no committed version to restore.';
const UNINDEXED = 'This file is not indexed by Obsidian. Use Git in a terminal for this file.';

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function sameHead(left: Buffer | null, right: Buffer | null): boolean {
  if (left === null || right === null) return left === right;
  return left.equals(right);
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function openView(app: App, path: string): MarkdownView | undefined {
  const views = app.workspace.getLeavesOfType('markdown')
    .map((leaf) => leaf.view)
    .filter((view): view is MarkdownView => view instanceof MarkdownView && view.file?.path === path);
  return views.find((view) => view.containerEl.isShown()) ?? views[0];
}

function checkStat(snapshot: Snapshot, file: TFile): void {
  if (!snapshot.stat || snapshot.stat.size !== file.stat.size || snapshot.stat.mtime !== file.stat.mtime) throw new Error(STALE);
}

async function ensureParentFolders(app: App, path: string): Promise<void> {
  const slash = path.lastIndexOf('/');
  if (slash < 0) return;
  const parts = normalizePath(path.slice(0, slash)).split('/');
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(current);
    if (!existing) await app.vault.createFolder(current);
    else if (!(existing instanceof TFolder)) throw new Error('A file blocks the folder needed to restore this file.');
  }
}

async function capture(app: App, file: ChangedFile, head: Buffer | null): Promise<Snapshot> {
  if (file.status === 'D') {
    if (app.vault.getFileByPath(file.path)) throw new Error(STALE);
    return { head };
  }
  const target = app.vault.getFileByPath(file.path);
  if (!target) throw new Error(UNINDEXED);
  if (file.binary) return { head, stat: { size: target.stat.size, mtime: target.stat.mtime } };
  if (file.status === 'A' || file.status === 'U') return { head, stat: { size: target.stat.size, mtime: target.stat.mtime } };
  const view = openView(app, file.path);
  return { head, text: view ? view.getViewData() : await app.vault.read(target) };
}

function effectText(file: ChangedFile): string {
  if (file.status === 'D') return 'The file will be recreated from the last commit.';
  if (file.status === 'A' || file.status === 'U') return 'The file will be moved to trash.';
  return 'The file returns to its content in the last commit.';
}

/**
 * Restore or remove one working-tree file. The Git index is never touched.
 * Re-reads HEAD and the file first, so a change made while the dialog was
 * open aborts instead of overwriting newer work.
 */
export async function performDiscard(file: ChangedFile, snapshot: Snapshot, deps: DiscardDeps): Promise<void> {
  const { app } = deps;
  const head = await deps.headBlob(file.path);
  if (!sameHead(snapshot.head, head)) throw new Error(STALE);

  if (file.status === 'M') {
    const target = app.vault.getFileByPath(file.path);
    if (!target) throw new Error(STALE);
    if (file.binary) {
      if (!head) throw new Error(NO_HEAD);
      checkStat(snapshot, target);
      await app.vault.modifyBinary(target, toArrayBuffer(head));
      return;
    }
    const view = openView(app, file.path);
    const current = view ? view.getViewData() : await app.vault.read(target);
    if (snapshot.text === undefined || current !== snapshot.text) throw new Error(STALE);
    if (!head) throw new Error(NO_HEAD);
    const text = head.toString('utf8');
    if (view) {
      const editor = view.editor;
      const from = { line: 0, ch: 0 };
      editor.transaction({
        changes: [{ from, to: editor.offsetToPos(editor.getValue().length), text }],
        selection: { from },
      });
    } else {
      await app.vault.process(target, () => text);
    }
    return;
  }

  if (file.status === 'D') {
    if (app.vault.getFileByPath(file.path)) throw new Error(STALE);
    if (!head) throw new Error(NO_HEAD);
    await ensureParentFolders(app, file.path);
    if (file.binary) await app.vault.createBinary(file.path, toArrayBuffer(head));
    else await app.vault.create(file.path, head.toString('utf8'));
    return;
  }

  if (file.status === 'A' || file.status === 'U') {
    const target = app.vault.getFileByPath(file.path);
    if (!target) throw new Error(UNINDEXED);
    checkStat(snapshot, target);
    await app.fileManager.trashFile(target);
    return;
  }

  throw new Error("Discard isn't available for this file.");
}

/** Modal shown before any working-tree write; cancel is the default action. */
export class DiscardModal extends Modal {
  private snapshot?: Snapshot;
  private busy = false;
  private confirmButton?: HTMLButtonElement;
  private errorEl?: HTMLElement;

  constructor(app: App, private readonly file: ChangedFile, private readonly deps: DiscardDeps) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText('Discard all changes?');
    this.contentEl.empty();
    this.contentEl.addClass('unc-discard-modal');
    this.contentEl.createDiv({ cls: 'unc-discard-target', text: fileName(this.file.path) });
    this.contentEl.createDiv({ cls: 'unc-discard-effect', text: effectText(this.file) });
    if (this.file.staged) this.contentEl.createDiv({ cls: 'unc-discard-note', text: 'Staged changes stay staged.' });
    this.errorEl = this.contentEl.createDiv({ cls: 'unc-error-message' });

    const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const cancel = buttons.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    this.confirmButton = buttons.createEl('button', { cls: 'mod-warning', text: 'Discard' });
    this.confirmButton.disabled = true;
    this.confirmButton.addEventListener('click', () => { void this.confirm(); });
    cancel.focus();

    void this.prepare();
  }

  private async prepare(): Promise<void> {
    try {
      const head = await this.deps.headBlob(this.file.path);
      this.snapshot = await capture(this.deps.app, this.file, head);
      if (this.confirmButton) this.confirmButton.disabled = false;
    } catch (error) {
      this.showError(error);
    }
  }

  private showError(error: unknown): void {
    this.errorEl?.setText(error instanceof Error ? error.message : 'Unable to discard changes.');
  }

  private async confirm(): Promise<void> {
    if (!this.snapshot || this.busy) return;
    this.busy = true;
    if (this.confirmButton) this.confirmButton.disabled = true;
    try {
      await performDiscard(this.file, this.snapshot, this.deps);
      this.close();
      new Notice(`Discarded changes in ${fileName(this.file.path)}`);
      this.deps.refresh();
    } catch (error) {
      this.showError(error);
      this.busy = false;
      if (this.confirmButton) this.confirmButton.disabled = false;
    }
  }
}
