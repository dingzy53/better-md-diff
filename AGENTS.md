# AGENTS.md

## What this repo is

Uncommitted is a fork of Better MD Diff that adds a left-sidebar list of files changed since `HEAD`.
The upstream diff panel, editor flags, and per-change restore remain in place.
The plugin is released from this repository. The owner submits it to the Obsidian community directory.

## Hard rules

- Never push to, open issues or pull requests against, or comment on the upstream repository.
  The `upstream` remote is fetch-only; its push URL stays `DISABLED`.
- Only the owner submits or manages the plugin at community.obsidian.md. Never do it for them, and never open pull requests against `obsidianmd/obsidian-releases`.
- Push to `origin`, tags, and GitHub releases only when the owner asks in this session.
- Never add network requests, telemetry, or analytics.
- Never install a build into the owner's real vault. Use an isolated test vault.
- Keep Git operations in the plugin read-only: status, diff, ls-files, ls-tree, cat-file, rev-parse.
- Do not wire `src/review.ts` or `src/review-storage.ts` into the plugin. They are unused upstream groundwork.

## English only

All UI, documentation, comments, scripts, commit messages, and test descriptions are English.
Do not add Chinese text or translation plumbing.
Unicode coverage is still expected: use Latin text with accents and emoji in tests, not Han characters.

## Layout

- `src/changes/` and `tests/changes/` contain the fork's changes list.
- New CSS goes in the delimited block at the end of `styles.css`.
- `src/errors.ts` holds the single error type. Do not reintroduce an i18n module.
- `src/main.ts` is the only integration point for the changes list.
- The changes list builds Obsidian's generic tree markup (`tree-item`, `tree-item-self`, `collapse-icon`, `tree-item-flair`, `nav-header`, `pane-empty`).
  Never use the file explorer's `nav-file*` or `nav-folder*` classes; themes, other plugins, and `scripts/host-smoke.py` target them.

## Keep the fork mergeable

- Do not reformat, rename, or reorder upstream code.
- Keep edits to upstream files small and listed here:
  - `src/main.ts`: install the changes list and hook its settings.
  - `src/settings.ts`: append the **Changes list** group.
  - `styles.css`: append one delimited changes-list block.
  - `package.json`: add the `install:vault` script.
  - UI files: English literals replace upstream's `t()` calls and `src/i18n.ts` is removed.
  - `tests/helpers/obsidian.ts` and `tests/helpers/obsidian-setting.ts`: host-boundary stubs for the new tests.
- To sync: `git fetch upstream && git merge upstream/main`, resolve only these touch points, then `npm ci && npm run check`.

## Settings tab

Keep it compact: dropdowns of presets instead of sliders, a description only when the name is not enough, and no rows without a control.

## Obsidian rules

Use `this.app`, never the global `app`.
Build DOM with `createEl` helpers; never use `innerHTML`.
Use sentence case for UI text.
No default hotkeys.
Register every interval, event, and child for cleanup.
Use the Editor API for open notes and `Vault.process` otherwise.
Use `FileManager.trashFile` for deletions.
Use `getFileByPath`, not `getFiles().find`.
Use `normalizePath` for user paths.
Style with CSS classes and Obsidian CSS variables; no inline styles.
Keep `isDesktopOnly: true` and `minAppVersion: 1.8.0`.

## Releasing

- Use a tag that exactly matches `manifest.json`, without a `v` prefix.
- `.github/workflows/release.yml` builds, attests, and publishes `main.js`, `manifest.json`, and `styles.css`.
- The community directory reads `manifest.json` at the head of `main` and installs from the release whose tag matches its version.
  Keep `main` and the latest release on the same version.
- Follow Obsidian's developer policies: disclose network use, outside-vault access, accounts, and payment in the README, and keep the credit to the original author.
- Push the workflow before the first tag so the tag can trigger it.
- Keep the release assets unchanged after the workflow publishes them.

## Workflow

- Node.js 22.12+ or 24+. Run `npm ci` first.
- `npm run check` must pass with zero warnings before every commit.
- One logical change per commit. Use an imperative subject.
- Keep version, manifest, lockfile, and `versions.json` in sync.
- The README layout is the one used by the owner's other plugin repos: features, requirements, installation, usage, privacy, limitations, development, license.
