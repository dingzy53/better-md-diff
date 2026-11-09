import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { extname } from 'node:path';
import { promisify } from 'node:util';
import type { TFile } from 'obsidian';
import { DEFAULT_SETTINGS, type DocumentLimits } from '../options';
import { parseNumstat, parsePorcelainV2, summarize, toChangedFiles, type UntrackedCount } from './model';
import type { ChangeSet, ChangesErrorKind, ChangesSettings } from './types';

const exec = promisify(execFile);

/** Empty tree object; the diff base for a repository with no commits yet. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Only the Vault operations needed to count lines in untracked files. */
export interface ChangesVault {
  getFileByPath(path: string): TFile | null;
  cachedRead(file: TFile): Promise<string>;
  readBinary(file: TFile): Promise<ArrayBuffer>;
}

export class GitStatusError extends Error {
  constructor(
    public readonly kind: ChangesErrorKind,
    message: string,
    public readonly exitCode?: number,
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = 'GitStatusError';
  }
}

const TEXT_EXTENSIONS = new Set([
  'md', 'markdown', 'txt', 'canvas', 'base', 'json', 'jsonc', 'css', 'js', 'mjs', 'cjs', 'jsx',
  'ts', 'tsx', 'html', 'htm', 'xml', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'csv', 'tsv',
  'svg', 'sh', 'bash', 'zsh', 'fish', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp',
  'cs', 'php', 'lua', 'sql', 'tex', 'org', 'log', 'srt', 'vtt',
]);

