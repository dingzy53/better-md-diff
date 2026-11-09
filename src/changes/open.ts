import { MarkdownView, type App, type TFile } from 'obsidian';
import type { ChangedFile } from './types';

/** Extensions Obsidian can display in a normal tab. */
export const DISPLAYABLE_EXTENSIONS = new Set([
  'canvas', 'base', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif',
  'mp3', 'wav', 'm4a', 'ogg', 'flac', 'webm', 'mp4', 'mov', 'mkv',
]);

export interface OpenChangedFileHost {
  app: App;
  openDiff(path: string): Promise<void>;
  openPlainDiff(path: string): Promise<void>;
}

function extension(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.slice(dot + 1).toLowerCase();
}

async function revealOrOpenMarkdown(app: App, file: TFile): Promise<void> {
  const existing = app.workspace.getLeavesOfType('markdown').find((leaf) =>
    leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);
  if (existing) {
    await app.workspace.revealLeaf(existing);
    return;
  }
  await app.workspace.getLeaf(false).openFile(file);
}

/**
 * Click routing: Markdown opens the note and the upstream Better MD Diff panel,
 * displayable files open a tab plus the plain diff, and everything else
 * (deleted files, JSON, CSS, …) only opens the plain diff.
 */
export async function openChangedFile(file: ChangedFile, host: OpenChangedFileHost): Promise<void> {
  const target = file.status === 'D' ? null : host.app.vault.getFileByPath(file.path);
  if (target && extension(file.path) === 'md') {
    await revealOrOpenMarkdown(host.app, target);
    await host.openDiff(file.path);
    return;
  }
  if (target && DISPLAYABLE_EXTENSIONS.has(extension(file.path))) {
    await host.app.workspace.getLeaf(false).openFile(target);
  }
  await host.openPlainDiff(file.path);
}
