import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type { ChangesController } from './controller';
import type { ChangedFile } from './types';

export const CHANGES_VIEW = 'uncommitted-changes-view';
export const CHANGES_ICON = 'git-compare';

export interface ChangesViewHost {
  controller: ChangesController;
  open(file: ChangedFile): void;
}

/** Left-sidebar list; the full tree is built in the next phase. */
export class ChangesView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private readonly host: ChangesViewHost) {
    super(leaf);
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
    this.contentEl.createDiv({ cls: 'unc-changes-loading', text: 'Loading changes…' });
  }
}