function countLines(text: string): number {
  if (!text) return 0;
  let lines = 0;
  for (let index = 0; index < text.length; index++) if (text.charCodeAt(index) === 10) lines++;
  return text.endsWith('\n') ? lines : lines + 1;
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/**
 * Read-only Git access for the changes list. Every command runs with
 * GIT_OPTIONAL_LOCKS=0 so an open editor never contends with the owner's
 * terminal for the index lock.
 */
export class GitStatusReader {
  private controller = new AbortController();

  constructor(
    private readonly vaultRoot: string,
    private readonly gitPath: () => string,
    private readonly vault: ChangesVault,
    private readonly limits: () => DocumentLimits = () => DEFAULT_SETTINGS,
  ) {}

  dispose(): void {
    this.controller.abort();
  }

  private async execRaw(args: string[], encoding: 'utf8' | 'buffer', maxBuffer: number): Promise<string | Buffer> {
    this.assertActive();
    try {
      const result = await exec(this.gitPath(), args, {
        cwd: this.vaultRoot,
        encoding,
        windowsHide: true,
        shell: false,
        signal: this.controller.signal,
        timeout: 8_000,
        maxBuffer,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_LITERAL_PATHSPECS: '1' },
      }) as unknown as { stdout: string | Buffer };
      return result.stdout;
    } catch (error) {
      throw this.failure(error);
    }
  }

  private failure(error: unknown): GitStatusError {
    if (error instanceof GitStatusError) return error;
    const failure = error as { code?: string | number; killed?: boolean; stderr?: string | Buffer; message?: string; name?: string };
    const stderr = typeof failure.stderr === 'string' ? failure.stderr.trim() : failure.stderr?.toString('utf8').trim() ?? '';
    if (failure.name === 'AbortError' || failure.code === 'ABORT_ERR' || this.controller.signal.aborted) {
      return new GitStatusError('other', 'The changes reader is closed.');
    }
    if (failure.code === 'ENOENT') return new GitStatusError('git-missing', 'Git was not found. Set the Git executable in settings.');
    if (failure.killed) return new GitStatusError('timeout', 'Git took too long to respond. Check the repository and try again.');
    if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return new GitStatusError('other', 'Git output was too large to list changes.');
    const exitCode = typeof failure.code === 'number' ? failure.code : undefined;
    const detail = stderr.slice(0, 500);
    return new GitStatusError('other', detail ? `Git failed: ${detail}` : 'Git failed. Refresh to try again.', exitCode, stderr);
  }

  private assertActive(): void {
    if (this.controller.signal.aborted) throw new GitStatusError('other', 'The changes reader is closed.');
  }

  private async runText(args: string[], maxBuffer = 32 * 1024 * 1024): Promise<string> {
    const output = await this.execRaw(args, 'utf8', maxBuffer);
    return typeof output === 'string' ? output : output.toString('utf8');
  }

  private async runBuffer(args: string[], maxBuffer = 32 * 1024 * 1024): Promise<Buffer> {
    const output = await this.execRaw(args, 'buffer', maxBuffer);
    return Buffer.isBuffer(output) ? output : Buffer.from(output);
  }

  /** The vault folder must be the repository root; otherwise the list is misleading. */
  async verifyRoot(): Promise<string> {
    let top: string;
    try {
      top = (await this.runText(['rev-parse', '--show-toplevel'])).trim();
    } catch (error) {
      if (!(error instanceof GitStatusError)) throw error;
      if (error.kind === 'git-missing' || error.kind === 'timeout') throw error;
      throw new GitStatusError('not-repo', "This vault isn't inside a Git repository.", error.exitCode, error.stderr);
    }
    try {
      const [topReal, rootReal] = await Promise.all([realpath(top), realpath(this.vaultRoot)]);
      if (!samePath(topReal, rootReal)) throw new GitStatusError('not-root', 'The vault folder must be the Git repository root.');
      return topReal;
    } catch (error) {
      if (error instanceof GitStatusError) throw error;
      throw new GitStatusError('other', 'Unable to resolve the vault or repository path.');
    }
  }

  /** HEAD hash, or null when the repository has no commits yet. */
  async head(): Promise<string | null> {
    try {
      const value = (await this.runText(['rev-parse', '--verify', '--quiet', 'HEAD'])).trim();
      return value || null;
    } catch (error) {
      if (error instanceof GitStatusError && error.exitCode === 1) return null;
      throw error;
    }
  }

  async readChangeSet(settings: ChangesSettings, isExcluded: (path: string) => boolean): Promise<ChangeSet> {
    this.assertActive();
    await this.verifyRoot();
    const head = await this.head();
    const status = parsePorcelainV2(await this.runText(['status', '--porcelain=v2', '-z', '--untracked-files=all']));
    const numstat = parseNumstat(await this.runText(['diff', head ?? EMPTY_TREE, '--numstat', '-z', '--no-renames']));
    const untracked = new Map<string, UntrackedCount>();
    if (settings.showUntracked) {
      for (const entry of status) {
        if (entry.kind !== 'untracked' || isExcluded(entry.path)) continue;
        this.assertActive();
        untracked.set(entry.path, await this.countUntracked(entry.path));
      }
    }
    const files = toChangedFiles(status, numstat, untracked, isExcluded, settings.showUntracked);
    const { added, deleted } = summarize(files);
    return { files, added, deleted, head, updatedAt: Date.now() };
  }

  private async countUntracked(path: string): Promise<UntrackedCount> {
    const file = this.vault.getFileByPath(path);
    if (!file) return { added: 0, binary: false }; // Outside Obsidian's index, e.g. a hidden folder.
    const limits = this.limits();
    if (file.stat.size > limits.maxFileMiB * 1024 * 1024) return { added: 0, binary: false };
    const extension = file.extension.toLowerCase();
    if (TEXT_EXTENSIONS.has(extension)) {
      const text = await this.vault.cachedRead(file);
      if (text.includes('\0')) return { added: 0, binary: true };
      return { added: countLines(text), binary: false };
    }
    const bytes = new Uint8Array(await this.vault.readBinary(file));
    if (bytes.subarray(0, 8192).includes(0)) return { added: 0, binary: true };
    return { added: countLines(new TextDecoder().decode(bytes)), binary: false };
  }

  /** HEAD content of one path; null when the path is new or HEAD is unborn. */
  async readHeadBlob(path: string): Promise<Buffer | null> {
    if (!(await this.head())) return null;
    try {
      return await this.runBuffer(['cat-file', 'blob', `HEAD:${path}`]);
    } catch (error) {
      if (error instanceof GitStatusError && error.exitCode !== undefined
        && /does not exist|not a valid object name|bad revision|exists on disk, but not in/i.test(error.stderr ?? '')) return null;
      throw error;
    }
  }
}

/** Extension helper shared with the view layer; keeps the text/binary rule in one place. */
export function isTextExtension(path: string): boolean {
  return TEXT_EXTENSIONS.has(extname(path).slice(1).toLowerCase());
}
