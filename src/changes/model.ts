import type { ChangeStatus, ChangedFile } from './types';

export type RawEntryKind = 'ordinary' | 'rename' | 'unmerged' | 'untracked';

export interface RawEntry {
  kind: RawEntryKind;
  /** Two-character `X`/`Y` status; `.` means unmodified. */
  xy: string;
  path: string;
  /** Original path for renames. */
  oldPath?: string;
}

export interface NumstatEntry {
  added: number;
  deleted: number;
  binary: boolean;
}

export interface UntrackedCount {
  added: number;
  binary: boolean;
}

const ORDINARY = /^1 ([^ ]{2}) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) (.*)$/s;
const RENAME = /^2 ([^ ]{2}) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) (.*)$/s;
const UNMERGED = /^u ([^ ]{2}) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) (.*)$/s;

export function cleanPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
}

/** Parse `git status --porcelain=v2 -z --untracked-files=all` output. */
export function parsePorcelainV2(output: string): RawEntry[] {
  const entries: RawEntry[] = [];
  const tokens = output.split('\0');
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (!token || token.startsWith('#')) continue;
    if (token.startsWith('? ')) {
      entries.push({ kind: 'untracked', xy: '??', path: cleanPath(token.slice(2)) });
      continue;
    }
    if (token.startsWith('! ')) continue; // Ignored files are never listed.
    const rename = RENAME.exec(token);
    if (rename) {
      const original = tokens[index + 1];
      if (original !== undefined) index++;
      entries.push({ kind: 'rename', xy: rename[1]!, path: cleanPath(rename[9]!), oldPath: original === undefined ? undefined : cleanPath(original) });
      continue;
    }
    const ordinary = ORDINARY.exec(token);
    if (ordinary) {
      entries.push({ kind: 'ordinary', xy: ordinary[1]!, path: cleanPath(ordinary[8]!) });
      continue;
    }
    const unmerged = UNMERGED.exec(token);
    if (unmerged) {
      entries.push({ kind: 'unmerged', xy: unmerged[1]!, path: cleanPath(unmerged[10]!) });
    }
  }
  return entries;
}

export function statusFor(entry: RawEntry): ChangeStatus {
  if (entry.kind === 'unmerged') return '!';
  if (entry.kind === 'untracked') return 'U';
  if (entry.kind === 'rename') {
    if (entry.xy.includes('R')) return 'R';
    if (entry.xy.includes('C')) return 'A';
  }
  const [x = '.', y = '.'] = entry.xy;
  if (x === 'D' || y === 'D') return 'D';
  if (x === 'A') return 'A';
  return 'M';
}

/** Parse `git diff <base> --numstat -z --no-renames` output. */
export function parseNumstat(output: string): Map<string, NumstatEntry> {
  const result = new Map<string, NumstatEntry>();
  for (const token of output.split('\0')) {
    if (!token) continue;
    const first = token.indexOf('\t');
    if (first < 0) continue;
    const second = token.indexOf('\t', first + 1);
    if (second < 0) continue;
    const added = token.slice(0, first);
    const deleted = token.slice(first + 1, second);
    const path = token.slice(second + 1);
    if (!path) continue;
    const binary = added === '-' || deleted === '-';
    result.set(cleanPath(path), {
      added: binary ? 0 : Number(added) || 0,
      deleted: binary ? 0 : Number(deleted) || 0,
      binary,
    });
  }
  return result;
}

export function comparePaths(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true })
    || (left < right ? -1 : left > right ? 1 : 0);
}

/** Merge status, numstat, and untracked line counts into the display model. */
export function toChangedFiles(
  entries: readonly RawEntry[],
  numstat: ReadonlyMap<string, NumstatEntry>,
  untrackedCounts: ReadonlyMap<string, UntrackedCount>,
  isExcluded: (path: string) => boolean,
  showUntracked: boolean,
): ChangedFile[] {
  const files: ChangedFile[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const status = statusFor(entry);
    if (status === 'U' && !showUntracked) continue;
    if (isExcluded(entry.path)) continue;
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    const stats = status === 'U' ? untrackedCounts.get(entry.path) : numstat.get(entry.path);
    const file: ChangedFile = {
      path: entry.path,
      status,
      binary: stats?.binary ?? false,
      added: stats?.added ?? 0,
      deleted: status === 'U' ? 0 : numstat.get(entry.path)?.deleted ?? 0,
      staged: entry.kind !== 'untracked' && entry.xy[0] !== '.' && entry.xy[0] !== ' ',
    };
    if (status === 'R' && entry.oldPath) file.oldPath = entry.oldPath;
    files.push(file);
  }
  return files.sort((left, right) => comparePaths(left.path, right.path));
}

export function summarize(files: readonly ChangedFile[]): { count: number; added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const file of files) {
    added += file.added;
    deleted += file.deleted;
  }
  return { count: files.length, added, deleted };
}

export interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  files: ChangedFile[];
  /** Number of changed files at or beneath this folder. */
  count: number;
}

export function buildTree(files: readonly ChangedFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map(), files: [], count: 0 };
  for (const file of files) {
    const segments = file.path.split('/').filter(Boolean);
    if (!segments.length) continue;
    let node = root;
    for (let index = 0; index < segments.length - 1; index++) {
      const name = segments[index]!;
      let child = node.children.get(name);
      if (!child) {
        child = { name, path: segments.slice(0, index + 1).join('/'), children: new Map(), files: [], count: 0 };
        node.children.set(name, child);
      }
      node = child;
    }
    node.files.push(file);
  }
  countTree(root);
  return root;
}

function countTree(node: TreeNode): number {
  let count = node.files.length;
  for (const child of node.children.values()) count += countTree(child);
  node.count = count;
  return count;
}

export type TreeRow =
  | { type: 'folder'; name: string; path: string; count: number; depth: number; expanded: boolean; node: TreeNode }
  | { type: 'file'; file: ChangedFile; depth: number };

export function sortedFolders(node: TreeNode): TreeNode[] {
  return [...node.children.values()].sort((left, right) => comparePaths(left.name, right.name));
}

export function sortedFiles(node: TreeNode): ChangedFile[] {
  return [...node.files].sort((left, right) => comparePaths(left.path, right.path));
}

/** Depth-first display order: folders before files, both alphabetical. */
export function flattenTree(files: readonly ChangedFile[], isCollapsed: (path: string) => boolean = () => false): TreeRow[] {
  const rows: TreeRow[] = [];
  const visit = (node: TreeNode, depth: number): void => {
    for (const folder of sortedFolders(node)) {
      const expanded = !isCollapsed(folder.path);
      rows.push({ type: 'folder', name: folder.name, path: folder.path, count: folder.count, depth, expanded, node: folder });
      if (expanded) visit(folder, depth + 1);
    }
    for (const file of sortedFiles(node)) rows.push({ type: 'file', file, depth });
  };
  visit(buildTree(files), 0);
  return rows;
}

export function orderedFiles(files: readonly ChangedFile[]): ChangedFile[] {
  return flattenTree(files).flatMap((row) => row.type === 'file' ? [row.file] : []);
}

/** Next/previous in tree display order, wrapping around. */
export function adjacentFile(files: readonly ChangedFile[], currentPath: string | undefined, direction: -1 | 1): ChangedFile | undefined {
  const ordered = orderedFiles(files);
  if (!ordered.length) return undefined;
  const index = currentPath === undefined ? -1 : ordered.findIndex((file) => file.path === currentPath);
  if (index < 0) return direction === 1 ? ordered[0] : ordered[ordered.length - 1];
  return ordered[(index + direction + ordered.length) % ordered.length];
}
