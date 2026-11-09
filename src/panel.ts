import { ItemView, setIcon, type WorkspaceLeaf } from 'obsidian';
import { changeAnchor, changeRange, type DiffHunk, type DiffRow, type LineChange } from './diff';
import type { DiffStore, ReadyDiffState } from './store';
import type { DiffSettings } from './options';
import { highlightHunks, pairDiffRows, renderHighlightedText, type InlineHighlights } from './inline-diff';
import { centerDiffChange, findDiffLocation, revealDiffRow } from './diff-navigation';
import { selectedDiffText } from './diff-copy';
import { ReadingGuideModal } from './reading-guide';

export const DIFF_VIEW = 'better-md-diff-view';
export const DIFF_ICON = 'file-diff';
export interface DiffPanelHost {
  store: DiffStore;
  settings(): DiffSettings;
  currentPath(): string | undefined;
  refresh(path: string): Promise<void>;
  navigate(path: string, line: number, focus?: boolean, center?: boolean): void;
  revert(snapshot: ReadyDiffState, change: LineChange): void;
}
interface ChangeItem {
  element: HTMLElement;
  jump: HTMLButtonElement;
  revert: HTMLButtonElement;
  rowIndex: number;
  change: LineChange;
  snapshot: ReadyDiffState;
}
/** A cached context region is only a rendering boundary, never a restoration target. */
interface HunkCard {
  key: string;
  element: HTMLElement;
  heading: HTMLButtonElement;
  rows: HTMLElement[];
  pairs: Map<number, number>;
  limited: boolean;
  hunk: DiffHunk;
  items: ChangeItem[];
}

export class DiffPanel extends ItemView {
  private path?: string;
  private selected = 0;
  private cards: HunkCard[] = [];
  private items: ChangeItem[] = [];
  private rowElements = new Map<DiffRow, HTMLElement>();
  private rowPairs = new Map<DiffRow, DiffRow>();
  private rendered?: ReadyDiffState;
  private pendingRender = false;
  private followedLine?: number;
  private currentRow?: HTMLElement;
  private pairedRow?: HTMLElement;
  private summary!: HTMLElement;
  private body!: HTMLElement;
  private progress!: HTMLElement;
  private feedback!: HTMLElement;
  private previous!: HTMLButtonElement;
  private next!: HTMLButtonElement;
  private refreshButton!: HTMLButtonElement;
  private navigationEl!: HTMLElement;
  private helpButton!: HTMLButtonElement;
  private helpModal?: ReadingGuideModal;
  private refreshRequest?: symbol;
  private summaryKey?: string;

