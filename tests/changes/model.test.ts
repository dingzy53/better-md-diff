import { describe, expect, it } from 'vitest';
import { adjacentFile, buildTree, flattenTree, parseNumstat, parsePorcelainV2, statusFor, summarize, toChangedFiles, type NumstatEntry, type RawEntry, type UntrackedCount } from '../../src/changes/model';
import type { ChangedFile } from '../../src/changes/types';

function file(path: string, status: ChangedFile['status'], added = 0, deleted = 0): ChangedFile {
  return { path, status, binary: false, added, deleted };
}

describe('status badges', () => {
  it.each<[RawEntry, ChangedFile['status']]>([
    [{ kind: 'ordinary', xy: 'A.', path: 'a.md' }, 'A'],
    [{ kind: 'ordinary', xy: 'AM', path: 'a.md' }, 'A'],
    [{ kind: 'ordinary', xy: '.M', path: 'a.md' }, 'M'],
    [{ kind: 'ordinary', xy: 'M.', path: 'a.md' }, 'M'],
    [{ kind: 'ordinary', xy: '.D', path: 'a.md' }, 'D'],
    [{ kind: 'ordinary', xy: 'D.', path: 'a.md' }, 'D'],
    [{ kind: 'ordinary', xy: 'MD', path: 'a.md' }, 'D'],
    [{ kind: 'rename', xy: 'R.', path: 'new.md', oldPath: 'old.md' }, 'R'],
    [{ kind: 'rename', xy: 'RM', path: 'new.md', oldPath: 'old.md' }, 'R'],
    [{ kind: 'rename', xy: 'C.', path: 'copy.md', oldPath: 'old.md' }, 'A'],
    [{ kind: 'unmerged', xy: 'UU', path: 'a.md' }, '!'],
    [{ kind: 'untracked', xy: '??', path: 'a.md' }, 'U'],
  ])('maps %o to %s', (entry, expected) => {
    expect(statusFor(entry)).toBe(expected);
  });
});

describe('porcelain v2 parsing', () => {
  it('parses ordinary, rename, untracked, ignored and unmerged records', () => {
    const output = [
      '1 .M N... 100644 100644 100644 abc def file name.md\0',
      '2 R. N... 100644 100644 100644 abc def R100 new name.md\0old name.md\0',
      '? untracked ünïcode.md\0',
      '! ignored.md\0',
      '1 .D N... 100644 100644 100644 abc def -dash.md\0',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.md\0',
    ].join('');
    expect(parsePorcelainV2(output)).toEqual([
      { kind: 'ordinary', xy: '.M', path: 'file name.md' },
      { kind: 'rename', xy: 'R.', path: 'new name.md', oldPath: 'old name.md' },
      { kind: 'untracked', xy: '??', path: 'untracked ünïcode.md' },
      { kind: 'ordinary', xy: '.D', path: '-dash.md' },
      { kind: 'unmerged', xy: 'UU', path: 'conflict.md' },
    ]);
  });

  it('ignores branch headers and empty records', () => {
    expect(parsePorcelainV2('\0# branch.head main\0')).toEqual([]);
  });
});

describe('numstat parsing', () => {
  it('reads text and binary records, including paths with spaces and tabs', () => {
    const output = '3\t1\tnotes/a b.md\0-\t-\timage.png\0';
    expect(parseNumstat(output)).toEqual(new Map<string, NumstatEntry>([
      ['notes/a b.md', { added: 3, deleted: 1, binary: false }],
      ['image.png', { added: 0, deleted: 0, binary: true }],
    ]));
  });
});

