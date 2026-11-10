import type { Setting } from 'obsidian';
import type { ChangesSettings } from './types';

type ChangesSettingRow = { name: string; desc?: string } & ({ render: (setting: Setting) => void } | { render?: never });

export interface ChangesSettingSection {
  type: 'group';
  heading: string;
  items: ChangesSettingRow[];
}

/** Only the plugin members this section needs; keeps the module free of main.ts. */
export interface ChangesSettingsHost {
  changesSettings: ChangesSettings;
  saveChangesSettings(): Promise<void>;
}

export const DEFAULT_CHANGES_SETTINGS: ChangesSettings = {
  showUntracked: true,
  // The real default is the vault's configured config folder (Vault#configDir),
  // supplied by the plugin; this stays empty so no path is hard-coded here.
  excludePatterns: [],
  showStatusBar: true,
  collapsedFolders: [],
};

function stringList(value: unknown, fallback: string[], normalize: (entry: string) => string): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const normalized = normalize(entry.trim());
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function normalizeChangesSettings(value: unknown, defaults: ChangesSettings = DEFAULT_CHANGES_SETTINGS): ChangesSettings {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    showUntracked: typeof input.showUntracked === 'boolean' ? input.showUntracked : defaults.showUntracked,
    excludePatterns: stringList(input.excludePatterns, defaults.excludePatterns, (entry) => entry),
    showStatusBar: typeof input.showStatusBar === 'boolean' ? input.showStatusBar : defaults.showStatusBar,
    collapsedFolders: stringList(input.collapsedFolders, defaults.collapsedFolders,
      (entry) => entry.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')),
  };
}

/**
 * The "Changes list" settings group. Uses the same definition shape as the
 * upstream settings tab, which renders it in the 1.13+ search UI and in the
 * legacy fallback.
 */
export function changesSettingGroup(plugin: ChangesSettingsHost): ChangesSettingSection {
  return {
    type: 'group',
    heading: 'Changes list',
    items: [
      {
        name: 'Show untracked files',
        render: (setting) => {
          setting.addToggle((toggle) => toggle.setValue(plugin.changesSettings.showUntracked).onChange(async (value) => {
            plugin.changesSettings.showUntracked = value;
            await plugin.saveChangesSettings();
          }));
        },
      },
      {
        name: 'Exclude patterns',
        desc: 'One path per line. A trailing / hides a folder; * and ** are wildcards.',
        render: (setting) => {
          setting.addTextArea((area) => {
            area.setValue(plugin.changesSettings.excludePatterns.join('\n'));
            area.setPlaceholder('Folder/');
            const save = (): void => {
              const patterns = area.getValue().split('\n').map((line) => line.trim()).filter(Boolean);
              if (patterns.join('\n') === plugin.changesSettings.excludePatterns.join('\n')) return;
              plugin.changesSettings.excludePatterns = patterns;
              void plugin.saveChangesSettings();
            };
            area.inputEl.addEventListener('change', save);
            area.inputEl.addEventListener('blur', save);
          });
        },
      },
      {
        name: 'Show change count in status bar',
        render: (setting) => {
          setting.addToggle((toggle) => toggle.setValue(plugin.changesSettings.showStatusBar).onChange(async (value) => {
            plugin.changesSettings.showStatusBar = value;
            await plugin.saveChangesSettings();
          }));
        },
      },
    ],
  };
}
