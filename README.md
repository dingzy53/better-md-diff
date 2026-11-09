# Uncommitted

[![Obsidian 1.8.0+](https://img.shields.io/badge/Obsidian-1.8.0%2B-7C3AED?logo=obsidian&logoColor=white)](https://obsidian.md)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Desktop only](https://img.shields.io/badge/platform-desktop-lightgrey)](#requirements)

A personal fork of [Better MD Diff](https://github.com/kamacheng/better-md-diff) that lists every file changed since the last commit.

<img src="docs/images/obsidian-demo.gif" alt="Edit a note, inspect a deletion, restore one change, and undo" width="560">

## Features

- **Changes list** in the left sidebar: a folder tree of every file that differs from `HEAD`.
- **Status badges:** `A` added, `M` modified, `D` deleted, `R` renamed, `U` untracked, `!` conflict.
- **One summary:** `N changes · +added −deleted` for the whole working tree.
- **Automatic refresh** on vault changes, window focus, or the refresh command. No timer polling.
- **Filters:** hide the config folder by default and add exclude patterns in settings.
- **Markdown diff:** open a changed note in the existing Better MD Diff panel, with per-change restore.
- **Plain diff:** canvas, PDF, image, audio, video, deleted, and other text files get a simple text or byte-size diff.
- **Discard:** return a file to `HEAD`, recreate a deleted file, or move an untracked file to the trash.
- **Read-only Git:** the plugin never stages, commits, or pushes.

The diff panel, editor flags, and per-change restore are upstream behavior. The changes list, badges, and plain diff view are this fork's additions.

## Requirements

- Desktop **Obsidian 1.8.0+**
- A local **Git** installation
- A vault folder that is the root of its Git repository

## Installation

This fork is not published to the Obsidian community directory. Build and install it locally:

```bash
git clone git@github.com:dingzy53/better-md-diff.git
cd better-md-diff
npm ci
npm run build
OBSIDIAN_VAULT=/path/to/your/vault npm run install:vault
```

Disable **Better MD Diff** in **Settings → Community plugins** before installing, then enable **Uncommitted**. The install script stops if Better MD Diff is enabled.

You can also copy `dist/uncommitted/` into `<vault>/.obsidian/plugins/uncommitted/` yourself.

> **Never enable both plugins.** Uncommitted keeps upstream's internal view type (`better-md-diff-view`) so the fork stays easy to merge, so Obsidian treats both plugins as registering the same view.

To keep the installed plugin out of your vault's Git history, add `.obsidian/plugins/uncommitted/` to the vault's `.gitignore`.

## Usage

Open the list with the **Git compare** ribbon icon, the **Open changes list** command, or the status bar item. It sits in the left sidebar next to the file explorer.

Clicking a file:

| File | Result |
| --- | --- |
| Markdown that exists | Opens the note and the diff panel |
| Canvas, PDF, image, audio, video | Opens the file and a plain-text diff |
| Other text file | Opens only the plain-text diff |
| Deleted file | Plain diff only; binary files show their old and new sizes |

Right-click a row to **Discard all changes**. The dialog names the file and the exact effect. Modified files return to `HEAD` in one editor transaction, so **Ctrl/Cmd+Z** undoes it, and staged changes stay staged. Deleted files are recreated. Added and untracked files go to Obsidian's trash. Renames and conflicts cannot be discarded here.

All commands are palette-only, with no default hotkeys:

- **Open changes list**
- **Refresh changes list**
- **Open next changed file** / **Open previous changed file**
- **Discard all changes in current file**
- **Compare the current document with HEAD**
- **Refresh Git diff**
- **Go to next change** / **Go to previous change**
- **Toggle editor diff markers**

## Privacy and security

- **Network use:** none. The plugin makes no requests and collects no telemetry.
- **Files outside the vault:** none. The plugin reads vault files, Git metadata, and its own `data.json`.
- **`child_process`:** the plugin runs the local Git executable through `execFile` with `shell: false` and a read-only command set.
- **`fs`:** used only to resolve real paths before reading a Git baseline.
- **Clipboard:** the plugin never reads or writes the system clipboard. It only filters the text of a copy selection inside the diff panel.
- **Writes:** settings and the discard action are the only writes. Discard changes the working tree and may move a file to Obsidian's trash after confirmation.

## Limitations

- **Desktop only.** The plugin needs a local Git executable and a filesystem vault.
- **Repository root.** A vault inside a larger repository is rejected with an explanatory message.
- **No Git writes.** Staging, commits, pulls, and pushes are left to a terminal.
- **No release workflow.** This personal fork has no tags, releases, or community submission.
- **Upstream review is not wired in.** The accepted-baseline review modules and GitLab comparison remain unused.

## Development

Use Node.js 22.12+ or 24+ and npm:

```bash
npm ci
npm run check
npm run dev
```

`npm run check` runs ESLint with zero warnings, the test suite, strict TypeScript checking, the production build, and release validation. Tests use temporary Git repositories and a mocked Obsidian boundary.

New code lives in `src/changes/` and `tests/changes/`. Do not reformat or reorder upstream code; see [AGENTS.md](AGENTS.md) for the merge rules.

### Releasing

There is no release workflow and no tag. Build `dist/uncommitted/` and install it locally with `npm run install:vault`.

## Credits

[Better MD Diff](https://github.com/kamacheng/better-md-diff) by kamacheng, used under the MIT license.

The demo uses the opening of Jane Austen's *Pride and Prejudice* (1813), public domain in the USA: [Project Gutenberg](https://www.gutenberg.org/ebooks/1342).

## License

[MIT](LICENSE) © 2026 Ding Zheng Yuan. The bundled `diff` dependency uses BSD-3-Clause; its license is included in the build.
