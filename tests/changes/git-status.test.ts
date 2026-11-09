import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TFile } from 'obsidian';
import { GitStatusError, GitStatusReader, type ChangesVault } from '../../src/changes/git-status';
import { compileExcludes } from '../../src/changes/exclude';
import { DEFAULT_CHANGES_SETTINGS } from '../../src/changes/settings';

const exec = promisify(execFile);
let root: string;

async function git(...args: string[]): Promise<string> {
  return (await exec('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })).stdout;
}
async function note(path: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}
async function commit(message = 'test commit'): Promise<void> {
  await git('add', '--all');
  await git('commit', '-qm', message);
}
function vaultAt(base: string): ChangesVault {
  return {
    getFileByPath(path: string) {
      try {
        const info = statSync(join(base, path));
        if (!info.isFile()) return null;
        return { path, extension: extname(path).slice(1), stat: { size: info.size } } as unknown as TFile;
      } catch {
        return null;
      }
    },
    async cachedRead(file: TFile) {
      return readFile(join(base, file.path), 'utf8');
    },
    async readBinary(file: TFile) {
      const buffer = await readFile(join(base, file.path));
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    },
  };
}
function reader(base = root, gitPath = 'git'): GitStatusReader {
  return new GitStatusReader(base, () => gitPath, vaultAt(base));
}
const everything = () => false;
const settings = { ...DEFAULT_CHANGES_SETTINGS };
const excluded = compileExcludes(['.obsidian/']);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'uncommitted-'));
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.name', 'Changes Test');
  await git('config', 'user.email', 'test@example.invalid');
  await git('config', 'commit.gpgsign', 'false');
  await git('config', 'core.autocrlf', 'false');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('change set reads', () => {
  it('reports a clean repository as no changes and exposes HEAD', async () => {
    await note('note.md', 'content\n');
    await commit();
    const status = reader();
    try {
      const set = await status.readChangeSet(settings, everything);
      expect(set.files).toEqual([]);
      expect(set.added).toBe(0);
      expect(set.deleted).toBe(0);
      expect(set.head).toMatch(/^[0-9a-f]{40,64}$/);
      expect(set.updatedAt).toBeGreaterThan(0);
    } finally { status.dispose(); }
  });

  it('classifies modified, added, deleted, renamed, untracked and binary files', async () => {
    await note('modified.md', 'one\ntwo\n');
    await note('staged.md', 'placeholder\n');
    await note('deleted-unstaged.md', 'gone\n');
    await note('deleted-staged.md', 'gone\n');
    await note('rename-me.md', 'rename\n');
    await note('image.bin', Buffer.from([0, 1, 2, 3]));
    await commit();

    await note('modified.md', 'one\nchanged\n');
    await note('added.md', 'added one\nadded two\n');
    await git('add', 'added.md');
    await rm(join(root, 'deleted-unstaged.md'));
    await git('rm', '-q', 'deleted-staged.md');
    await git('mv', 'rename-me.md', 'renamed.md');
    await note('dir/sub/untracked.md', 'new one\nnew two\nnew three');
    await note('image.bin', Buffer.from([0, 1, 2, 3, 4]));

    const status = reader();
    try {
      const set = await status.readChangeSet(settings, everything);
      expect(set.files.map((file) => [file.path, file.status, file.added, file.deleted, file.binary, file.oldPath]))
        .toEqual([
          ['added.md', 'A', 2, 0, false, undefined],
          ['deleted-staged.md', 'D', 0, 1, false, undefined],
          ['deleted-unstaged.md', 'D', 0, 1, false, undefined],
          ['dir/sub/untracked.md', 'U', 3, 0, false, undefined],
          ['image.bin', 'M', 0, 0, true, undefined],
          ['modified.md', 'M', 1, 1, false, undefined],
          ['renamed.md', 'R', 1, 0, false, 'rename-me.md'],
        ]);
      expect(set.added).toBe(7);
      expect(set.deleted).toBe(3);
    } finally { status.dispose(); }
  });

  it('counts text, binary and oversized untracked files', async () => {
    await note('tracked.md', 'base\n');
    await commit();
    await note('text.md', 'one\ntwo');
    await note('text-with-newline.md', 'one\ntwo\n');
    await note('empty.md', '');
    await note('blob.unknown', Buffer.from([65, 0, 66]));
    await note('huge.md', 'x'.repeat(1024 * 1024 + 10));

    const status = new GitStatusReader(root, () => 'git', vaultAt(root), () => ({ maxFileMiB: 1, maxLines: 20_000 }));
    try {
      const set = await status.readChangeSet(settings, everything);
      expect(set.files.map((file) => [file.path, file.status, file.added, file.binary]))
        .toEqual([
          ['blob.unknown', 'U', 0, true],
          ['empty.md', 'U', 0, false],
          ['huge.md', 'U', 0, false],
          ['text-with-newline.md', 'U', 2, false],
          ['text.md', 'U', 2, false],
        ]);
    } finally { status.dispose(); }
  });

  it('handles a repository with no commits yet', async () => {
    await note('staged.md', 'one\ntwo\n');
    await git('add', 'staged.md');
    await note('untracked.md', 'new\n');
    const status = reader();
    try {
      const set = await status.readChangeSet(settings, everything);
      expect(set.head).toBeNull();
      expect(set.files.map((file) => [file.path, file.status, file.added])).toEqual([
        ['staged.md', 'A', 2],
        ['untracked.md', 'U', 1],
      ]);
    } finally { status.dispose(); }
  });

  it('reports unresolved merge conflicts', async () => {
    await note('note.md', 'base\n');
    await commit();
    await git('checkout', '-qb', 'conflict');
    await note('note.md', 'branch\n');
    await commit();
    await git('checkout', '-q', 'main');
    await note('note.md', 'main\n');
    await commit();
    await expect(git('merge', '--no-edit', 'conflict')).rejects.toBeDefined();
    const status = reader();
    try {
      const set = await status.readChangeSet(settings, everything);
      expect(set.files.find((file) => file.path === 'note.md')).toMatchObject({ status: '!' });
    } finally { status.dispose(); }
  });

  it('honors excludes and the untracked toggle', async () => {
    await note('.obsidian/app.json', '{}\n');
    await note('visible.md', 'x\n');
    const status = reader();
    try {
      expect((await status.readChangeSet(settings, excluded)).files.map((file) => file.path)).toEqual(['visible.md']);
      expect((await status.readChangeSet({ ...settings, showUntracked: false }, everything)).files).toEqual([]);
    } finally { status.dispose(); }
  });

  it('reads HEAD content but never the index or working tree', async () => {
    await note('note.md', 'HEAD\n');
    await commit();
    await note('note.md', 'working\n');
    await git('add', 'note.md');
    await note('note.md', 'later\n');
    const status = reader();
    try {
      expect((await status.readHeadBlob('note.md'))?.toString('utf8')).toBe('HEAD\n');
      expect(await status.readHeadBlob('missing.md')).toBeNull();
    } finally { status.dispose(); }
  });

  it('returns no HEAD blob when the repository has no commits yet', async () => {
    await note('staged.md', 'new\n');
    await git('add', 'staged.md');
    const status = reader();
    try {
      expect(await status.readHeadBlob('staged.md')).toBeNull();
    } finally { status.dispose(); }
  });

  it('does not write the index or leave an index lock behind', async () => {
    await note('note.md', 'HEAD\n');
    await commit();
    await note('note.md', 'working\n');
    await git('add', 'note.md');
    await note('note.md', 'later\n');
    const index = join(root, '.git/index');
    const before = await readFile(index);
    const beforeStat = await stat(index);
    const status = reader();
    try {
      await status.readChangeSet(settings, everything);
    } finally { status.dispose(); }
    expect(await readFile(index)).toEqual(before);
    expect((await stat(index)).mtimeMs).toBe(beforeStat.mtimeMs);
    expect(existsSync(join(root, '.git/index.lock'))).toBe(false);
  });
});

describe('repository errors', () => {
  it('rejects a vault that is only a subfolder of the repository', async () => {
    await mkdir(join(root, 'vault'));
    await note('vault/note.md', 'nested\n');
    await commit();
    const status = reader(join(root, 'vault'));
    try {
      await expect(status.readChangeSet(settings, everything)).rejects.toMatchObject({ kind: 'not-root' });
    } finally { status.dispose(); }
  });

  it('rejects a folder that is not a repository', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'uncommitted-outside-'));
    try {
      const status = reader(outside);
      await expect(status.readChangeSet(settings, everything)).rejects.toMatchObject({ kind: 'not-repo' });
      status.dispose();
    } finally { await rm(outside, { recursive: true, force: true }); }
  });

  it('reports a missing Git executable', async () => {
    const status = reader(root, join(root, 'missing-git'));
    try {
      await expect(status.readChangeSet(settings, everything)).rejects.toMatchObject({ kind: 'git-missing' });
    } finally { status.dispose(); }
  });

  it('stops work after disposal', async () => {
    const status = reader();
    status.dispose();
    await expect(status.readChangeSet(settings, everything)).rejects.toBeInstanceOf(GitStatusError);
  });
});