  constructor(leaf: WorkspaceLeaf, private host: DiffPanelHost) { super(leaf); }
  getViewType(): string { return DIFF_VIEW; }
  getDisplayText(): string { return 'Git diff'; }
  getIcon(): string { return DIFF_ICON; }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('bmd-panel');
    const toolbar = this.contentEl.createDiv({ cls: 'bmd-toolbar' });
    this.refreshButton = toolbar.createEl('button', { cls: 'bmd-refresh', text: 'Refresh', attr: { type: 'button', 'aria-label': 'Check HEAD and refresh the diff' } });
    this.refreshButton.addEventListener('click', () => { void this.refreshCurrent(); });
    this.navigationEl = toolbar.createDiv({ cls: 'bmd-navigation', attr: { role: 'group' } });
    this.previous = this.navigationEl.createEl('button', { cls: 'bmd-previous bmd-icon-button', attr: { type: 'button' } });
    setIcon(this.previous.createSpan({ attr: { 'aria-hidden': 'true' } }), 'arrow-up');
    this.progress = this.navigationEl.createSpan({ cls: 'bmd-progress', attr: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' } });
    this.next = this.navigationEl.createEl('button', { cls: 'bmd-next bmd-icon-button', attr: { type: 'button' } });
    setIcon(this.next.createSpan({ attr: { 'aria-hidden': 'true' } }), 'arrow-down');
    this.previous.addEventListener('click', () => this.move(-1));
    this.next.addEventListener('click', () => this.move(1));
    this.helpButton = toolbar.createEl('button', { cls: 'bmd-help-button bmd-icon-button', attr: { type: 'button', 'aria-haspopup': 'dialog' } });
    setIcon(this.helpButton.createSpan({ attr: { 'aria-hidden': 'true' } }), 'help-circle');
    this.helpButton.addEventListener('click', () => {
      if (this.helpModal) return;
      this.helpModal = new ReadingGuideModal(this.app, () => this.host.settings(), () => {
        this.helpModal = undefined;
        if (this.helpButton.isConnected) this.helpButton.focus({ preventScroll: true });
      });
      this.helpModal.open();
    });
    this.register(() => this.helpModal?.close());
    this.setToolbarLabels();
    this.feedback = this.contentEl.createDiv({ cls: 'bmd-feedback', attr: { role: 'status' } });
    this.summary = this.contentEl.createDiv({ cls: 'bmd-summary', attr: { 'aria-live': 'polite', role: 'status' } });
    this.body = this.contentEl.createDiv({ cls: 'bmd-diff-body' });
    this.registerDomEvent(this.contentEl.ownerDocument, 'copy', (event) => {
      const selection = this.contentEl.ownerDocument.getSelection();
      if (!selection?.rangeCount || !event.clipboardData) return;
      const text = selectedDiffText(this.body, selection.getRangeAt(0));
      if (text === undefined) return;
      event.clipboardData.clearData();
      event.clipboardData.setData('text/plain', text);
      event.preventDefault();
    });
    this.registerDomEvent(this.contentEl.ownerDocument, 'selectionchange', () => {
      if (this.pendingRender && !this.hasTextSelection()) this.render();
    });
    this.register(this.host.store.subscribe((path) => { if (path === this.path) this.render(); }));
    this.setFile(this.host.currentPath());
  }

  setFile(path: string | undefined): void {
    if (this.path !== path) {
      this.selected = 0; this.followedLine = undefined; this.rendered = undefined;
      this.refreshRequest = undefined; this.pendingRender = false;
      this.cards = []; this.items = []; this.body?.empty(); this.feedback?.empty(); this.summaryKey = undefined;
    }
    this.path = path;
    if (this.body) { this.updateRefreshButton(); this.render(); }
  }

  private async refreshCurrent(): Promise<void> {
    if (!this.path || this.refreshRequest) return;
    const request = this.refreshRequest = Symbol();
    this.updateRefreshButton();
    this.setFeedback('Checking the Git baseline…');
    try {
      await this.host.refresh(this.path);
      if (this.refreshRequest === request) this.setFeedback(this.pendingRender ? 'Content has changed. Finish selecting text to update the view.' : 'Git baseline refreshed.');
    } catch (error) {
      if (this.refreshRequest === request) {
        this.feedback.setText(error instanceof Error ? error.message : 'Refresh failed. Please try again.');
      }
    } finally {
      if (this.refreshRequest === request) { this.refreshRequest = undefined; this.updateRefreshButton(); }
    }
  }

  private setFeedback(text: string): void { this.feedback.setText(text); }

  private setToolbarLabels(): void {
    this.navigationEl.setAttribute('aria-label', 'Change navigation');
    for (const [button, label] of [[this.previous, 'Previous'], [this.next, 'Next'], [this.helpButton, 'Reading guide'], [this.refreshButton, 'Check HEAD and refresh the diff']] as const) {
      button.setAttribute('aria-label', label);
      button.title = label;
    }
  }

  private updateRefreshButton(): void {
    this.refreshButton.disabled = !this.path || !!this.refreshRequest;
    this.refreshButton.setText(this.refreshRequest ? 'Refreshing…' : 'Refresh');
    this.refreshButton.setAttribute('aria-busy', String(!!this.refreshRequest));
  }

  showLine(line: number, reveal = true, preferDeletion = false): void {
    this.followedLine = line;
    if (!this.rendered || this.pendingRender) return;
    if (preferDeletion) {
      const index = this.items.findIndex((item) => item.change.kind === 'deleted' && changeAnchor(item.change, this.rendered!.diff.lineCount) === line);
      if (index >= 0) { this.showChange(index, reveal); return; }
    }
    const location = findDiffLocation(this.rendered.diff, line);
    const data = location && this.rendered.diff.hunks[location.hunkIndex]?.rows[location.rowIndex];
    if (!data) return;
    let distance = Infinity;
    this.items.forEach((item, index) => {
      const start = changeAnchor(item.change, this.rendered!.diff.lineCount);
      const next = Math.max(start - line, line - Math.max(start, item.change.to - 1), 0);
      if (next < distance) { distance = next; this.selected = index; }
    });
    this.updateProgress();
    this.highlightRow(data, reveal);
  }

  private showChange(index: number, reveal = true): void {
    const item = this.items[index]!;
    this.selected = index;
    this.followedLine = changeAnchor(item.change, item.snapshot.diff.lineCount);
    this.updateProgress();
    this.highlightRow(item.change.rows.find((row) => row.kind === 'added') ?? item.change.rows[0]!, reveal);
  }

  private highlightRow(data: DiffRow, reveal: boolean): void {
    const row = this.rowElements.get(data);
    if (!row) return;
    this.clearCurrentRow();
    this.currentRow = row;
    row.addClass('bmd-row--current'); row.setAttribute('aria-current', 'location');
    const pair = this.rowPairs.get(data);
    this.pairedRow = pair && this.rowElements.get(pair);
    this.pairedRow?.addClass('bmd-row--paired');
    if (reveal) revealDiffRow(this.body, row, this.pairedRow);
  }

  move(direction: -1 | 1): boolean {
    if (!this.items.length) return false;
    return this.activateChange(this.items[(this.selected + direction + this.items.length) % this.items.length]);
  }

  private activateChange(item: ChangeItem | undefined): boolean {
    if (!item || !this.path || !this.rendered || this.pendingRender) return false;
    const index = this.items.indexOf(item);
    if (index < 0) return false;
    this.showChange(index, false);
    centerDiffChange(this.body, item.element);
    if (this.host.settings().followNavigation) this.host.navigate(this.path, changeAnchor(item.change, this.rendered.diff.lineCount), false, true);
    return true;
  }

  private updateProgress(): void {
    const index = this.items.length ? this.selected + 1 : 0;
    const progress = `Change ${index} / ${this.items.length}`;
    const label = this.items.length ? progress : 'No changes';
    this.progress.setText(progress);
    this.progress.setAttribute('aria-label', label);
    this.progress.title = label;
    this.previous.disabled = this.next.disabled = this.items.length < 2 || this.pendingRender;
    this.items.forEach((item, i) => item.element.toggleClass('bmd-change--selected', i === this.selected));
    this.cards.forEach((card) => {
      const selected = card.items.includes(this.items[this.selected]!);
      card.element.toggleClass('bmd-diff-region--selected', selected);
      card.heading.disabled = this.pendingRender;
      if (selected) card.heading.setAttribute('aria-current', 'location');
      else card.heading.removeAttribute('aria-current');
    });
  }

  private clearCurrentRow(): void {
    this.currentRow?.removeClass('bmd-row--current'); this.currentRow?.removeAttribute('aria-current'); this.currentRow = undefined;
    this.pairedRow?.removeClass('bmd-row--paired'); this.pairedRow = undefined;
  }

  private hasTextSelection(): boolean {
    const selection = this.contentEl.ownerDocument.getSelection();
    return !!selection && !selection.isCollapsed && !!selection.anchorNode && this.body.contains(selection.anchorNode);
  }

  private render(): void {
    const settings = this.host.settings();
    this.contentEl.style.setProperty('--bmd-font-size', `${settings.fontSize}px`);
    this.contentEl.toggleClass('bmd-no-inline-highlights', !settings.inlineHighlights);
    this.contentEl.toggleClass('bmd-hide-whitespace', !settings.showWhitespace);
    const state = this.path ? this.host.store.get(this.path) : undefined;
    if (state?.status === 'ready' && this.rendered && state !== this.rendered && this.hasTextSelection()) {
      this.pendingRender = true;
      this.setFeedback('Content has changed. Finish selecting text to update the view.');
      for (const item of this.items) { item.revert.disabled = true; item.jump.disabled = true; }
      this.updateProgress(); return;
    }
    if (this.pendingRender) { this.pendingRender = false; this.feedback.empty(); }
    if (state?.status !== 'ready') {
      this.cards = []; this.items = []; this.rendered = undefined; this.rowElements.clear(); this.rowPairs.clear(); this.clearCurrentRow();
      this.body.empty(); this.summaryKey = undefined;
      this.summary.empty();
      if (this.path) this.renderFileInfo(this.path);
      this.summary.createDiv({ cls: 'bmd-message', text: !this.path ? 'Open a Markdown note to view its Git diff.' : state?.status === 'error' ? state.message : 'Reading Git…' });
      this.updateProgress(); return;
    }
    const digits = String(Math.max(state.diff.lineCount, state.diff.lineCount - state.diff.added + state.diff.deleted)).length;
    this.contentEl.style.setProperty('--bmd-line-digits', `${Math.max(3, digits)}ch`);
    if (state !== this.rendered) this.reconcile(state);
    const summaryKey = JSON.stringify([this.path, state.baseline.head, state.baseline.isNew, state.diff.added, state.diff.deleted, settings.inlineHighlights, settings.showWhitespace, this.cards.some((card) => card.limited)]);
    if (summaryKey !== this.summaryKey) {
      this.summaryKey = summaryKey; this.summary.empty();
      const heading = this.summary.createDiv({ cls: 'bmd-summary-heading' });
      this.renderFileInfo(state.path, heading);
      const base = this.summary.createDiv({ cls: 'bmd-base' });
      const reference = base.createSpan({ cls: 'bmd-baseline-ref' });
      reference.createSpan({ text: 'HEAD' });
      reference.createEl('code', { cls: 'bmd-ref', text: state.baseline.head?.slice(0, 8) ?? 'no commits yet', attr: { title: state.baseline.head ?? 'no commits yet' } });
      base.createSpan({ cls: 'bmd-base-arrow', text: '→', attr: { 'aria-hidden': 'true' } });
      base.createSpan({ text: 'Current content' });
      if (state.baseline.isNew) base.createSpan({ cls: 'bmd-new-file', text: 'Newly tracked' });
      if (state.diff.added || state.diff.deleted) {
        const stats = heading.createDiv({ cls: 'bmd-stats', attr: { role: 'group', 'aria-label': `${state.diff.added} added lines, ${state.diff.deleted} deleted lines` } });
        if (state.diff.added) stats.createSpan({ cls: 'bmd-stat-added', text: `+${state.diff.added}`, attr: { title: `+${state.diff.added} added` } });
        if (state.diff.deleted) stats.createSpan({ cls: 'bmd-stat-deleted', text: `−${state.diff.deleted}`, attr: { title: `−${state.diff.deleted} deleted` } });
      }
      if (this.cards.some((card) => card.limited)) this.summary.createDiv({ cls: 'bmd-hint', text: 'Some changes exceed the refinement budget and use whole-line highlights. All added and deleted content is retained.' });
    }
    this.updateProgress();
  }

  private renderFileInfo(path: string, parent = this.summary): void {
    const parts = path.split('/');
    const name = parts.pop()!;
    const file = parent.createDiv({ cls: 'bmd-file-info', attr: { title: path } });
    file.createDiv({ cls: 'bmd-file', text: name });
    if (parts.length) file.createDiv({ cls: 'bmd-directory', text: parts.join(' / ') });
  }

  private renderEmptyState(): void {
    this.body.querySelector('.bmd-empty')?.remove();
    const empty = this.body.createDiv({ cls: 'bmd-empty', attr: { role: 'status' } });
    setIcon(empty.createSpan({ cls: 'bmd-empty-icon', attr: { 'aria-hidden': 'true' } }), 'check');
    const message = empty.createDiv();
    message.createEl('h3', { cls: 'bmd-empty-title', text: 'Matches HEAD' });
    message.createEl('p', { cls: 'bmd-empty-description', text: 'Keep editing this note. Changes will appear here automatically.' });
  }

  private reconcile(state: ReadyDiffState): void {
    const scroll = this.body.scrollTop;
    const selectedItem = this.items[this.selected];
    const changesByRow = new Map<DiffRow, LineChange>();
    for (const change of state.diff.changes) for (const row of change.rows) changesByRow.set(row, change);
    const buckets = new Map<string, HunkCard[]>();
    for (const card of this.cards) { const list = buckets.get(card.key) ?? []; list.push(card); buckets.set(card.key, list); }
    const plans = state.diff.hunks.map((hunk) => {
      // Coordinates may change without changing the source text or its highlighting.
      const key = JSON.stringify(hunk.rows.map((row) => [row.kind, row.text, row.noNewline]));
      return { hunk, key, card: buckets.get(key)?.shift() };
    });
    const highlights = highlightHunks(plans.filter((plan) => !plan.card).map((plan) => plan.hunk));
    this.clearCurrentRow(); this.rowElements.clear(); this.rowPairs.clear();
    for (const unused of buckets.values()) for (const card of unused) card.element.remove();
    this.body.querySelector('.bmd-empty')?.remove();
    this.cards = plans.map(({ hunk, key, card }, index) => {
      card ??= this.createCard(hunk, key, highlights, state, changesByRow);
      card.hunk = hunk;
      this.updateCardLabel(card);
      for (const item of card.items) {
        item.change = changesByRow.get(hunk.rows[item.rowIndex]!)!;
        item.snapshot = state; item.revert.disabled = false; item.jump.disabled = false;
      }
      hunk.rows.forEach((row, i) => {
        const element = card.rows[i]!;
        element.setAttribute('data-old-line', row.oldLine?.toString() ?? ''); element.setAttribute('data-new-line', row.newLine?.toString() ?? '');
        element.children[0]!.textContent = row.oldLine?.toString() ?? ''; element.children[1]!.textContent = row.newLine?.toString() ?? '';
        this.rowElements.set(row, element);
        const pair = card.pairs.get(i);
        if (pair !== undefined) this.rowPairs.set(row, hunk.rows[pair]!);
      });
      if (this.body.children[index] !== card.element) this.body.insertBefore(card.element, this.body.children[index] ?? null);
      return card;
    });
    this.items = this.cards.flatMap((card) => card.items);
    this.items.forEach((item, index) => this.updateItemLabels(item, index));
    this.selected = Math.max(0, selectedItem && this.items.includes(selectedItem) ? this.items.indexOf(selectedItem) : Math.min(this.selected, this.items.length - 1));
    this.rendered = state;
    if (!this.cards.length) this.renderEmptyState();
    this.body.scrollTop = scroll;
    if (this.followedLine !== undefined) this.showLine(this.followedLine, false);
  }

  private updateCardLabel(card: HunkCard): void {
    const current = card.hunk.rows.filter((row) => row.newLine !== null);
    const lines = current.length ? current.map((row) => row.newLine!) : card.hunk.rows.map((row) => row.oldLine!);
    const from = lines[0]!, to = lines[lines.length - 1]!;
    const range = current.length
      ? (from === to ? `Current line ${from}` : `Current lines ${from}–${to}`)
      : (from === to ? `HEAD line ${from}` : `HEAD lines ${from}–${to}`);
    const label = `${range} · ${card.items.length} ${card.items.length === 1 ? 'change' : 'changes'}`;
    card.heading.setText(label);
    card.heading.title = `${label}: Go to the first change in this block`;
    card.heading.setAttribute('aria-label', card.heading.title);
  }

  private updateItemLabels(item: ChangeItem, index: number): void {
    const range = changeRange(item.change);
    const label = `Change ${index + 1} · ${range}`;
    item.element.setAttribute('aria-label', label);
    item.jump.title = `Reveal change ${index + 1} in the editor: ${range}`;
    item.jump.setAttribute('aria-label', item.jump.title);
    item.revert.title = `Restore change ${index + 1}: ${range}`;
    item.revert.setAttribute('aria-label', item.revert.title);
  }

  private createCard(hunk: DiffHunk, key: string, highlights: InlineHighlights, snapshot: ReadyDiffState, changesByRow: Map<DiffRow, LineChange>): HunkCard {
    const element = this.body.createDiv({ cls: 'bmd-diff-region' });
    const heading = element.createEl('h3', { cls: 'bmd-region-heading' }).createEl('button', { cls: 'bmd-region-jump', attr: { type: 'button' } });
    const card: HunkCard = { key, element, heading, rows: [], pairs: new Map(), limited: highlights.limited, hunk, items: [] };
    heading.addEventListener('click', () => this.activateChange(card.items[0]));
    const itemsByChange = new Map<LineChange, ChangeItem>();
    const lines = element.createDiv({ cls: 'bmd-lines' });
    const positions = new Map(hunk.rows.map((row, i) => [row, i]));
    for (const row of pairDiffRows(hunk.rows, highlights.pairs)) {
      const index = positions.get(row)!;
      const change = changesByRow.get(row);
      let parent: HTMLElement = lines;
      if (change) {
        let item = itemsByChange.get(change);
        if (!item) {
          const element = lines.createEl('section', { cls: 'bmd-change' });
          const jump = element.createEl('button', { cls: 'bmd-line-number bmd-change-title', attr: { type: 'button' } });
          const revert = element.createEl('button', { cls: 'bmd-revert', attr: { type: 'button' } });
          setIcon(revert.createSpan({ attr: { 'aria-hidden': 'true' } }), 'undo-2');
          const entry: ChangeItem = { element, jump, revert, rowIndex: index, change, snapshot };
          jump.addEventListener('click', () => this.activateChange(entry));
          revert.addEventListener('click', () => this.host.revert(entry.snapshot, entry.change));
          item = entry; itemsByChange.set(change, entry); card.items.push(entry);
        }
        parent = item.element;
      }
      const line = parent.createDiv({ cls: `bmd-row bmd-row--${row.kind}` });
      card.rows[index] = line;
      const pair = highlights.pairs.get(row);
      if (pair) card.pairs.set(index, positions.get(pair)!);
      const oldNumber = line.createSpan({ cls: 'bmd-line-number', attr: { 'aria-hidden': 'true' } });
      const newNumber = line.createSpan({ cls: 'bmd-line-number', attr: { 'aria-hidden': 'true' } });
      const item = change && itemsByChange.get(change);
      if (item?.rowIndex === index) (row.oldLine !== null ? oldNumber : newNumber).replaceWith(item.jump);
      line.createSpan({ cls: 'bmd-sign', text: row.kind === 'added' ? '+' : row.kind === 'deleted' ? '−' : ' ' });
      const text = line.createEl('code', { cls: 'bmd-row-text' });
      renderHighlightedText(text, row, highlights.segments.get(row)!);
      if (row.noNewline) text.createSpan({ cls: 'bmd-no-newline', text: ' ⏎ no final newline' });
    }
    return card;
  }
}
