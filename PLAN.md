# PLAN: Native-looking changes sidebar

## Context

The Uncommitted plugin works, but its left-sidebar **Changes** view does not look like Obsidian.
The causes are in the code, not in taste:

- **Rows are `<button>` elements.** Obsidian 1.14.4 `app.css` styles every `button` with `display: inline-flex`, `justify-content: center`, `height: var(--input-height)` and `--button-radius`. It also gives `button:not(.clickable-icon)` the `--interactive-normal` background and `--input-shadow`. The `.unc-row` rules only partly override this. Rows keep a raised button look, a fixed height and a shadow that no core view has.
- **The header, badges and highlights are custom.** The header row, the boxed status-letter badges (`.unc-badge`) and the inset accent bar on the active row (`box-shadow: inset 2px 0`) do not exist anywhere in Obsidian.
- **The tree is half-native.** It uses `tree-item`, but with its own chevron, indent, padding and font rules. Indentation guides, the native collapse triangle, hover and active colors, and theme variables (`--nav-item-*`) therefore do not apply.
- **Every update rebuilds the whole view**, header included. This includes each Git refresh and each folder toggle. The scroll position and focus need workarounds.

The goal is that the view reads as a core pane: the same row metrics, colors, collapse triangle, indentation guides, header buttons and empty state as the File explorer, Search and Outline panes. It should also follow any theme automatically. Behavior stays the same: open, discard, collapsed-state persistence, commands and the status bar. The work ends with a version bump and a green `npm run check`, ready to tag.

"Publish" here means a GitHub release from this repository through `.github/workflows/release.yml`. AGENTS.md forbids submitting to the community directory. Tagging and pushing happen only when the owner says so.

**Baseline (verified 2026-11-10 on a scratch copy of `HEAD`):** `npm ci && npm run check` passes. That covers the English-only check, lint with zero warnings, 324/324 tests, the build and the release check.

## Sources

- Obsidian developer docs, read 2026-11-10:
  - Plugin guidelines (sentence case, no inline styles, `createEl`, `this.app`, register cleanup, no default hotkeys).
  - Views.
  - Icons (`setIcon`; Lucide icons up to v0.446.0).
  - HTML elements.
  - CSS variables: Navigation and Colors. As of 1.13, the `-rgb` variables are deprecated in favor of `color-mix(in oklch, …)`.
  - Release with GitHub Actions.
- Obsidian 1.14.4 `app.css` and `app.js`, extracted read-only from the local Flatpak, as the authority for native markup:
  - Folder: `div.tree-item.nav-folder[.is-collapsed]` > `div.tree-item-self.is-clickable.mod-collapsible` > `div.tree-item-icon.collapse-icon[.is-collapsed]` (icon `right-triangle`) + `div.tree-item-inner`. Then `div.tree-item-children`, which is detached while the folder is collapsed.
  - File: `div.tree-item` > `div.tree-item-self.is-clickable[.is-active]` > `div.tree-item-inner`.
  - Counts: `div.tree-item-flair-outer > span.tree-item-flair`.
  - Header: `div.nav-header > div.nav-buttons-container > div.clickable-icon.nav-action-button`.
  - Empty state: `div.pane-empty` with `div.pane-empty-actions`.
  - Keyboard focus ring: `.tree-item-self.has-focus`, shown only under `.workspace-leaf.mod-active`.
  - Obsidian's own Sync file tree colors status flairs: `--text-success` for new, `--text-accent-hover` for changed, `--text-error` for deleted.

## Design decisions (defaults; override at approval)

