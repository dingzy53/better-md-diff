import { ItemView, type App, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { computeDiff } from '../diff';
import type { DiffSettings } from '../options';
import type { ChangesController } from './controller';
import type { ChangedFile, ChangeStatus } from './types';

export const PLAIN_DIFF_VIEW = 'uncommitted-plain-diff-view';
export const PLAIN_DIFF_ICON = 'file-text';

export interface PlainDiffViewHost {
  controller: ChangesController;
  app: App;
  settings(): DiffSettings;
}

const BADGE_LABEL: Record<ChangeStatus, string> = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
  U: 'Untracked',
  '!': 'Conflict',
};

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function folderName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? 'Vault root' : path.slice(0, slash);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** Simple unified diff for non-Markdown, deleted, and binary files. */
export class PlainDiffView extends ItemView {
  private path?: string;
  private revision = 0;

  constructor(leaf: WorkspaceLeaf, private readonly host: PlainDiffViewHost) {
    super(leaf);
  }

  getViewType(): string {
    return PLAIN_DIFF_VIEW;
  }

  getDisplayText(): string {
    return 'File diff';
  }

  getIcon(): string {
    return PLAIN_DIFF_ICON;
  }

  getState(): Record<string, unknown> {
    return { ...super.getState(), path: this.path };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    const path = state && typeof state === 'object' ? (state as { path?: unknown }).path : undefined;
    this.path = typeof path === 'string' ? path : undefined;
    await this.render();
  }

  async setPath(path: string | undefined): Promise<void> {
    this.path = path;
    await this.render();
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('unc-plain-diff');
    this.register(this.host.controller.subscribe(() => { void this.render(); }));
    await this.render();
  }

  private renderHeader(path: string, file: ChangedFile | undefined): void {
    const header = this.contentEl.createDiv({ cls: 'unc-plain-header' });
    const title = header.createDiv({ cls: 'unc-plain-title' });
    if (file) {
      const badge = title.createSpan({ cls: `unc-badge unc-badge-${file.status === '!' ? 'conflict' : file.status.toLowerCase()}`, text: file.status });
      badge.setAttribute('aria-label', BADGE_LABEL[file.status]);
    }
    title.createSpan({ cls: 'unc-plain-name', text: fileName(path) });
    if (file) title.createSpan({ cls: 'unc-plain-counts', text: `+${file.added} −${file.deleted}` });
    header.createDiv({ cls: 'unc-plain-folder', text: folderName(path) });
  }

  private render(): Promise<void> {
    const revision = ++this.revision;
    return this.renderContent(revision);
  }

  private async renderContent(revision: number): Promise<void> {
    const path = this.path;
    const state = this.host.controller.getState();
    this.contentEl.empty();
    this.contentEl.addClass('unc-plain-diff');
    if (!path) {
      this.contentEl.createDiv({ cls: 'pane-empty unc-state', text: 'No file selected' });
      return;
    }
    const file = state.status === 'ready' ? state.set.files.find((candidate) => candidate.path === path) : undefined;
    this.renderHeader(path, file);
    const body = this.contentEl.createDiv({ cls: 'unc-plain-body' });

    if (state.status === 'loading') {
      body.createDiv({ cls: 'pane-empty unc-state', text: 'Loading changes…' });
      return;
    }
    if (state.status === 'error') {
      body.createDiv({ cls: 'pane-empty unc-state unc-error-message', text: state.message });
      return;
    }
    if (!file) {
      body.createDiv({ cls: 'pane-empty unc-state unc-empty', text: 'No longer changed' });
      return;
    }
    try {
      if (file.binary) await this.renderBinary(file, body, revision);
      else await this.renderText(file, body, revision);
    } catch (error) {
      if (revision !== this.revision) return;
      body.createDiv({ cls: 'pane-empty unc-state unc-error-message', text: error instanceof Error ? error.message : 'Unable to read this file.' });
    }
  }

  private async renderBinary(file: ChangedFile, body: HTMLElement, revision: number): Promise<void> {
    const head = await this.host.controller.headBlob(file.path);
    if (revision !== this.revision) return;
    const target = this.host.app.vault.getFileByPath(file.path);
    const headSize = head?.length ?? 0;
    const currentSize = target?.stat.size ?? 0;
    const added = file.status === 'A' || file.status === 'U' || head === null;
    const deleted = file.status === 'D';
    body.createDiv({ cls: 'unc-plain-notice', text: deleted ? 'Binary file deleted' : added ? 'Binary file added' : 'Binary file changed' });
    const sizes = deleted ? `HEAD ${formatBytes(headSize)}`
      : added ? `Current ${formatBytes(currentSize)}`
        : `HEAD ${formatBytes(headSize)} → current ${formatBytes(currentSize)}`;
    body.createDiv({ cls: 'unc-plain-sizes', text: sizes });
  }

  private async renderText(file: ChangedFile, body: HTMLElement, revision: number): Promise<void> {
    const limits = this.host.settings();
    const head = await this.host.controller.headBlob(file.path);
    if (revision !== this.revision) return;
    const target = this.host.app.vault.getFileByPath(file.path);
    const headSize = head?.length ?? 0;
    const currentSize = target?.stat.size ?? 0;
    const maxBytes = limits.maxFileMiB * 1024 * 1024;
    if (headSize > maxBytes || currentSize > maxBytes) {
      this.renderTooLarge(body, headSize, currentSize);
      return;
    }
    const before = head?.toString('utf8') ?? '';
    let after = '';
    if (target) {
      try {
        after = await this.host.app.vault.cachedRead(target);
      } catch {
        if (revision !== this.revision) return;
        body.createDiv({ cls: 'pane-empty unc-state unc-error-message', text: 'Unable to read the current file.' });
        return;
      }
      if (revision !== this.revision) return;
    }

    let diff;
    try {
      diff = computeDiff(before, after, limits.contextLines, limits);
    } catch (error) {
      if (revision !== this.revision) return;
      this.renderTooLarge(body, headSize, currentSize, error instanceof Error ? error.message : undefined);
      return;
    }

    const rows = body.createDiv({ cls: 'unc-diff-rows' });
    diff.hunks.forEach((hunk, index) => {
      if (index) rows.createDiv({ cls: 'unc-diff-separator', text: '⋯' });
      for (const row of hunk.rows) {
        const line = rows.createDiv({ cls: `unc-diff-row unc-diff-${row.kind}` });
        line.createSpan({ cls: 'unc-diff-line-number', text: row.oldLine === null ? '' : String(row.oldLine) });
        line.createSpan({ cls: 'unc-diff-line-number', text: row.newLine === null ? '' : String(row.newLine) });
        line.createSpan({ cls: 'unc-diff-sign', text: row.kind === 'added' ? '+' : row.kind === 'deleted' ? '−' : ' ' });
        line.createSpan({ cls: 'unc-diff-text', text: row.text || '\u00a0' });
      }
    });
  }

  private renderTooLarge(body: HTMLElement, headSize: number, currentSize: number, message?: string): void {
    body.createDiv({ cls: 'unc-plain-notice', text: 'File is too large to diff' });
    body.createDiv({ cls: 'unc-plain-sizes', text: `HEAD ${formatBytes(headSize)} → current ${formatBytes(currentSize)}` });
    if (message) body.createDiv({ cls: 'pane-empty unc-state unc-error-message', text: message });
  }
}