describe('changed file merging', () => {
  const entries: RawEntry[] = [
    { kind: 'untracked', xy: '??', path: 'new.md' },
    { kind: 'ordinary', xy: '.M', path: 'notes/a.md' },
    { kind: 'ordinary', xy: '.D', path: 'gone.md' },
    { kind: 'rename', xy: 'R.', path: 'renamed.md', oldPath: 'before.md' },
    { kind: 'unmerged', xy: 'UU', path: 'conflict.md' },
  ];
  const numstat = new Map<string, NumstatEntry>([
    ['notes/a.md', { added: 2, deleted: 1, binary: false }],
    ['gone.md', { added: 0, deleted: 9, binary: false }],
    ['renamed.md', { added: 9, deleted: 0, binary: false }],
    ['conflict.md', { added: 0, deleted: 0, binary: true }],
  ]);
  const untracked = new Map<string, UntrackedCount>([['new.md', { added: 5, binary: false }]]);

  it('merges stats, appends rename source paths and sorts by path', () => {
    const files = toChangedFiles(entries, numstat, untracked, () => false, true);
    expect(files.map((entry) => [entry.path, entry.status, entry.added, entry.deleted, entry.binary, entry.oldPath]))
      .toEqual([
        ['conflict.md', '!', 0, 0, true, undefined],
        ['gone.md', 'D', 0, 9, false, undefined],
        ['new.md', 'U', 5, 0, false, undefined],
        ['notes/a.md', 'M', 2, 1, false, undefined],
        ['renamed.md', 'R', 9, 0, false, 'before.md'],
      ]);
    expect(summarize(files)).toEqual({ count: 5, added: 16, deleted: 10 });
  });

  it('applies excludes and the untracked toggle', () => {
    const excluded = (path: string) => path === 'notes/a.md' || path === 'new.md';
    expect(toChangedFiles(entries, numstat, untracked, excluded, true).map((entry) => entry.path))
      .toEqual(['conflict.md', 'gone.md', 'renamed.md']);
    expect(toChangedFiles(entries, numstat, untracked, () => false, false).map((entry) => entry.path))
      .not.toContain('new.md');
  });

  it('counts an untracked file outside the vault index as zero lines', () => {
    const files = toChangedFiles([{ kind: 'untracked', xy: '??', path: 'hidden.md' }], new Map(), new Map(), () => false, true);
    expect(files[0]).toMatchObject({ status: 'U', added: 0, deleted: 0, binary: false });
  });
});

describe('folder tree', () => {
  const files = [
    file('root.md', 'M'),
    file('a/z.md', 'M'),
    file('a/b/y.md', 'M'),
    file('a/b/x.md', 'M'),
    file('c/q.md', 'M'),
  ];

  it('groups files, counts descendants and sorts folders before files', () => {
    const tree = buildTree(files);
    expect([...tree.children.keys()]).toEqual(['a', 'c']);
    expect(tree.children.get('a')?.count).toBe(3);
    expect(tree.children.get('a')?.children.get('b')?.count).toBe(2);
    expect(tree.files.map((entry) => entry.path)).toEqual(['root.md']);
    expect(flattenTree(files).map((row) => row.type === 'folder' ? `folder:${row.path}:${row.count}` : `file:${row.file.path}`))
      .toEqual(['folder:a:3', 'folder:a/b:2', 'file:a/b/x.md', 'file:a/b/y.md', 'file:a/z.md', 'folder:c:1', 'file:c/q.md', 'file:root.md']);
  });

  it('hides collapsed folder contents and keeps the folder row', () => {
    expect(flattenTree(files, (path) => path === 'a').map((row) => row.type === 'folder' ? row.path : row.file.path))
      .toEqual(['a', 'c', 'c/q.md', 'root.md']);
  });
});

describe('next and previous navigation', () => {
  const files = [file('root.md', 'M'), file('a/z.md', 'M'), file('a/b/x.md', 'M')];
  // Display order: a/b/x.md, a/z.md, root.md

  it('walks tree display order and wraps around', () => {
    expect(adjacentFile(files, 'a/b/x.md', 1)?.path).toBe('a/z.md');
    expect(adjacentFile(files, 'a/z.md', 1)?.path).toBe('root.md');
    expect(adjacentFile(files, 'root.md', 1)?.path).toBe('a/b/x.md');
    expect(adjacentFile(files, 'a/b/x.md', -1)?.path).toBe('root.md');
    expect(adjacentFile(files, 'root.md', -1)?.path).toBe('a/z.md');
  });

  it('starts at the first or last file when the current file is unknown', () => {
    expect(adjacentFile(files, undefined, 1)?.path).toBe('a/b/x.md');
    expect(adjacentFile(files, 'missing.md', -1)?.path).toBe('root.md');
    expect(adjacentFile([], 'a.md', 1)).toBeUndefined();
  });
});
