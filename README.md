# Uncommitted

> **Personal fork.** Uncommitted is a personal fork of [Better MD Diff](https://github.com/kamacheng/better-md-diff) by kamacheng. It is not affiliated with, published by, or supported by the original author. Do not report issues upstream.

[简体中文](README.zh-CN.md)

Better MD Diff shows a careful diff of the open note against Git `HEAD`. Uncommitted adds one thing: a left-sidebar list of every file that differs from the last commit. Click a Markdown note to open it with the existing diff panel; click anything else for a simple text diff.

![Obsidian demo: edit, inspect a deletion, restore one change, and undo](docs/images/obsidian-demo.gif)

The diff panel, editor flags, and per-change restore are unchanged upstream behavior. The list, its badges, and the plain diff view are the fork's additions.

## Installation

This fork is **not** published to the Obsidian community directory. Install it from source into your own vault:

1. Build it:

   ```bash
   npm ci
   npm run build
   ```

2. In Obsidian, open **Settings → Community plugins** and disable **Better MD Diff** if it is enabled.
3. Install the build into your vault (the script refuses to run while Better MD Diff is enabled):

   ```bash
   OBSIDIAN_VAULT=/path/to/your/vault npm run install:vault
   ```

4. Enable **Uncommitted** under **Community plugins**.

Requires desktop **Obsidian 1.8.0+**, a local **Git** installation, and a vault folder that is the root of its Git repository. A vault inside a larger repository is rejected with an explanatory message.

### Never enable both plugins

Uncommitted deliberately keeps upstream's internal view type (`better-md-diff-view`) so the fork stays easy to merge. Obsidian therefore treats the two plugins as registering the same view, so **do not enable Better MD Diff and Uncommitted in the same vault**. The install script checks `community-plugins.json` and stops with instructions if the original is enabled.

### Keeping the plugin out of Git

If you do not want the installed plugin binaries committed, add this line to your vault's `.gitignore`:

```gitignore
.obsidian/plugins/uncommitted/
```

## Usage

### Changes list

Open the list with the **Git compare** ribbon icon, the **Open changes list** command, or the `Git: N changes` status bar item. It sits in the left sidebar next to the file explorer.

- **Folder tree**: collapsible, folders before files. Collapsed folders are remembered.
- **Badges**: `A` added, `M` modified, `D` deleted, `R` renamed, `U` untracked, `!` conflict.
- **Summary**: `N changes · +added −deleted` for the whole working tree.
- **Automatic refresh**: vault create/modify/delete/rename events (debounced), switching back to Obsidian, the refresh button, and the **Refresh changes list** command. No timer polling.
- **Filtering**: the config folder is hidden by default. Edit **Exclude patterns** in settings to hide more; one pattern per line, a trailing `/` hides a folder, `*` and `**` are supported, and lines starting with `#` are ignored.

Clicking a file:

| File | Result |
| --- | --- |
| Markdown that exists | Opens the note (reusing an existing tab when possible) and the Better MD Diff panel |
| Canvas, PDF, image, audio, video | Opens the file and a simple plain-text diff |
| Other text file (`.json`, `.css`, `.txt`, …) | Opens only the plain-text diff |
| Deleted file | Plain diff only; text shows all lines removed, binary shows **Binary file deleted** |

The plain diff shows old and new line numbers, `+`/`−` rows, and both sizes for binary files. It reuses the upstream document size and line limits.

### Discarding changes

Right-click a file (or focus its row and press Shift+F10) and choose **Discard all changes**. The confirmation dialog names the file and the exact effect. Discard only touches the working tree: it never stages, commits, resets, or checks out.

- Modified files return to `HEAD` content. An open note is replaced in one editor transaction, so **Ctrl/Cmd+Z** undoes it.
- Deleted files are recreated, including missing parent folders.
- Staged and untracked files go to Obsidian's trash (respecting your trash setting).
- Renames and conflicts are not discardable here; use Git in a terminal.
- If `HEAD` or the file changed while the dialog was open, nothing is written and the dialog explains why.
- Staged changes stay staged.

### Untracked notes and restore

Untracked notes are diffed against an empty file, so every line shows as added. Upstream's per-change restore reads `HEAD` directly and therefore refuses untracked notes; use **Discard all changes** or edit normally instead.

### Editor flags and reading groups

The upstream editor flags still work in Source mode and Live Preview: green `+n` added lines, blue `~n` modified lines, red `−n` deleted old lines. **Change 1 / 3** counts independent edits, not boxes; nearby edits can share one context group. Text remains selectable and copies as original Markdown. The plugin never stages, commits, or pushes.

### Commands

All commands are palette-only (no default hotkeys):

- **Open changes list**
- **Refresh changes list**
- **Open next changed file** / **Open previous changed file** (tree order, wrapping)
- **Discard all changes in current file**

## Keeping up with upstream

```bash
git fetch upstream
git merge upstream/main
npm ci && npm run check
```

Conflicts should be limited to the fork touch points (identity files, `src/main.ts`, `src/settings.ts`, `styles.css`, and the changes tests). The `upstream` remote is fetch-only; its push URL is `DISABLED`.

## Scope

Personal use only. There are no network requests, telemetry, releases, or community-directory submissions. This release still compares against local Git `HEAD`; upstream's unfinished accepted-baseline review is not wired in.

## Credits

[Better MD Diff](https://github.com/kamacheng/better-md-diff) by kamacheng, used under the MIT license.

## License

[MIT](LICENSE). The jsdiff dependency uses BSD-3-Clause; its full license is included in the build.
