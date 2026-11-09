import { PluginSettingTab, Setting, type App } from 'obsidian';
import type BetterMdDiff from './main';
import { DEFAULT_SETTINGS, SETTING_LIMITS } from './options';
// fork: changes list settings
import { changesSettingGroup } from './changes/settings';

type ToggleKey = 'showMarkers' | 'inlineHighlights' | 'showWhitespace' | 'followEditor' | 'followNavigation';
type SettingRow = { name: string; desc: string } & ({ render: (setting: Setting) => void } | { render?: never });
type SettingSection = { type: 'group'; heading: string; items: SettingRow[] };

export class DiffSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: BetterMdDiff) { super(app, plugin); }

  // 1.13+ uses these definitions for rendering and search. No I/O during indexing.
  getSettingDefinitions(): SettingSection[] {
    const toggle = (key: ToggleKey, name: string, desc: string): SettingRow => ({ name, desc,
      render: (setting) => { setting.addToggle((control) => control.setValue(this.plugin.settings[key]).onChange(async (value) => {
        this.plugin.settings[key] = value;
        await this.plugin.applySettings();
      })); },
    });
    const slider = (key: keyof typeof SETTING_LIMITS, name: string, desc: string, unit: string): SettingRow => ({ name, desc,
      render: (setting) => {
        const describe = () => setting.setDesc(`${desc} Current: ${this.plugin.settings[key]} ${unit}.`);
        describe();
        const [min, max, step] = SETTING_LIMITS[key];
        setting.addSlider((control) => control.setLimits(min, max, step).setValue(this.plugin.settings[key]).onChange(async (value) => {
          this.plugin.settings[key] = value;
          describe();
          await this.plugin.applySettings();
        }));
      },
    });
    return [
      { type: 'group', heading: 'Appearance', items: [
        toggle('showMarkers', 'Show diff markers in the editor', 'Show markers in source mode and Live Preview, never in reading mode. The diff panel remains available when disabled.'),
        slider('fontSize', 'Diff panel font size', 'Adjust diff text and line numbers without affecting the source editor or other plugins.', 'px'),
        slider('contextLines', 'Context lines', 'Unchanged lines around each change. This affects reading only, never restoration scope. 0 shows changes only.', 'lines'),
        toggle('inlineHighlights', 'Highlight changed text', 'Use deeper red and green highlights for changed text. Disabling this keeps line highlights and old/new pairing.'),
        toggle('showWhitespace', 'Show changed whitespace', 'Show changed spaces as ·, tabs as →, and label empty lines. Copying still yields original Markdown.'),
      ] },
      { type: 'group', heading: 'Navigation', items: [
        toggle('followEditor', 'Follow editor selection', 'Follow the editor in an already open panel without taking focus or opening a panel automatically.'),
        toggle('followNavigation', 'Follow panel navigation in the editor', 'Previous/next buttons, block headings and changed line numbers also reveal the source. Visible documents keep their mode and button focus.'),
      ] },
      { type: 'group', heading: 'Refresh', items: [
        slider('editDelayMs', 'Refresh delay after editing', 'Delay after the last edit before updating the diff. Lower values refresh sooner.', 'ms'),
        slider('gitPollSeconds', 'Git polling interval', 'Check HEAD and tracking status for open documents. Returning to the app or refreshing manually also checks Git.', 'seconds'),
      ] },
      { type: 'group', heading: 'Git and restoration', items: [
        slider('maxFileMiB', 'Document size limit', 'Measured in UTF-8 bytes per version. Higher limits can increase memory usage and UI stalls; the diff timeout remains enabled.', 'MiB'),
        slider('maxLines', 'Document line limit', 'Applies separately to HEAD and current content, including the empty line after a final newline. Raising this limit does not guarantee completion of large diffs.', 'lines'),
        { name: 'Git executable', desc: 'Use git from PATH, or enter its full executable path without arguments or quotes.', render: (setting) => {
          setting.addText((text) => {
            text.setPlaceholder(DEFAULT_SETTINGS.gitPath).setValue(this.plugin.settings.gitPath);
            text.inputEl.addEventListener('change', () => {
              this.plugin.settings.gitPath = text.getValue().trim() || 'git';
              void this.plugin.applySettings();
            });
          });
        } },
        { name: 'Restoration safety', desc: 'The baseline is HEAD. Git operations are read-only: no staging or commits. Only a confirmed change restoration edits the buffer; confirmation and freshness checks cannot be disabled.' },
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
        const setting = new Setting(this.containerEl).setName(item.name).setDesc(item.desc);
        item.render?.(setting);
      }
    }
  }
}
