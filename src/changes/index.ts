import { Notice, type Plugin } from 'obsidian';
import type { DiffSettings } from '../options';
import { ChangesController } from './controller';
import { CHANGES_ICON, CHANGES_VIEW, ChangesView } from './changes-view';
import { openChangedFile } from './open';
import { PLAIN_DIFF_VIEW, PlainDiffView } from './plain-diff-view';
import type { ChangedFile, ChangesSettings, ChangesState } from './types';

export interface ChangesDeps {
  openDiff(path: string): Promise<void>;
  /** Absolute filesystem path of the vault, which must be the repository root. */
  vaultRoot: string;
  settings(): DiffSettings;
  changesSettings(): ChangesSettings;
  saveChangesSettings(): Promise<void>;
  saveCollapsedFolders(paths: string[]): Promise<void>;
}

interface SettingsHost {
  setting?: { open(): void; openTabById?(id: string): void };
}

function statusText(state: ChangesState): string {
  if (state.status === 'ready') {
    const count = state.set.files.length;
    return count === 0 ? 'Git: no changes' : `Git: ${count} change${count === 1 ? '' : 's'}`;
  }
  if (state.status === 'error') return 'Git: error';
  return 'Git: loading';
}

/**
 * Single entry point called from the plugin's `onload`. Registers the view,
 * ribbon, status bar and commands; returns the controller so the plugin can
 * react to settings changes.
 */
export function installChanges(plugin: Plugin, deps: ChangesDeps): ChangesController {
  const controller = new ChangesController({
    app: plugin.app,
    vaultRoot: deps.vaultRoot,
    settings: () => deps.settings(),
    changesSettings: () => deps.changesSettings(),
    saveChangesSettings: () => deps.saveChangesSettings(),
    saveCollapsedFolders: (paths) => deps.saveCollapsedFolders(paths),
  });

  const openList = async (): Promise<void> => {
    await plugin.app.workspace.ensureSideLeaf(CHANGES_VIEW, 'left', { active: true, reveal: true });
  };

  const openPlainDiff = async (path: string): Promise<void> => {
    const leaf = await plugin.app.workspace.ensureSideLeaf(PLAIN_DIFF_VIEW, 'right', { active: true, reveal: true, state: { path } });
    if (leaf.view instanceof PlainDiffView) await leaf.view.setPath(path);
  };

  const openChanged = (file: ChangedFile): void => {
    void openChangedFile(file, { app: plugin.app, openDiff: (path) => deps.openDiff(path), openPlainDiff })
      .catch((error: unknown) => { new Notice(error instanceof Error ? error.message : 'Unable to open this file.'); });
  };

  const openSettings = (): void => {
    const host = plugin.app as typeof plugin.app & SettingsHost;
    host.setting?.open();
    host.setting?.openTabById?.(plugin.manifest.id);
  };

  plugin.addChild(controller);
  controller.load(); // Idempotent: addChild already loads it when the plugin is loaded.
  plugin.registerView(CHANGES_VIEW, (leaf) => new ChangesView(leaf, {
    controller,
    open: openChanged,
    discard: () => new Notice("Discard isn't available yet."),
    openSettings,
  }));
  plugin.registerView(PLAIN_DIFF_VIEW, (leaf) => new PlainDiffView(leaf, {
    controller,
    app: plugin.app,
    settings: () => deps.settings(),
  }));
  plugin.addRibbonIcon(CHANGES_ICON, 'Open changes list', () => { void openList(); });

  plugin.addCommand({
    id: 'open-changes-list',
    name: 'Open changes list',
    callback: () => { void openList(); },
  });
  plugin.addCommand({
    id: 'refresh-changes-list',
    name: 'Refresh changes list',
    callback: () => { void controller.refreshNow(); },
  });
  for (const direction of [1, -1] as const) {
    plugin.addCommand({
      id: direction === 1 ? 'open-next-changed-file' : 'open-previous-changed-file',
      name: direction === 1 ? 'Open next changed file' : 'Open previous changed file',
      checkCallback: (checking) => {
        if (!controller.files().length) return false;
        if (!checking) {
          const file = controller.adjacent(direction);
          if (file) openChanged(file);
        }
        return true;
      },
    });
  }

  const status = plugin.addStatusBarItem();
  status.addClass('unc-status');
  status.setAttribute('role', 'button');
  status.setAttribute('tabindex', '0');
  const updateStatus = (): void => {
    status.toggleClass('unc-status-hidden', !deps.changesSettings().showStatusBar);
    const state = controller.getState();
    const text = statusText(state);
    status.setText(text);
    status.setAttribute('aria-label', `${text}. Open changes list.`);
    status.title = state.status === 'error' ? state.message : 'Open changes list';
  };
  plugin.registerDomEvent(status, 'click', () => { void openList(); });
  plugin.registerDomEvent(status, 'keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void openList();
    }
  });
  plugin.register(controller.subscribe(updateStatus));
  plugin.register(() => status.remove());
  updateStatus();

  return controller;
}
