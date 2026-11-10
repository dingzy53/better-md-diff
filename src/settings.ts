import { PluginSettingTab, Setting, type App } from 'obsidian';
import type BetterMdDiff from './main';
import { DEFAULT_SETTINGS, SETTING_CHOICES } from './options';
// fork: changes list settings
import { changesSettingGroup } from './changes/settings';

type ToggleKey = 'showMarkers' | 'inlineHighlights' | 'showWhitespace' | 'followEditor' | 'followNavigation';
type SettingRow = { name: string; desc?: string } & ({ render: (setting: Setting) => void } | { render?: never });
type SettingSection = { type: 'group'; heading: string; items: SettingRow[] };

export class DiffSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: BetterMdDiff) { super(app, plugin); }

  // 1.13+ uses these definitions for rendering and search. No I/O during indexing.
  getSettingDefinitions(): SettingSection[] {
    const toggle = (key: ToggleKey, name: string, desc?: string): SettingRow => ({ name, desc,
      render: (setting) => { setting.addToggle((control) => control.setValue(this.plugin.settings[key]).onChange(async (value) => {
        this.plugin.settings[key] = value;
        await this.plugin.applySettings();
      })); },
    });
    const choice = (key: keyof typeof SETTING_CHOICES, name: string, desc?: string, unit = ''): SettingRow => ({ name, desc,
      render: (setting) => { setting.addDropdown((control) => {
        const current = this.plugin.settings[key];
        const values = [...new Set([...SETTING_CHOICES[key], current])].sort((left, right) => left - right);
        for (const value of values) control.addOption(String(value), `${value.toLocaleString('en-US')}${unit}`);
        control.setValue(String(current)).onChange(async (value) => {
          this.plugin.settings[key] = Number(value);
          await this.plugin.applySettings();
        });
      }); },
    });
    return [
      { type: 'group', heading: 'Appearance', items: [
        toggle('showMarkers', 'Show diff markers in the editor', 'Source mode and Live Preview only.'),
        choice('fontSize', 'Diff font size', undefined, ' px'),
        choice('contextLines', 'Context lines', 'Unchanged lines shown around each change.'),
        toggle('inlineHighlights', 'Highlight changed text'),
        toggle('showWhitespace', 'Show changed whitespace', 'Spaces as ·, tabs as →.'),
      ] },
      { type: 'group', heading: 'Navigation', items: [
        toggle('followEditor', 'Follow editor selection', 'An open diff panel scrolls with the editor.'),
        toggle('followNavigation', 'Follow panel navigation in the editor', 'Jumping to a change in the panel also reveals it in the note.'),
      ] },
      { type: 'group', heading: 'Advanced', items: [
        choice('editDelayMs', 'Refresh delay after editing', undefined, ' ms'),
        choice('gitPollSeconds', 'Git polling interval', undefined, ' s'),
        choice('maxFileMiB', 'Document size limit', 'Larger notes are not compared.', ' MiB'),
        choice('maxLines', 'Document line limit', 'Longer notes are not compared.', ' lines'),
        { name: 'Git executable', desc: 'A name on PATH or a full path.', render: (setting) => {
          setting.addText((text) => {
            text.setPlaceholder(DEFAULT_SETTINGS.gitPath).setValue(this.plugin.settings.gitPath);
            text.inputEl.addEventListener('change', () => {
              this.plugin.settings.gitPath = text.getValue().trim() || 'git';
              void this.plugin.applySettings();
            });
          });
        } },
      ] },
      // fork: one "Changes list" group, rendered by both settings code paths.
      changesSettingGroup(this.plugin),
    ];
  }

  // Obsidian 1.8–1.12 fallback, rendered from the same definitions to prevent drift.
  display(): void { this.renderLegacy(); }

  renderLegacy(): void {
    this.containerEl.empty();
    for (const section of this.getSettingDefinitions()) {
      new Setting(this.containerEl).setName(section.heading).setHeading();
      for (const item of section.items) {
        const setting = new Setting(this.containerEl).setName(item.name);
        if (item.desc) setting.setDesc(item.desc);
        item.render?.(setting);
      }
    }
  }
}
