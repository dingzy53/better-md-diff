import type { ChangesSettings } from './types';

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