1. **Use the generic tree classes only.** Use `tree-item`, `tree-item-self`, `tree-item-inner`, `tree-item-icon collapse-icon`, `tree-item-children`, `tree-item-flair-outer` and `tree-item-flair`. **Do not** use `nav-file*`, `nav-folder*` or `nav-files-container`. Themes, other plugins (icon and color plugins) and `scripts/host-smoke.py` (`.nav-file-title[data-path=…]`) target those as the File explorer. Outline, Search and Backlinks use the same generic classes, so the look matches without collisions.
2. **Rows are `div`s** with `role="treeitem"` and a roving `tabindex`, as in core panes. Header actions are `div.clickable-icon.nav-action-button` with `aria-label`, as in core panes. The `clickable-icon` class is exempt from the global button chrome.
3. **File names hide `.md`**, as the File explorer does. Other extensions appear as a small tag after the name. The tag is styled with the `--nav-tag-*` variables under a fork class (`unc-file-tag`).
4. **The status shows as a colored letter flair** on the right (`A M D R U !`), in a `tree-item-flair`. The colors are fork variables that default to Obsidian's semantic text colors, so themes can override them:
   - `--unc-status-added: var(--text-success)` (also used for untracked)
   - `--unc-status-modified: var(--text-accent)`
   - `--unc-status-deleted: var(--text-error)`
   - `--unc-status-renamed: var(--text-muted)`
   - `--unc-status-conflict: var(--text-warning)`

   Deleted file names are struck through and faint.
5. **Folders show a faint count flair**, the native `tree-item-flair` as used in the Tags pane.
6. **Per-file `+N −M` goes in the tooltip only**, to keep rows uncluttered. The tooltip reads `path`, then a line with `Modified · +2 −1`. Renames read `old → new`. The tooltip is placed to the right.
7. **Summary line.** The header has only centered icon buttons (Refresh, Collapse all / Expand all), like the File explorer. Below it, one muted line reads `5 changes  +9 −4`, with the `+`/`−` in the success and error text colors. A bottom border separates it, matching the result-count line in Search.
8. **Active and focus states are native only.** Drop the inset accent bar. `is-active` goes on `.tree-item-self`, and `has-focus` follows keyboard focus.
9. **The plain diff view keeps its badge.** `src/changes/plain-diff-view.ts:93` still uses `.unc-badge` and `.unc-badge-*`. Keep those rules and restyle them as the same flair letter (no box), so both views agree.

## Implementation phases

Each phase is one commit with an imperative subject. Each must pass `npm run check` with zero warnings, per AGENTS.md. All edits stay within the fork's touch points: `src/changes/`, `tests/changes/`, the delimited block at the end of `styles.css`, and `tests/helpers/obsidian.ts` if a stub is needed. Do **not** edit `tests/helpers/obsidian-dom.ts`, which is upstream (`d9a0fd5`) and unlisted. Pass `cls` as a string, and use only the DOM helpers it already stubs: `createEl`/`Div`/`Span`, `empty`, `setText` and `add`/`remove`/`toggleClass`. Plain DOM APIs (`setAttribute`, `tabIndex`, `classList`) are fine.

### Phase 0: Add this plan
- Copy this file to `PLAN.md` at the repo root (English only; `check:english` scans it).
- Commit: `Add plan for a native-looking changes sidebar`.

### Phase 1: Native tree markup and a persistent skeleton
File: `src/changes/changes-view.ts`.

- **`onOpen` builds the skeleton once.** It adds `contentEl.addClass('unc-changes')`, then:
  - `nav-header > nav-buttons-container`, holding a Refresh button and a Collapse toggle (`div.clickable-icon.nav-action-button`, `setIcon`, `aria-label`, `setTooltip`);
  - the `unc-summary` line;
  - the `unc-tree` scroll container with `role="tree"` and `aria-label="Changed files"`.

  Keep references to these elements.
- **Store the subscription cleanup once.** Pass the unsubscribe from `this.host.controller.subscribe(...)` straight to `this.register(...)`. Remove the duplicated cleanup in `onClose`, or keep `onClose` idempotent.
- **`render()` updates in place.** It updates the summary text, the collapse button's icon and label, and its disabled state (`is-disabled` + `aria-disabled`). It then empties and rebuilds only `unc-tree`. Save `scrollTop` before emptying and restore it after, because emptying clamps it to 0. Also restore the roving-focus path (see Phase 3).
- **Folder rows** follow the native markup:
  - `div.tree-item.unc-folder[.is-collapsed]` with `data-path`;
  - its `div.tree-item-self.is-clickable.mod-collapsible.unc-row` has `role=treeitem`, `aria-expanded` and `aria-level`;
  - the icon is a `div.tree-item-icon.collapse-icon[.is-collapsed]` with `setIcon(…, 'right-triangle')`;
  - then `div.tree-item-inner.unc-name` and `div.tree-item-flair-outer > span.tree-item-flair` (count);
  - children go in `div.tree-item-children` with `role=group`.
