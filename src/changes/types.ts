export type ChangeStatus = 'A' | 'M' | 'D' | 'R' | 'U' | '!';

export interface ChangedFile {
  /** Vault-relative path with `/` separators. */
  path: string;
  /** Original path, only set for renames. */
  oldPath?: string;
  status: ChangeStatus;
  /** True when Git or the file content reports binary data. */
  binary: boolean;
  /** Added lines; always 0 for binary files. */
  added: number;
  /** Deleted lines; always 0 for binary files. */
  deleted: number;
  /** True when the index already differs from HEAD for this path. */
  staged?: boolean;
}

export interface ChangeSet {
  /** Sorted by path, already filtered. */
  files: ChangedFile[];
  added: number;
  deleted: number;
  /** `null` when the repository has no commits yet. */
  head: string | null;
  updatedAt: number;
}

export type ChangesErrorKind = 'git-missing' | 'not-repo' | 'not-root' | 'timeout' | 'other';

export type ChangesState =
  | { status: 'loading' }
  | { status: 'ready'; set: ChangeSet }
  | { status: 'error'; message: string; kind: ChangesErrorKind };

export interface ChangesSettings {
  showUntracked: boolean;
  excludePatterns: string[];
  showStatusBar: boolean;
  /** Hidden setting: collapsed folder paths, persisted tree state. */
  collapsedFolders: string[];
}
