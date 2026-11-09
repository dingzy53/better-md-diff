import { ItemView, Menu, debounce, setIcon, setTooltip, type Debouncer, type WorkspaceLeaf } from 'obsidian';
import type { ChangesController } from './controller';
import { buildTree, sortedFiles, sortedFolders, type TreeNode } from './model';
import type { ChangedFile, ChangesState, ChangeStatus } from './types';

export const CHANGES_VIEW = 'uncommitted-changes-view';
export const CHANGES_ICON = 'git-compare';

export interface ChangesViewHost {
  controller: ChangesController;
  open(file: ChangedFile): void;
  discard(file: ChangedFile): void;
  openSettings(): void;
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

function countText(count: number): string {
  return `${count} change${count === 1 ? '' : 's'}`;
}

/** Left-sidebar folder tree of every file that differs from HEAD. */
export class ChangesView extends ItemView {
  private readonly collapsed = new Set<string>();
  private collapsedInitialized = false;
  private readonly saveCollapsed: Debouncer<[], void>;
  private scrollEl?: HTMLElement;
  private unsubscribe?: () => void;

  constructor(leaf: WorkspaceLeaf, private readonly host: ChangesViewHost) {
    super(leaf);
    this.saveCollapsed = debounce(() => { void this.host.controller.saveCollapsedFolders([...this.collapsed].sort()); }, 500, true);
  }

  getViewType(): string {
    return CHANGES_VIEW;
  }

  getDisplayText(): string {
    return 'Changes';
  }