- **Collapse toggles in place.** Toggle `is-collapsed` on the item and on the icon, and `aria-expanded`. On collapse, `children.empty()` and detach. On expand, rebuild that subtree. This avoids a full re-render, so the scroll position does not jump.
- **File rows:**
  - `div.tree-item.unc-file` > `div.tree-item-self.is-clickable.unc-row[.is-active][.unc-deleted]` with `data-path`, `role=treeitem`, `aria-level` and `aria-selected` for the active row;
  - then `div.tree-item-inner.unc-name` (display name);
  - then an optional `span.unc-file-tag` (extension);
  - then `div.tree-item-flair-outer > span.tree-item-flair.unc-flair.unc-status-{a|m|d|r|u|conflict}`, with the letter as text and `aria-label` set to the full label.
- **Add display-name helpers** next to `fileName`:
  - `displayName(path)` strips a final `.md` case-insensitively. Dotfiles such as `.md` and names without an extension stay as they are.
  - `extensionTag(path)` returns the lowercase extension for non-markdown files and `''` otherwise.
- **`updateActiveRow`** toggles `is-active` and `aria-selected` on `.unc-file > .tree-item-self`.
- **State bodies use `div.pane-empty`:**
  - Loading reads `Loading changes…`.
  - Empty reads `No changes since last commit`.
  - Error shows `unc-error-message` in `--text-error`. A `git-missing` error adds `div.pane-empty-actions > button.mod-cta.unc-settings-button` reading `Open settings`.
- **Update `tests/changes/changes-view.test.ts`:**
  - Change the selectors to `.tree-item-self[data-path]` (helper `row()`), and the flair and status classes.
  - Assert the header element is the **same node** after `emit()`, so the skeleton persists.
  - Assert `is-collapsed` sits on both the item and the icon, and children are detached when collapsed.
  - Assert `.pane-empty` for the empty state.
  - Assert the tooltip holds the path plus the status and counts.
  - Assert `displayName` and `extensionTag` against `café 🎉.md`, `notes.v2.md`, `README.MD`, `.md`, `.obsidian/app.json`, `Makefile` and `photo.png`. AGENTS.md requires Latin text with accents and emoji, no Han characters.
- Commit: `Render the changes list with native tree markup`.

### Phase 2: Rewrite the fork CSS block
File: `styles.css`, only inside `/* ==== fork: changes list ==== */ … /* ==== end fork ==== */`.

- **Delete** the rules that duplicate or fight native styling:
  - `.unc-row` padding, border, background and font;
  - `.unc-row:hover` and `.unc-row:focus-visible`;
  - `.unc-file.is-active .unc-row`;
  - `.unc-chevron*` and `.unc-children`;
  - `.unc-icon-button*` and `.unc-folder-row`.

  Native `.tree-item-self`, `.collapse-icon`, `.tree-item-children` and `.nav-action-button` take over.
- **Keep or add only:**
  - Layout: `.unc-changes` as a flex column, height 100%, padding 0. `.unc-tree` with `flex: 1; min-height: 0; overflow-y: auto`, padded like the File explorer's list: `var(--size-4-1) var(--size-4-3) var(--size-4-6)`.
  - `.unc-summary`: muted, `--font-ui-smaller`, tabular numbers, padding `0 var(--size-4-3) var(--size-4-2)`, bottom border `--background-modifier-border`. `.unc-summary-added` and `.unc-summary-deleted` use `--text-success` and `--text-error`.
  - `.unc-name`: one line with ellipsis (`white-space: nowrap; text-overflow: ellipsis; overflow: hidden; min-width: 0`).
  - `.unc-file-tag`: mirrors `.nav-file-tag` through `--nav-tag-background`, `--nav-tag-color`, `--nav-tag-radius` and `--nav-tag-weight`. Margin goes before the tag, not `auto`.
  - `.unc-deleted .unc-name`: `text-decoration: line-through; color: var(--text-faint)`.
  - `.unc-flair`: `font-weight: var(--font-semibold)`, monospace-width letter. Status colors come from the `--unc-status-*` variables defined on `.unc-changes, .unc-plain-diff`.
  - `.unc-badge*`: restyled to the same flair look (no box) for the plain diff header.
  - `.unc-status-hidden`: unchanged.
