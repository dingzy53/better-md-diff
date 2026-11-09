// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Setting as ObsidianSetting } from 'obsidian';
import { DEFAULT_CHANGES_SETTINGS, changesSettingGroup } from '../../src/changes/settings';
import type { ChangesSettings } from '../../src/changes/types';
import { Setting } from '../helpers/obsidian-setting';
import { installObsidianDom } from '../helpers/obsidian-dom';

installObsidianDom(document);

async function flush(): Promise<void> {
  for (let index = 0; index < 6; index++) await Promise.resolve();
}

function render(changes = {}) {
  const plugin = {
    changesSettings: { ...DEFAULT_CHANGES_SETTINGS, ...changes } as ChangesSettings,
    saveChangesSettings: vi.fn(async () => {}),
  };
  const container = document.createElement('div');
  for (const item of changesSettingGroup(plugin).items) {
    const setting = new Setting(container).setName(item.name).setDesc(item.desc);
    item.render?.(setting as unknown as ObsidianSetting);
  }
  return { plugin, container };
}

describe('changes list settings group', () => {
  it('is one group with the three documented controls', () => {
    const group = changesSettingGroup({ changesSettings: { ...DEFAULT_CHANGES_SETTINGS }, saveChangesSettings: async () => {} });
    expect(group.type).toBe('group');
    expect(group.heading).toBe('Changes list');
    expect(group.items.map((item) => item.name)).toEqual([
      'Show untracked files',
      'Exclude patterns',
      'Show change count in status bar',
    ]);
    expect(group.items[1]?.desc).toContain('A trailing / hides a folder');
  });

  it('saves the untracked toggle immediately', async () => {
    const { plugin, container } = render();
    const toggle = container.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    expect(toggle.checked).toBe(true);
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    await flush();
    expect(plugin.changesSettings.showUntracked).toBe(false);
    expect(plugin.saveChangesSettings).toHaveBeenCalledTimes(1);
  });

  it('saves exclude patterns on change and blur without saving an unchanged value twice', async () => {
    const { plugin, container } = render({ excludePatterns: ['old/'] });
    const area = container.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(area.value).toBe('old/');
    area.value = '  drafts/  \n\n**/*.tmp\n# comment\n';
    area.dispatchEvent(new Event('change'));
    await flush();
    expect(plugin.changesSettings.excludePatterns).toEqual(['drafts/', '**/*.tmp', '# comment']);
    expect(plugin.saveChangesSettings).toHaveBeenCalledTimes(1);

    area.dispatchEvent(new Event('blur'));
    await flush();
    expect(plugin.saveChangesSettings).toHaveBeenCalledTimes(1);
  });

  it('saves the status bar toggle', async () => {
    const { plugin, container } = render();
    const toggles = container.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    const status = toggles[1]!;
    expect(status.checked).toBe(true);
    status.checked = false;
    status.dispatchEvent(new Event('change'));
    await flush();
    expect(plugin.changesSettings.showStatusBar).toBe(false);
  });
});
