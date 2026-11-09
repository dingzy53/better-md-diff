import { describe, expect, it } from 'vitest';
import { DEFAULT_CHANGES_SETTINGS, normalizeChangesSettings } from '../../src/changes/settings';

describe('changes settings normalization', () => {
  it('returns defaults for missing or garbage input', () => {
    for (const value of [undefined, null, 'nope', 42, [], { showUntracked: 'yes', excludePatterns: 'x', showStatusBar: 1, collapsedFolders: {} }]) {
      expect(normalizeChangesSettings(value)).toEqual(DEFAULT_CHANGES_SETTINGS);
    }
  });

  it('type-checks booleans and keeps explicit false values', () => {
    expect(normalizeChangesSettings({ showUntracked: false, showStatusBar: false })).toMatchObject({
      showUntracked: false,
      showStatusBar: false,
    });
  });

  it('trims, de-duplicates and drops blank patterns without dropping the empty list', () => {
    expect(normalizeChangesSettings({ excludePatterns: ['  .obsidian/  ', '.obsidian/', '', '  ', 7, '**/*.tmp'] }))
      .toMatchObject({ excludePatterns: ['.obsidian/', '**/*.tmp'] });
    expect(normalizeChangesSettings({ excludePatterns: [] })).toMatchObject({ excludePatterns: [] });
  });

  it('normalizes and de-duplicates collapsed folders', () => {
    expect(normalizeChangesSettings({ collapsedFolders: ['a/b/', '/c', 'a/b', '\\d\\e', ''] }))
      .toMatchObject({ collapsedFolders: ['a/b', 'c', 'd/e'] });
  });

  it('accepts the vault config folder as a supplied default', () => {
    const defaults = { ...DEFAULT_CHANGES_SETTINGS, excludePatterns: ['my-config/'] };
    expect(normalizeChangesSettings({}, defaults).excludePatterns).toEqual(['my-config/']);
    expect(normalizeChangesSettings({ excludePatterns: [] }, defaults).excludePatterns).toEqual([]);
  });
});
