import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { MarkdownView } from '../helpers/obsidian';
import { openChangedFile } from '../../src/changes/open';
import type { ChangedFile } from '../../src/changes/types';

function changed(path: string, status: ChangedFile['status'] = 'M'): ChangedFile {
  return { path, status, binary: false, added: 1, deleted: 0 };
}

function makeHost(files: Record<string, { path: string }>, existingMarkdown: string[] = []) {
  const opened: string[] = [];
  const revealed: string[] = [];
  const leaves = existingMarkdown.map((path) => {
    const view = new MarkdownView();
    view.file = { path };
    return { view };
  });
  const workspace = {
    getLeavesOfType: (type: string) => type === 'markdown' ? leaves : [],
    revealLeaf: async (leaf: { view: MarkdownView }) => { revealed.push(leaf.view.file!.path); },
    getLeaf: () => ({ openFile: async (file: { path: string }) => { opened.push(file.path); } }),
  };
  const vault = { getFileByPath: (path: string) => files[path] ?? null };
  const app = { vault, workspace } as unknown as App;
  const openDiff = vi.fn(async () => {});
  const openPlainDiff = vi.fn(async () => {});
  return { host: { app, openDiff, openPlainDiff }, opened, revealed, openDiff, openPlainDiff };
}

describe('click routing', () => {
  it('reveals an open Markdown note and opens the upstream diff panel', async () => {
    const { host, opened, revealed, openDiff } = makeHost({ 'note.md': { path: 'note.md' } }, ['note.md']);
    await openChangedFile(changed('note.md'), host);
    expect(revealed).toEqual(['note.md']);
    expect(opened).toEqual([]);
    expect(openDiff).toHaveBeenCalledWith('note.md');
    expect(host.openPlainDiff).not.toHaveBeenCalled();
  });

  it('opens a Markdown note in the current tab when it is not open yet', async () => {
    const { host, opened, openDiff } = makeHost({ 'note.md': { path: 'note.md' } });
    await openChangedFile(changed('note.md', 'U'), host);
    expect(opened).toEqual(['note.md']);
    expect(openDiff).toHaveBeenCalledWith('note.md');
  });

  it('opens a displayable canvas and the plain diff', async () => {
    const { host, opened, openDiff } = makeHost({ 'board.canvas': { path: 'board.canvas' } });
    await openChangedFile(changed('board.canvas'), host);
    expect(opened).toEqual(['board.canvas']);
    expect(openDiff).not.toHaveBeenCalled();
    expect(host.openPlainDiff).toHaveBeenCalledWith('board.canvas');
  });

  it.each(['data.json', 'style.css', 'notes.txt'])('shows only the plain diff for %s', async (path) => {
    const { host, opened, openDiff } = makeHost({ [path]: { path } });
    await openChangedFile(changed(path), host);
    expect(opened).toEqual([]);
    expect(openDiff).not.toHaveBeenCalled();
    expect(host.openPlainDiff).toHaveBeenCalledWith(path);
  });

  it('shows only the plain diff for deleted files of any type', async () => {
    const { host, opened, openDiff } = makeHost({ 'deleted.md': { path: 'deleted.md' } });
    await openChangedFile(changed('deleted.md', 'D'), host);
    expect(opened).toEqual([]);
    expect(openDiff).not.toHaveBeenCalled();
    expect(host.openPlainDiff).toHaveBeenCalledWith('deleted.md');
  });
});