  getIcon(): string {
    return CHANGES_ICON;
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('unc-changes');
    this.unsubscribe = this.host.controller.subscribe(() => this.render());
    this.register(() => this.unsubscribe?.());
    this.register(() => this.saveCollapsed.cancel());
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.updateActiveRow()));
    this.render();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.saveCollapsed.cancel();
  }

  private render(): void {
    const state = this.host.controller.getState();
    const scrollTop = this.scrollEl?.scrollTop ?? 0;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusedPath = active && this.contentEl.contains(active) ? active.dataset.path : undefined;

    this.contentEl.empty();
    this.renderHeader(state);
    const body = this.contentEl.createDiv({ cls: 'unc-body' });
    body.setAttribute('role', 'tree');
    this.scrollEl = body.createDiv({ cls: 'unc-tree' });
    this.renderBody(state, this.scrollEl);
    this.scrollEl.scrollTop = scrollTop;

    if (focusedPath) {
      const row = Array.from(this.contentEl.querySelectorAll<HTMLElement>('button[data-path]')).find((element) => element.dataset.path === focusedPath);
      row?.focus();
    }
  }

  private renderHeader(state: ChangesState): void {
    const header = this.contentEl.createDiv({ cls: 'unc-header' });
    const summary = header.createDiv({ cls: 'unc-summary' });
    summary.setText(this.summaryText(state));

    const actions = header.createDiv({ cls: 'unc-actions' });
    const refresh = actions.createEl('button', { cls: 'clickable-icon unc-icon-button', attr: { type: 'button', 'aria-label': 'Refresh changes' } });
    setIcon(refresh, 'refresh-cw');
    setTooltip(refresh, 'Refresh changes');
    refresh.addEventListener('click', () => { void this.host.controller.refreshNow(); });

    const folders = state.status === 'ready' ? this.folderPaths(buildTree(state.set.files)) : [];
    const allCollapsed = folders.length > 0 && folders.every((path) => this.collapsed.has(path));
    const collapse = actions.createEl('button', {
      cls: 'clickable-icon unc-icon-button',
      attr: { type: 'button', 'aria-label': allCollapsed ? 'Expand all folders' : 'Collapse all folders' },
    });
    setIcon(collapse, 'chevrons-down-up');
    setTooltip(collapse, allCollapsed ? 'Expand all folders' : 'Collapse all folders');
    collapse.disabled = folders.length === 0;
    collapse.addEventListener('click', () => {
      if (allCollapsed) for (const path of folders) this.collapsed.delete(path);
      else for (const path of folders) this.collapsed.add(path);
      this.saveCollapsed();
      this.render();
    });
  }

  private summaryText(state: ChangesState): string {
    if (state.status === 'loading') return 'Loading changes…';
    if (state.status === 'error') return 'Git error';
    if (!state.set.files.length) return 'No changes since last commit';
    return `${countText(state.set.files.length)} · +${state.set.added} −${state.set.deleted}`;
  }

  private renderBody(state: ChangesState, container: HTMLElement): void {
    if (state.status === 'loading') {
      container.createDiv({ cls: 'unc-state', text: 'Loading changes…' });
      return;
    }
    if (state.status === 'error') {
      const error = container.createDiv({ cls: 'unc-state unc-error' });
      error.createDiv({ cls: 'unc-error-message', text: state.message });
      if (state.kind === 'git-missing') {
        const button = error.createEl('button', { cls: 'mod-cta unc-settings-button', text: 'Open settings' });
        button.addEventListener('click', () => this.host.openSettings());
      }
      return;
    }
    if (!state.set.files.length) {
      container.createDiv({ cls: 'unc-state unc-empty', text: 'No changes since last commit' });
      return;
    }
    this.initializeCollapsed();
    const tree = buildTree(state.set.files);
    this.pruneCollapsed(tree);
    this.renderNode(tree, container);
  }

  private renderNode(node: TreeNode, container: HTMLElement): void {
    for (const folder of sortedFolders(node)) this.renderFolder(folder, container);
    for (const file of sortedFiles(node)) this.renderFile(file, container);
  }

  private renderFolder(folder: TreeNode, container: HTMLElement): void {
    const expanded = !this.collapsed.has(folder.path);
    const item = container.createDiv({ cls: 'tree-item nav-folder unc-folder' });
    item.dataset.path = folder.path;
    const row = item.createEl('button', {
      cls: 'tree-item-self unc-row unc-folder-row',
      attr: { type: 'button', role: 'treeitem', 'aria-expanded': String(expanded) },
    });
    row.dataset.path = folder.path;
    const chevron = row.createSpan({ cls: 'tree-item-icon unc-chevron' });
    setIcon(chevron, expanded ? 'chevron-down' : 'chevron-right');
    row.createSpan({ cls: 'tree-item-inner', text: folder.name });
    row.createSpan({ cls: 'unc-folder-count', text: String(folder.count) });
    setTooltip(row, folder.path);
    row.addEventListener('click', () => {
      if (expanded) this.collapsed.add(folder.path);
      else this.collapsed.delete(folder.path);
      this.saveCollapsed();
      this.render();
    });
    const children = item.createDiv({ cls: 'tree-item-children unc-children' });
    if (expanded) this.renderNode(folder, children);
    else children.remove();
  }

  private renderFile(file: ChangedFile, container: HTMLElement): void {
    const active = this.host.controller.activePath() === file.path;
    const item = container.createDiv({ cls: `tree-item nav-file unc-file${active ? ' is-active' : ''}` });
    item.dataset.path = file.path;
    const row = item.createEl('button', {
      cls: 'tree-item-self unc-row',
      attr: { type: 'button', role: 'treeitem' },
    });
    row.dataset.path = file.path;
    const label = BADGE_LABEL[file.status];
    const badge = row.createSpan({ cls: `unc-badge unc-badge-${file.status === '!' ? 'conflict' : file.status.toLowerCase()}`, text: file.status });
    badge.setAttribute('aria-label', label);
    setTooltip(badge, label);
    row.createSpan({ cls: 'tree-item-inner', text: fileName(file.path) });
    setTooltip(row, file.oldPath ? `${file.oldPath} → ${file.path}` : file.path);
    row.addEventListener('click', () => this.host.open(file));
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.showMenu(file, event);
    });
    row.addEventListener('keydown', (event) => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        const rect = row.getBoundingClientRect();
        this.showMenu(file, undefined, { x: rect.left, y: rect.bottom });
      }
    });
  }

  private showMenu(file: ChangedFile, event?: MouseEvent, position?: { x: number; y: number }): void {
    const menu = new Menu();
    const allowed = this.host.controller.canDiscard(file);
    const reason = file.status === 'R'
      ? "Discard isn't available for renames. Use Git in a terminal."
      : file.status === '!'
        ? 'Resolve the conflict first.'
        : 'Use Git in a terminal for this file.';
    menu.addItem((item) => {
      item.setTitle('Discard all changes').setIcon('undo-2').setWarning(true).setDisabled(!allowed);
      if (allowed) item.onClick(() => this.host.discard(file));
    });
    if (!allowed) menu.addItem((item) => item.setIsLabel(true).setTitle(reason));
    if (event) menu.showAtMouseEvent(event);
    else if (position) menu.showAtPosition(position);
  }

  private initializeCollapsed(): void {
    if (this.collapsedInitialized) return;
    this.collapsedInitialized = true;
    for (const path of this.host.controller.changesSettings().collapsedFolders) this.collapsed.add(path);
  }

  private pruneCollapsed(tree: TreeNode): void {
    const existing = new Set(this.folderPaths(tree));
    let changed = false;
    for (const path of [...this.collapsed]) {
      if (!existing.has(path)) {
        this.collapsed.delete(path);
        changed = true;
      }
    }
    if (changed) this.saveCollapsed();
  }

  private folderPaths(node: TreeNode): string[] {
    const paths: string[] = [];
    for (const folder of node.children.values()) {
      paths.push(folder.path, ...this.folderPaths(folder));
    }
    return paths;
  }

  private updateActiveRow(): void {
    const active = this.host.controller.activePath();
    for (const element of Array.from(this.contentEl.querySelectorAll<HTMLElement>('.unc-file'))) {
      element.toggleClass('is-active', element.dataset.path === active);
    }
  }
}
