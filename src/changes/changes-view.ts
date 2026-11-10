import { ItemView, Menu, Notice, debounce, setIcon, setTooltip, type Debouncer, type WorkspaceLeaf } from 'obsidian';
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

/** File name as the file explorer shows it: Markdown files drop their extension. */
export function displayName(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return name;
  return name.slice(dot + 1).toLowerCase() === 'md' ? name.slice(0, dot) : name;
}

/** Lowercase extension shown as a tag beside non-Markdown files; empty for Markdown and extensionless files. */
export function extensionTag(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  const extension = name.slice(dot + 1).toLowerCase();
  return extension === 'md' ? '' : extension;
}

export function statusClass(status: ChangeStatus): string {
  return `unc-status-${status === '!' ? 'conflict' : status.toLowerCase()}`;
}

function countText(count: number): string {
  return `${count} change${count === 1 ? '' : 's'}`;
}

function fileTooltip(file: ChangedFile): string {
  const path = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
  const detail = file.binary ? 'binary' : `+${file.added} −${file.deleted}`;
  return `${path}\n${BADGE_LABEL[file.status]} · ${detail}`;
}

/** Left-sidebar folder tree of every file that differs from HEAD, built from Obsidian's own tree markup. */
export class ChangesView extends ItemView {
  private readonly collapsed = new Set<string>();
  private readonly files = new Map<string, ChangedFile>();
  private collapsedInitialized = false;
  private readonly saveCollapsed: Debouncer<[], void>;
  private collapseButton?: HTMLElement;
  private summaryEl?: HTMLElement;
  private treeEl?: HTMLElement;
  /** Path of the row that holds the tree's single tab stop. */
  private focusPath?: string;
  private unsubscribe?: () => void;

  constructor(leaf: WorkspaceLeaf, private readonly host: ChangesViewHost) {
    super(leaf);
    this.saveCollapsed = debounce(() => { void this.host.controller.saveCollapsedFolders([...this.collapsed].sort()); }, 500, true);
  }

  getViewType(): string {
    return CHANGES_VIEW;
  }

  getDisplayText(): string {
    return 'Uncommitted changes';
  }