- **CSS rules:**
  - No hardcoded colors.
  - No `!important`.
  - No deprecated `-rgb` variables.
  - No new Obsidian variables beyond those used today plus `--nav-tag-*`, which have existed since 1.0, so `minAppVersion` 1.8.0 holds.
- **Add `tests/changes/styles.test.ts`.** It reads `styles.css`, extracts the fork block, and asserts no `#hex` or `rgb(` literals, no `-rgb)`, no `!important`, no `nav-file`/`nav-folder` selectors, and that every `.unc-*` class it uses exists in `src/changes`.
- Commit: `Style the changes list with Obsidian's tree variables`.

### Phase 3: Keyboard navigation like core panes
File: `src/changes/changes-view.ts`.

- **Roving tabindex.** Exactly one visible row has `tabindex=0`; the rest have `-1`. The focused row carries `has-focus`. Remember the focus by path, and restore it after every re-render and Git refresh. If the path is gone, fall back to the active file, else the first row.
- **One `keydown` handler on `unc-tree`:**
  - `ArrowDown` and `ArrowUp`: next or previous visible row.
  - `Home` and `End`: first or last row.
  - `ArrowRight` on a collapsed folder expands it; on an expanded folder, it moves to the first child.
  - `ArrowLeft` on an expanded folder collapses it; otherwise, it moves to the parent folder.
  - `Enter` and `Space`: open a file or toggle a folder.
  - `ContextMenu` and `Shift+F10`: menu at the row.

  Mouse clicks also move the roving focus.
- **Tests:** arrow and Home/End movement; Right and Left expand, collapse and jump to parent; Enter opens; focus survives `emit()` of an updated set; focus falls back when the focused file disappears.
- Commit: `Add tree keyboard navigation to the changes list`.

### Phase 4: Menu and status bar polish
Files: `src/changes/changes-view.ts`, `src/changes/index.ts`.

- **Context menu:**
  - Add `has-active-menu` on the row while the menu is open; remove it with `menu.onHide`.
  - Group the items with `setSection`:
    - `open`: **Open** (current routing, `host.open`).
    - `action`: **Copy path** (`navigator.clipboard.writeText(file.path)` and a `Notice`; local only, no network).
    - `danger`: **Discard all changes**. Keep the existing disabled state and label rows.
  - Folder rows get **Collapse** or **Expand**.
- **Status bar:**
  - Add the native `mod-clickable` class.
  - Replace `status.title = …` with `setTooltip(status, …, { placement: 'top' })`.
  - Keep `role=button`, `tabindex` and the text. Drop the custom cursor rule from CSS.
- **View display text:** change `'Changes'` to `'Uncommitted changes'`. Sidebar tab tooltips show it, and "Changes" is ambiguous next to core panes.
- **Tests:** update `tests/changes/install.test.ts` for `mod-clickable` and the tooltip. Extend the menu test for sections and **Copy path**, with the clipboard stubbed in jsdom. Add `onHide` and `setSection` capture to the `Menu` stub in `tests/helpers/obsidian.ts`, a listed touch point, only if a test needs it.
- Commit: `Align the changes list menu and status bar with core panes`.

### Phase 5: Real-host visual check (fork-owned script)

- **Add `scripts/check-changes-native.py`.** It is a new fork file, so `host-smoke.py` stays untouched. It reuses the host-smoke pattern: a throwaway vault under `.test-vault/`, a fresh profile, `--executable` required, and it never touches the owner's vault.
- **What it does:**
  1. Opens the Changes view and the File explorer.
  2. Compares `getComputedStyle` of a changes file row with a core file-explorer row: `padding`, `font-size`, `line-height`, `height`, `border-radius`, and the hover background via `:hover` emulation. Values must match, apart from the flair.
  3. Does the same for folder rows and the collapse icon.
  4. Runs in light and dark mode (`app.changeTheme`).
  5. Saves screenshots to `.test-vault/` for review.
