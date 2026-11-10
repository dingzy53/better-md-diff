// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, Setting as HostSetting } from 'obsidian';
import type BetterMdDiff from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/options';
import { DEFAULT_CHANGES_SETTINGS } from '../src/changes/settings';

import { Setting } from './helpers/obsidian-setting';
import { installObsidianDom } from './helpers/obsidian-dom';

installObsidianDom(document);
vi.mock('obsidian', () => import('./helpers/obsidian-setting'));
const { DiffSettingTab } = await import('../src/settings');

function setup() {
  const host = {
    settings: { ...DEFAULT_SETTINGS },
    changesSettings: { ...DEFAULT_CHANGES_SETTINGS },
    applySettings: vi.fn(async () => { host.settings = normalizeSettings(host.settings); }),
    saveChangesSettings: vi.fn(async () => {}),
  };
  const tab = new DiffSettingTab({} as App, host as unknown as BetterMdDiff);
  return { tab, host };
}

describe('searchable settings with legacy support', () => {
  it('uses English labels without exposing a language override', () => {
    const { tab } = setup();
    const definitions = tab.getSettingDefinitions();
    expect(definitions[0]?.heading).toBe('Appearance');
    expect(definitions[0]?.items[0]?.name).toBe('Show diff markers in the editor');
    expect(definitions.flatMap((group) => group.items).some((row) => /language/i.test(row.name))).toBe(false);
  });

  it.each(['legacy', 'declarative'])('renders and persists controls through the %s host path', async (mode) => {
    const { tab, host } = setup();
    if (mode === 'legacy') tab.display();
    else for (const section of tab.getSettingDefinitions()) {
      for (const item of section.items) {
        const setting = new Setting(tab.containerEl).setName(item.name).setDesc(item.desc ?? '');
        item.render?.(setting as unknown as HostSetting);
      }
    }
    expect(tab.containerEl.querySelectorAll('input')).toHaveLength(8);
    expect(tab.containerEl.querySelectorAll('input[type=range]')).toHaveLength(0);
    const selects = Array.from(tab.containerEl.querySelectorAll('select'));
    expect(selects).toHaveLength(6);
    const toggle = tab.containerEl.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    expect(toggle.checked).toBe(true);
    toggle.checked = false; toggle.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(host.settings.showMarkers).toBe(false));
    const [font, context, delay, poll, bytes, lines] = selects as [HTMLSelectElement, HTMLSelectElement, HTMLSelectElement, HTMLSelectElement, HTMLSelectElement, HTMLSelectElement];
    expect(font.value).toBe('13');
    expect(Array.from(font.options).map((option) => option.textContent)).toEqual(['10 px', '11 px', '12 px', '13 px', '14 px', '15 px', '16 px', '17 px', '18 px', '19 px', '20 px', '21 px', '22 px']);
    font.value = '18'; font.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(host.settings.fontSize).toBe(18));
    expect(Array.from(context.options).map((option) => option.value)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    context.value = '0'; context.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(host.settings.contextLines).toBe(0));
    expect([delay.value, poll.value]).toEqual(['350', '5']);
    const git = tab.containerEl.querySelector<HTMLInputElement>('input[type=text]')!;
    git.value = '  /usr/bin/git  '; git.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(host.settings.gitPath).toBe('/usr/bin/git'));
    git.value = ' '; git.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(host.settings.gitPath).toBe('git'));
    bytes.value = '10'; bytes.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(host.settings.maxFileMiB).toBe(10));
    expect(Array.from(lines.options).map((option) => option.textContent)).toContain('20,000 lines');
    lines.value = '100000'; lines.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(host.settings.maxLines).toBe(100000));
    expect(host.applySettings).toHaveBeenCalledTimes(7);
  });

  it('keeps a stored value that is not one of the presets', () => {
    const { tab, host } = setup();
    host.settings.editDelayMs = 650;
    tab.display();
    const delay = tab.containerEl.querySelectorAll('select')[2]!;
    expect(delay.value).toBe('650');
    expect(Array.from(delay.options).map((option) => option.value)).toEqual(['100', '200', '350', '500', '650', '1000', '2000']);
  });

  it('keeps descriptions short and drops rows that are not settings', () => {
    const { tab } = setup();
    const rows = tab.getSettingDefinitions().flatMap((group) => group.items);
    for (const row of rows) expect((row.desc ?? '').length).toBeLessThanOrEqual(80);
    expect(rows.every((row) => typeof row.render === 'function')).toBe(true);
  });

  it('exposes every setting in named searchable groups without I/O', () => {
    const { tab, host } = setup();
    const definitions = tab.getSettingDefinitions();
    expect(definitions.map((group) => group.heading)).toEqual(['Appearance', 'Navigation', 'Advanced', 'Changes list']);
    expect(definitions.flatMap((group) => group.items.map((item) => item.name))).toEqual([
      'Show diff markers in the editor', 'Diff font size', 'Context lines', 'Highlight changed text', 'Show changed whitespace',
      'Follow editor selection', 'Follow panel navigation in the editor', 'Refresh delay after editing', 'Git polling interval',
      'Document size limit', 'Document line limit', 'Git executable',
      'Show untracked files', 'Exclude patterns', 'Show change count in status bar',
    ]);
    expect(host.applySettings).not.toHaveBeenCalled();
  });
});