  getIcon(): string {
    return CHANGES_ICON;
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('unc-changes');
    this.buildSkeleton();
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

  private buildSkeleton(): void {
    const header = this.contentEl.createDiv({ cls: 'nav-header' });
    const buttons = header.createDiv({ cls: 'nav-buttons-container' });
    const refresh = this.navButton(buttons, 'refresh-cw', 'Refresh changes');
    refresh.addEventListener('click', () => { void this.host.controller.refreshNow(); });
    this.collapseButton = this.navButton(buttons, 'chevrons-down-up', 'Collapse all folders');
    this.collapseButton.addEventListener('click', () => this.toggleAllFolders());

    this.summaryEl = this.contentEl.createDiv({ cls: 'unc-summary' });
    this.treeEl = this.contentEl.createDiv({ cls: 'unc-tree' });
    this.treeEl.setAttribute('role', 'tree');
    this.treeEl.setAttribute('aria-label', 'Changed files');
    this.treeEl.addEventListener('keydown', (event) => this.onTreeKeydown(event));
    this.treeEl.addEventListener('focusin', (event) => {
      const row = this.rowFromEvent(event);
      if (row) this.setRovingRow(row, false);
    });
    this.treeEl.addEventListener('focusout', (event) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !this.treeEl?.contains(next)) {
        for (const row of this.visibleRows()) row.removeClass('has-focus');
      }
    });
  }

  private navButton(container: HTMLElement, icon: string, label: string): HTMLElement {
    const button = container.createDiv({ cls: 'clickable-icon nav-action-button', attr: { role: 'button', tabindex: '0', 'aria-label': label } });
    setIcon(button, icon);
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        button.click();
      }
    });
    return button;
  }

  private render(): void {
    const tree = this.treeEl;
    if (!tree) return;
    const state = this.host.controller.getState();
    const scrollTop = tree.scrollTop;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const hadFocus = active !== null && tree.contains(active);

    this.renderSummary(state);
    this.updateCollapseButton(state);
    tree.empty();
    this.files.clear();
    this.renderBody(state, tree);
    tree.scrollTop = scrollTop;

    const row = this.syncRovingRow();
    if (hadFocus) row?.focus();
  }

  private renderSummary(state: ChangesState): void {
    const summary = this.summaryEl!;
    summary.empty();
    if (state.status !== 'ready' || !state.set.files.length) {
      summary.addClass('unc-summary-hidden');
      return;
    }
    summary.removeClass('unc-summary-hidden');
    const { files, added, deleted } = state.set;
    summary.setAttribute('aria-label', `${countText(files.length)}, ${added} line${added === 1 ? '' : 's'} added, ${deleted} deleted`);
    summary.createSpan({ cls: 'unc-summary-count', text: countText(files.length) });
    summary.createSpan({ cls: 'unc-summary-added', text: `+${added}` });
    summary.createSpan({ cls: 'unc-summary-deleted', text: `−${deleted}` });
  }

  private updateCollapseButton(state: ChangesState): void {
    const button = this.collapseButton!;
    const folders = state.status === 'ready' ? this.folderPaths(buildTree(state.set.files)) : [];
    const allCollapsed = folders.length > 0 && folders.every((path) => this.collapsed.has(path));
    const label = allCollapsed ? 'Expand all folders' : 'Collapse all folders';
    setIcon(button, allCollapsed ? 'chevrons-up-down' : 'chevrons-down-up');
    button.setAttribute('aria-label', label);
    setTooltip(button, label);
    const disabled = folders.length === 0;
    button.toggleClass('is-disabled', disabled);
    button.setAttribute('aria-disabled', String(disabled));
    button.setAttribute('tabindex', disabled ? '-1' : '0');
  }

  private toggleAllFolders(): void {
    const state = this.host.controller.getState();
    if (state.status !== 'ready') return;
    const folders = this.folderPaths(buildTree(state.set.files));
    if (!folders.length) return;
    const allCollapsed = folders.every((path) => this.collapsed.has(path));
    if (allCollapsed) for (const path of folders) this.collapsed.delete(path);
    else for (const path of folders) this.collapsed.add(path);
    this.saveCollapsed();
    this.render();
  }

  private renderBody(state: ChangesState, container: HTMLElement): void {
    if (state.status === 'loading') {
      container.createDiv({ cls: 'pane-empty unc-state', text: 'Loading changes…' });
      return;
    }
    if (state.status === 'error') {
      const error = container.createDiv({ cls: 'pane-empty unc-state unc-error' });
      error.createDiv({ cls: 'unc-error-message', text: state.message });
      if (state.kind === 'git-missing') {
        const actions = error.createDiv({ cls: 'pane-empty-actions' });
        const button = actions.createEl('button', { cls: 'mod-cta unc-settings-button', text: 'Open settings' });
        button.addEventListener('click', () => this.host.openSettings());
      }
      return;
    }
    if (!state.set.files.length) {
      container.createDiv({ cls: 'pane-empty unc-state unc-empty', text: 'No changes since last commit' });
      return;
    }
    this.initializeCollapsed();
    const tree = buildTree(state.set.files);
    this.pruneCollapsed(tree);
    this.renderNode(tree, container, 1);
  }

  private renderNode(node: TreeNode, container: HTMLElement, level: number): void {
    for (const folder of sortedFolders(node)) this.renderFolder(folder, container, level);
    for (const file of sortedFiles(node)) this.renderFile(file, container, level);
  }

  private renderFolder(folder: TreeNode, container: HTMLElement, level: number): void {
    const item = container.createDiv({ cls: 'tree-item unc-folder' });
    item.dataset.path = folder.path;
    const row = item.createDiv({ cls: 'tree-item-self is-clickable mod-collapsible unc-row' });
    row.dataset.path = folder.path;
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(level));
    row.setAttribute('tabindex', '-1');
    const icon = row.createDiv({ cls: 'tree-item-icon collapse-icon' });
    setIcon(icon, 'right-triangle');
    row.createDiv({ cls: 'tree-item-inner unc-name', text: folder.name });
    row.createDiv({ cls: 'tree-item-flair-outer' }).createSpan({ cls: 'tree-item-flair', text: String(folder.count) });
    setTooltip(row, folder.path, { placement: 'right' });

    // Like the file explorer, a collapsed folder keeps its children element detached and empty.
    const children = item.createDiv({ cls: 'tree-item-children', attr: { role: 'group' } });
    const apply = (expanded: boolean): void => {
      item.toggleClass('is-collapsed', !expanded);
      icon.toggleClass('is-collapsed', !expanded);
      row.setAttribute('aria-expanded', String(expanded));
      children.empty();
      if (expanded) {
        this.renderNode(folder, children, level + 1);
        item.appendChild(children);
      } else {
        children.remove();
      }
    };
    apply(!this.collapsed.has(folder.path));
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.showMenu(row, event);
    });
    row.addEventListener('click', () => {
      const expand = this.collapsed.has(folder.path);
      if (expand) this.collapsed.delete(folder.path);
      else this.collapsed.add(folder.path);
      this.saveCollapsed();
      apply(expand);
      this.updateCollapseButton(this.host.controller.getState());
      this.syncRovingRow();
    });
  }

  private renderFile(file: ChangedFile, container: HTMLElement, level: number): void {
    const active = this.host.controller.activePath() === file.path;
    const item = container.createDiv({ cls: 'tree-item unc-file' });
    item.dataset.path = file.path;
    const row = item.createDiv({ cls: `tree-item-self is-clickable unc-row${active ? ' is-active' : ''}${file.status === 'D' ? ' unc-deleted' : ''}` });
    row.dataset.path = file.path;
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(level));
    row.setAttribute('aria-selected', String(active));
    row.setAttribute('tabindex', '-1');
    row.createDiv({ cls: 'tree-item-inner unc-name', text: displayName(file.path) });
    const tag = extensionTag(file.path);
    if (tag) row.createSpan({ cls: 'unc-file-tag', text: tag });
    const label = BADGE_LABEL[file.status];
    const flair = row.createDiv({ cls: 'tree-item-flair-outer' })
      .createSpan({ cls: `tree-item-flair unc-flair ${statusClass(file.status)}`, text: file.status });
    flair.setAttribute('aria-label', label);
    setTooltip(row, fileTooltip(file), { placement: 'right' });
    row.addEventListener('click', () => this.host.open(file));
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.showMenu(row, event);
    });
    this.files.set(file.path, file);
  }

  /** Context menu for a row, grouped into sections like the file explorer's menu. */
  private showMenu(row: HTMLElement, event?: MouseEvent): void {
    const path = row.dataset.path;
    if (path === undefined) return;
    const file = this.files.get(path);
    const menu = new Menu();
    if (file) {
      menu.addItem((item) => item.setSection('open').setTitle('Show changes').setIcon(CHANGES_ICON).onClick(() => this.host.open(file)));
    } else {
      const expanded = row.getAttribute('aria-expanded') === 'true';
      menu.addItem((item) => item.setSection('open').setTitle(expanded ? 'Collapse' : 'Expand')
        .setIcon(expanded ? 'chevrons-down-up' : 'chevrons-up-down').onClick(() => row.click()));
    }
    // Not "Copy path": the upstream lint config treats PATH as an acronym and forbids disabling the rule.
    menu.addItem((item) => item.setSection('action').setTitle('Copy vault location').setIcon('copy').onClick(() => { void this.copyPath(path); }));
    if (file) this.addDiscardItems(menu, file);

    row.addClass('has-active-menu');
    menu.onHide(() => row.removeClass('has-active-menu'));
    if (event) {
      menu.showAtMouseEvent(event);
    } else {
      const rect = row.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom });
    }
  }

  private addDiscardItems(menu: Menu, file: ChangedFile): void {
    const allowed = this.host.controller.canDiscard(file);
    const reason = file.status === 'R'
      ? "Discard isn't available for renames. Use Git in a terminal."
      : file.status === '!'
        ? 'Resolve the conflict first.'
        : 'Use Git in a terminal for this file.';
    menu.addItem((item) => {
      item.setSection('danger').setTitle('Discard all changes').setIcon('undo-2').setWarning(true).setDisabled(!allowed);
      if (allowed) item.onClick(() => this.host.discard(file));
    });
    if (!allowed) menu.addItem((item) => item.setSection('danger').setIsLabel(true).setTitle(reason));
  }

  private async copyPath(path: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(path);
      new Notice('Copied to the clipboard.');
    } catch {
      new Notice('Unable to copy to the clipboard.');
    }
  }

  /** Rows currently in the tree, in display order; collapsed folders keep their children detached. */
  private visibleRows(): HTMLElement[] {
    return Array.from(this.treeEl?.querySelectorAll<HTMLElement>('.tree-item-self[data-path]') ?? []);
  }

  private rowFromEvent(event: Event): HTMLElement | null {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return null;
    const row = target.closest<HTMLElement>('.tree-item-self[data-path]');
    return row && this.treeEl?.contains(row) ? row : null;
  }

  /** Give exactly one row the tab stop: the remembered row, else the active file, else the first row. */
  private syncRovingRow(): HTMLElement | undefined {
    const rows = this.visibleRows();
    const activePath = this.host.controller.activePath();
    const row = rows.find((element) => element.dataset.path === this.focusPath)
      ?? rows.find((element) => element.dataset.path === activePath)
      ?? rows[0];
    for (const element of rows) element.setAttribute('tabindex', element === row ? '0' : '-1');
    this.focusPath = row?.dataset.path;
    return row;
  }

  private setRovingRow(row: HTMLElement, focus: boolean): void {
    for (const element of this.visibleRows()) {
      element.setAttribute('tabindex', element === row ? '0' : '-1');
      element.toggleClass('has-focus', element === row);
    }
    this.focusPath = row.dataset.path;
    if (focus) row.focus();
  }

  private onTreeKeydown(event: KeyboardEvent): void {
    const row = this.rowFromEvent(event);
    if (!row) return;
    const rows = this.visibleRows();
    const index = rows.indexOf(row);
    const isFolder = row.classList.contains('mod-collapsible');
    const expanded = row.getAttribute('aria-expanded') === 'true';
    const move = (target: HTMLElement | null | undefined): void => {
      if (target) this.setRovingRow(target, true);
    };

    switch (event.key) {
      case 'ArrowDown': move(rows[index + 1]); break;
      case 'ArrowUp': move(rows[index - 1]); break;
      case 'Home': move(rows[0]); break;
      case 'End': move(rows[rows.length - 1]); break;
      case 'ArrowRight':
        if (!isFolder) return;
        if (expanded) move(row.parentElement?.querySelector<HTMLElement>(':scope > .tree-item-children > .tree-item > .tree-item-self'));
        else row.click();
        break;
      case 'ArrowLeft':
        if (isFolder && expanded) row.click();
        else move(row.parentElement?.parentElement?.closest<HTMLElement>('.unc-folder')?.querySelector<HTMLElement>(':scope > .tree-item-self'));
        break;
      case 'Enter':
      case ' ':
        row.click();
        break;
      case 'ContextMenu':
      case 'F10':
        if (event.key === 'F10' && !event.shiftKey) return;
        this.showMenu(row);
        break;
      default:
        return;
    }
    event.preventDefault();
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
    for (const element of Array.from(this.contentEl.querySelectorAll<HTMLElement>('.unc-file > .tree-item-self'))) {
      const isActive = element.dataset.path === active;
      element.toggleClass('is-active', isActive);
      element.setAttribute('aria-selected', String(isActive));
    }
  }
}
