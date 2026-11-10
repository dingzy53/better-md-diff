import { Component, debounce, type App, type Debouncer, type TAbstractFile } from 'obsidian';
import type { DiffSettings } from '../options';
import { compileExcludes, type ExcludeMatcher } from './exclude';
import { GitStatusReader } from './git-status';
import { adjacentFile } from './model';
import type { ChangeSet, ChangedFile, ChangesErrorKind, ChangesSettings, ChangesState } from './types';

export interface ChangesReader {
  readChangeSet(settings: ChangesSettings, isExcluded: (path: string) => boolean): Promise<ChangeSet>;
  readHeadBlob(path: string): Promise<Buffer | null>;
  dispose(): void;
}

export interface ChangesControllerHost {
  app: App;
  vaultRoot: string;
  /** Upstream settings: Git path and document limits. */
  settings(): DiffSettings;
  changesSettings(): ChangesSettings;
  saveChangesSettings(): Promise<void>;
  saveCollapsedFolders(paths: string[]): Promise<void>;
}

type Listener = (state: ChangesState) => void;

/**
 * Owns the change set: debounced vault events, a single in-flight read, one
 * coalesced follow-up read, and the subscription used by the sidebar, the
 * status bar, and the plain diff view.
 */
export class ChangesController extends Component {
  private state: ChangesState = { status: 'loading' };
  private listeners = new Set<Listener>();
  private stopped = false;
  private running = false;
  private queued = false;
  private matcher: ExcludeMatcher = () => false;
  private matcherKey = '';
  private readonly reader: ChangesReader;
  private readonly debouncedRefresh: Debouncer<[], void>;

  constructor(private readonly host: ChangesControllerHost, reader?: ChangesReader) {
    super();
    this.reader = reader ?? new GitStatusReader(
      host.vaultRoot,
      () => host.settings().gitPath,
      host.app.vault,
      () => host.settings(),
    );
    this.debouncedRefresh = debounce(() => { void this.refresh(); }, 750, true);
  }

  onload(): void {
    this.registerEvent(this.host.app.vault.on('create', (file: TAbstractFile) => this.onVaultChange(file.path)));
    this.registerEvent(this.host.app.vault.on('modify', (file: TAbstractFile) => this.onVaultChange(file.path)));
    this.registerEvent(this.host.app.vault.on('delete', (file: TAbstractFile) => this.onVaultChange(file.path)));
    this.registerEvent(this.host.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
      if (this.isExcluded(file.path) && this.isExcluded(oldPath)) return;
      this.requestRefresh();
    }));
    this.registerDomEvent(window, 'focus', () => this.requestRefresh());
    this.host.app.workspace.onLayoutReady(() => this.requestRefresh());
  }

  onunload(): void {
    this.stopped = true;
    this.reader.dispose();
    this.debouncedRefresh.cancel();
    this.listeners.clear();
  }

  getState(): ChangesState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private setState(state: ChangesState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  private compileMatcher(): ExcludeMatcher {
    const patterns = this.host.changesSettings().excludePatterns;
    const key = patterns.join('\n');
    if (key !== this.matcherKey) {
      this.matcherKey = key;
      this.matcher = compileExcludes(patterns);
    }
    return this.matcher;
  }

  private isExcluded(path: string): boolean {
    return this.compileMatcher()(path);
  }

  private onVaultChange(path: string): void {
    if (this.isExcluded(path)) return;
    this.requestRefresh();
  }

  requestRefresh(): void {
    if (!this.stopped) this.debouncedRefresh();
  }

  /** Manual refresh: skip the debounce delay but keep single-flight semantics. */
  async refreshNow(): Promise<void> {
    if (this.stopped) return;
    this.debouncedRefresh.cancel();
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.stopped) return;
    if (this.running) {
      this.queued = true;
      return;
    }
    this.running = true;
    try {
      const set = await this.reader.readChangeSet(this.host.changesSettings(), this.compileMatcher());
      if (!this.stopped) this.setState({ status: 'ready', set });
    } catch (error) {
      if (this.stopped) return;
      const kind: ChangesErrorKind = error instanceof Error && 'kind' in error ? (error as { kind: ChangesErrorKind }).kind : 'other';
      const message = error instanceof Error ? error.message : 'Unable to read Git changes.';
      this.setState({ status: 'error', message, kind });
    } finally {
      this.running = false;
      if (this.queued && !this.stopped) {
        this.queued = false;
        void this.refresh();
      }
    }
  }

  /** Files currently listed, empty while loading or on error. */
  files(): readonly ChangedFile[] {
    return this.state.status === 'ready' ? this.state.set.files : [];
  }

  find(path: string | undefined): ChangedFile | undefined {
    if (!path) return undefined;
    return this.files().find((file) => file.path === path);
  }

  /** The file most recently open in the main area, kept while a sidebar has focus, as the file explorer does. */
  activePath(): string | undefined {
    return this.host.app.workspace.getActiveFile()?.path;
  }

  adjacent(direction: -1 | 1): ChangedFile | undefined {
    return adjacentFile(this.files(), this.activePath(), direction);
  }

  headBlob(path: string): Promise<Buffer | null> {
    return this.reader.readHeadBlob(path);
  }

  /** Whether the discard flow can act on this file through the Vault API. */
  canDiscard(file: ChangedFile): boolean {
    if (file.status === 'R' || file.status === '!') return false;
    if (file.status === 'D') return true;
    return this.host.app.vault.getFileByPath(file.path) !== null;
  }

  saveSettings(): Promise<void> {
    return this.host.saveChangesSettings();
  }

  settings(): DiffSettings {
    return this.host.settings();
  }

  changesSettings(): ChangesSettings {
    return this.host.changesSettings();
  }

  saveCollapsedFolders(paths: string[]): Promise<void> {
    return this.host.saveCollapsedFolders(paths);
  }
}