- **Out of scope for CI**, because CI has no Obsidian binary. Document it in the README Development section. It can be tested locally only against Obsidian 1.14.4 (Flatpak). `minAppVersion` 1.8.0 is protected by using only long-standing classes and variables.
- Commit: `Add a host check that the changes list matches core tree styling`.

### Phase 6: Documentation
- **README Usage:** describe the tree (hidden `.md`, status letters and colors, tooltip counts, keyboard keys, context menu). Keep the required section layout (`check-release.mjs` asserts the headings).
- **README Development:** describe the new host check.
- **AGENTS.md Layout:** note that the changes list uses generic `tree-item` classes and never `nav-file*`/`nav-folder*`.
- Commit: `Document the native changes list`.

### Phase 7: Release preparation (stop before tagging)
- **Bump to `0.6.0`** in `manifest.json`, `package.json`, `package-lock.json` (root `version` and `packages[""].version`) and `versions.json` (`"0.6.0": "1.8.0"`). Use `npm version 0.6.0 --no-git-tag-version`, then edit `manifest.json` and `versions.json`.
- Run `npm ci && npm run check`, which must pass with zero warnings. Also run `RELEASE_TAG=0.6.0 npm run check:release`.
- Install the `dist/uncommitted` build into an isolated test vault only, never the owner's vault, and run Phase 5's check plus `scripts/host-smoke.py`.
- Commit: `Release 0.6.0`.
- **Stop here.** On the owner's go-ahead: `git push origin main`, then `git tag 0.6.0 && git push origin 0.6.0`. The tag has no `v` prefix. `release.yml` builds and publishes `main.js`, `manifest.json` and `styles.css`.

### Phase 8 (optional, separate commit): Lint plugin update
- `eslint-plugin-obsidianmd` 0.5.1 is out. The repo pins `^0.4.2`, which stays on 0.4.
- Try the bump on a scratch copy first. If the new rules flag only fork files, fix them and commit `Update the Obsidian lint rules`.
- If the new rules require edits in upstream files, defer the bump and record that in `PLAN.md`. Upstream code must not be reformatted (AGENTS.md).

## Critical files
- `src/changes/changes-view.ts`: markup, in-place updates, keyboard handling, menu.
- `src/changes/index.ts`: status-bar polish only.
- `styles.css`: the fork block only.
- `tests/changes/changes-view.test.ts`, `tests/changes/install.test.ts`, and the new `tests/changes/styles.test.ts`.
- `tests/helpers/obsidian.ts`: stub additions only if needed.
- `scripts/check-changes-native.py` (new), `README.md`, `AGENTS.md`, and the version files.

Reused as is:
- `buildTree`, `sortedFolders` and `sortedFiles` in `src/changes/model.ts`.
- `ChangesController.subscribe`, `getState`, `activePath`, `canDiscard`, `saveCollapsedFolders` and `changesSettings` in `src/changes/controller.ts`.
- `setIcon`, `setTooltip`, `Menu` and `debounce` from `obsidian`.

## Verification
1. `npm ci && npm run check` passes after every commit: English check, lint with zero warnings, vitest, typecheck and build, release check.
2. New and updated unit tests cover the DOM structure, in-place collapse, a persistent header, roving focus across refreshes, display-name edge cases (accents and emoji), menu sections and the CSS guard.
3. Real host, isolated vault, Obsidian 1.14.4:
   - `python3 scripts/check-changes-native.py --executable <obsidian>` shows computed row metrics matching the File explorer in light and dark mode.
   - Review the screenshots by eye with the default theme and one popular community theme.
   - `scripts/host-smoke.py` still passes.
4. Manual pass in the isolated vault:
   - Open, discard, collapse and expand, and Collapse all / Expand all.
   - Keyboard-only navigation.
   - Context menu.
   - Status bar click.
   - Collapsed folders persist after a reload.
   - The scroll position holds during a background Git refresh.

## Out of scope
- Triggering the core `file-menu` (adds Rename/Delete and other plugins' items).
- A flat-list mode, compact folder chains, and drag-to-link (uses private APIs).
- Release attestation (`actions/attest`), which the docs recommend for directory submissions. Not needed here.
- The deprecated `-rgb` variables in the upstream `bmd-*` CSS. They are upstream code and still work, so leave them to stay mergeable.
- Community directory submission (forbidden by AGENTS.md).
