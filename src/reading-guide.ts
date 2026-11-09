import { Modal, type App } from 'obsidian';
import type { DiffSettings } from './options';

/** Read-only help uses the host's dialog/focus handling, never the diff's scrolling area. */
export class ReadingGuideModal extends Modal {
  constructor(app: App, private settings: () => DiffSettings, private closed: () => void) { super(app); }

  onOpen(): void {
    this.titleEl.addClass('bmd-guide-title');
    this.contentEl.addClass('bmd-reading-guide');
    this.render();
  }

  private render(): void {
    const settings = this.settings();
    const restoreFocus = this.contentEl.contains(this.contentEl.ownerDocument.activeElement);
    this.titleEl.setText('Reading guide');
    this.contentEl.empty();
    this.contentEl.createEl('p', { text: 'Navigation counts individual changes. Block headings show the line range and number of changes inside; unchanged content between blocks is omitted.' });
    this.contentEl.createEl('p', { text: 'Contiguous changes form one item. Restore items independently; context is for reading only.' });
    this.contentEl.createEl('p', { text: 'Red text is old content; green text is added content. Old and new lines are paired, with HEAD and current line-number columns. '
      + (settings.inlineHighlights ? 'Deeper colors highlight changed text. ' : '')
      + (settings.showWhitespace ? '· marks spaces; → marks tabs. ' : '')
      + 'Select text to copy original Markdown.' });
    if (settings.showMarkers) this.contentEl.createEl('p', { text: 'Editor flags +n and ~n count current added or modified lines; rails show their ranges. −n counts deleted old lines and marks only their boundary. Rendered or folded blocks show the first change flag; see the diff panel for exact ranges.' });
    this.contentEl.createEl('p', { text: 'Click a block heading to select its first change, or a changed line number to select that change. Source navigation follows the navigation preference; body text remains selectable, and each restore arrow affects only its own change.' });
    this.contentEl.createEl('p', { cls: 'bmd-hint', text: 'No staging, commits, or file deletion. The document must be open in editing mode. Undo in the source editor with Ctrl/Cmd+Z.' });
    const actions = this.contentEl.createDiv({ cls: 'bmd-guide-actions' });
    const close = actions.createEl('button', { cls: 'bmd-guide-close', text: 'Close', attr: { type: 'button' } });
    close.addEventListener('click', () => this.close());
    if (restoreFocus) close.focus({ preventScroll: true });
  }

  onClose(): void {
    this.contentEl.empty();
    this.closed();
  }
}
