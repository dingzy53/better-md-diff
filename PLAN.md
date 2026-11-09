# PLAN.md — "Uncommitted": a changed-files list for a personal fork of Better MD Diff

> **Audience:** the coding agent implementing this (DeepSeek harness, Linux) and the owner.
> **Working name:** `Uncommitted`, plugin id `uncommitted`, CSS prefix `unc-`. If the owner picks another name, replace all three consistently in Phase 0 and nowhere else.
> **Upstream:** <https://github.com/kamacheng/better-md-diff>, base commit `ce6c9d9` (Release 0.4.1, MIT).
> **Status of this fork:** personal use only. It is never pushed, proposed, or published to the original repository or to the Obsidian community directory.

---

## 1. Goal

Better MD Diff already shows an excellent per-note diff against Git `HEAD`. It only knows about the note you have open. This fork adds **one thing**: a left-sidebar list of every file that differs from the last commit. Clicking a file opens it and shows the existing Better MD Diff panel.

The plugin stays small and read-only toward Git. It never stages, commits, pushes, pulls, resets, or checks out.

## 2. Requirements (decided with the owner)

| # | Topic | Decision |
|---|---|---|
| R1 | Where the list lives | New view in the **left sidebar** (next to the file explorer) |
| R2 | Which files | **All files** git reports as changed vs `HEAD`, including non-Markdown |
| R3 | Committing | **None.** List and diff only. The owner commits elsewhere |
| R4 | Remote | **None.** No push, pull, or fetch, and no network access at all |
| R5 | Layout | **Folder tree**, collapsible; collapsed state remembered |
| R6 | Row info | **Status badge** per file: `A` added, `M` modified, `D` deleted, `R` renamed, `U` untracked, `!` conflict |
| R7 | Header | **Summary at top**: `N changes · +added −deleted` |
| R8 | Click on a Markdown file | **Open the note + open the existing Better MD Diff panel** for it |
| R9 | Click on other text files | Open the file if Obsidian can display it, and show a **plain text diff** |
| R10 | Binary files | Open if viewable; diff view shows "Binary file changed" with sizes |
| R11 | Right-click menu | Only **Discard all changes** (with confirmation) |
| R12 | Discard on new/untracked files | **Move to Obsidian trash** via `FileManager.trashFile` (respects the user's trash setting) |
| R13 | Refresh | **Automatic on vault events** (create/modify/delete/rename), debounced, plus on window focus, plus a manual refresh button. No timer polling |
| R14 | Untracked files | Shown as `U`; **diffed against empty** (whole file is "added"), including in the Better MD Diff panel and editor flags |
| R15 | Noise | Hide `.obsidian/` by default; exclude patterns editable in settings |
| R16 | Repo layout | Vault folder **is** the Git repository root. Anything else shows a clear error |
| R17 | Extras | **Ribbon icon** to open the list; **status bar item** with the change count |
| R18 | Keyboard | **Commands only** (no default hotkeys): open list, refresh, next/previous changed file, discard current file |
| R19 | Language | New UI is **English only**. Upstream's English/Chinese i18n is left untouched |
| R20 | Upstream relationship | **Stay mergeable**: new code in new files, small and listed edits to upstream files, so `upstream/main` can be merged later |
| R21 | Platform | Desktop only (Linux for the owner). Uses the local `git` executable |

### Explicit non-goals

No staging, committing, pushing, pulling, branches, history/log view, blame, per-file line counts in rows, i18n for new strings, mobile support, or timer polling. Do not wire in upstream's unfinished "personal review" modules (`src/review.ts`, `src/review-storage.ts`); leave them exactly as they are.

---

## 3. Obsidian docs compliance (current as of November 2026)

The implementation must follow the current official developer documentation. Before starting each phase, re-read the relevant pages below; if anything has changed since this plan was written, the docs win, and the agent records the difference in `AGENTS.md` under "Docs notes".

**Pages to follow**

- Plugin guidelines: <https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines>
- Developer policies: <https://docs.obsidian.md/Developer+policies>
- Mobile development (Node/Electron APIs): <https://docs.obsidian.md/Plugins/Getting+started/Mobile+development>
- Views: <https://docs.obsidian.md/Plugins/User+interface/Views>
- Context menus: <https://docs.obsidian.md/Plugins/User+interface/Context+menus>
- Status bar, Ribbon, Commands, Settings, Modals: the matching pages under <https://docs.obsidian.md/Plugins/User+interface/>
- CSS variables: <https://docs.obsidian.md/Reference/CSS+variables/CSS+variables>
- API reference: <https://docs.obsidian.md/Reference/TypeScript+API> (append `.md` to any page URL for raw Markdown)

**Rules this plan relies on (from the guidelines)**

1. Use `this.app`, never the global `app` / `window.app`.
2. No `console.log` noise. Only real errors may reach the console.
3. Organize multi-file code in folders (new code goes in `src/changes/`).
4. UI text in **sentence case** ("Discard all changes", not "Discard All Changes"). The ESLint rule `obsidianmd/ui/sentence-case` enforces this.
5. Settings: no top-level heading; no "settings" in headings; use `new Setting(el).setName(...).setHeading()`, never `<h1>`/`<h2>`.
6. **Never** use `innerHTML`, `outerHTML` or `insertAdjacentHTML`. Build DOM with `createEl`, `createDiv`, `createSpan`, clear with `el.empty()`, icons with `setIcon()`.
7. Clean up everything on unload with `registerEvent`, `registerDomEvent`, `register`, `addCommand`, or by making the controller a `Component` added with `plugin.addChild()`.
8. Do **not** detach leaves in `onunload`.
9. No default hotkeys for commands. Use `callback` when a command always runs and `checkCallback` when it depends on state.
10. Use `workspace.getActiveViewOfType(MarkdownView)` / `workspace.activeEditor`, never `workspace.activeLeaf`.
11. Do not store references to custom views. Register with `registerView(TYPE, (leaf) => new View(leaf, deps))` and find them with `workspace.getLeavesOfType(TYPE)`.
12. Editing an **open** note: use the `Editor` API (keeps cursor and undo). Editing a file in the background: `Vault.process`. Prefer the Vault API over `vault.adapter`.
13. Look up files with `vault.getFileByPath` / `getAbstractFileByPath`, never by iterating `getFiles()`.
14. Use `normalizePath()` on any user-provided or constructed vault path.
15. No hard-coded inline styles. Use CSS classes in `styles.css` with Obsidian CSS variables.
16. Prefer `async`/`await` over promise chains; `const`/`let`, never `var`.
17. Node APIs (`child_process`) are only allowed because `manifest.json` keeps `"isDesktopOnly": true`.
18. Developer policies: no telemetry, no network requests, no ads, no obfuscated code. This plugin makes **zero** network calls.

**API versions.** Every API this plan uses exists at or below the current `minAppVersion` of **1.8.0**, so do not raise it:

| API | Since |
|---|---|
| `Vault.process` | 1.1.0 |
| `Vault.getFileByPath` | 1.5.7 |
| `FileManager.trashFile` | 1.6.6 |
| `Workspace.ensureSideLeaf`, `Workspace.revealLeaf` (returns `Promise`) | 1.7.2 |
| `PluginSettingTab.getSettingDefinitions` (upstream already uses it, with a fallback) | 1.13.0 |

Keep the upstream pin `"obsidian": "1.13.1"` in `devDependencies` (the latest on npm is 1.14.4). Bumping it makes upstream merges harder and nothing here needs it. Check new API usage against the pinned typings in `node_modules/obsidian/obsidian.d.ts`.

**Tooling inherited from upstream (must stay green):** `npm run check` = ESLint with `eslint-plugin-obsidianmd` recommended rules at zero warnings, Vitest tests, strict `tsc`, esbuild production build, and the release-consistency script.

---

## 4. Fork setup and safety (Phase 0, done first)

### 4.1 Repository

Do **not** use GitHub's "Fork" button. A GitHub fork stays linked to the original and makes accidental pull requests easy. Instead:

```bash
git clone https://github.com/kamacheng/better-md-diff.git uncommitted
cd uncommitted
git remote rename origin upstream
git remote set-url --push upstream DISABLED   # any push to upstream fails
# owner creates a new PRIVATE repo on their own account, then:
git remote add origin git@github.com:<owner>/uncommitted.git
git checkout -b main-fork
git push -u origin main-fork                  # owner runs this, not the agent
```

Verify with `git remote -v`: the `upstream` push URL must read `DISABLED`.

### 4.2 Disable upstream's release workflow

`.github/workflows/release.yml` builds and drafts a signed release on any tag push. In the fork, delete it (or rename to `release.yml.disabled`). Keep `ci.yml`.

### 4.3 Rename the plugin identity

This prevents Obsidian from treating the fork as Better MD Diff and "updating" it back to upstream from the community directory.

| File | Change |
|---|---|
| `manifest.json` | `id: "uncommitted"`, `name: "Uncommitted"`, `version: "0.1.0"`, `author: "<owner> (fork of Better MD Diff by kamac)"`, `authorUrl` → owner's GitHub, new `description` (≤ 250 chars, ends with a period). Keep `minAppVersion: "1.8.0"` and `isDesktopOnly: true` |
| `package.json` | `name: "uncommitted"`, `version: "0.1.0"`, `description`, `homepage`/`repository`/`bugs` → owner's private repo. Keep `license: "MIT"` |
| `package-lock.json` | Update root `version` and `packages[""].version` by running `npm install --package-lock-only` (do not hand-edit other entries) |
| `versions.json` | Add `"0.1.0": "1.8.0"` (keep old lines) |
| `esbuild.config.mjs` | Banner text and the hard-coded `dist/better-md-diff` folder → `dist/uncommitted` |
| `eslint.config.mjs` | Add `'Uncommitted'` to the `brands` list of the sentence-case rule |
| `LICENSE` | **Keep unchanged.** Add a second copyright line for the owner below kamacheng's |
| `README.md` | Add a top section: "Personal fork of Better MD Diff by kamacheng. Not affiliated, not published, do not report issues upstream." Keep `## Installation` and `## Usage` headings and the link to `README.zh-CN.md` (the release check asserts them) |

Upstream IDs left as is: the internal view type `better-md-diff-view`, the `bmd-` CSS classes, and the `better-md-diff.revert` transaction tag. Changing them would create pointless merge conflicts. Consequence: **the original Better MD Diff and this fork must never be enabled in the same vault** (duplicate view type). Phase 0 documents this in the README and in `AGENTS.md`.

### 4.4 Create `AGENTS.md` at the repo root

The agent creates this file in Phase 0, then reads it at the start of every session. Content:

```markdown
# AGENTS.md — rules for any coding agent in this repository

## What this repo is
A PERSONAL fork of Better MD Diff (https://github.com/kamacheng/better-md-diff, MIT) named "Uncommitted".
It adds a left-sidebar list of files changed since the last commit. The plan is in PLAN.md.
It is for the owner's own vault only.

## Hard rules: never do these
- NEVER push to, open pull requests against, open issues on, or comment on kamacheng/better-md-diff.
  The `upstream` remote is fetch-only; its push URL is DISABLED. Do not change that.
- NEVER submit this plugin to the Obsidian community directory or obsidianmd/obsidian-releases.
- NEVER push tags. NEVER create GitHub releases. The release workflow is removed on purpose.
- NEVER push to `origin` unless the owner asks in this session. Commit locally per phase.
- NEVER run git commands in the owner's vault that write: no add, commit, reset, checkout, restore,
  stash, clean, push, pull, fetch. The plugin's own Git use is read-only (status, diff, ls-files,
  ls-tree, cat-file, rev-parse).
- NEVER add network requests, telemetry, or analytics.
- NEVER install builds into the owner's real vault; use the isolated test vault (`.test-vault/`).
- NEVER modify src/review.ts or src/review-storage.ts (unfinished upstream work).

## Keep the fork mergeable
- New code lives in src/changes/ and tests/changes/. New CSS goes in one delimited block at the
  end of styles.css.
- Edits to upstream files are limited to the "upstream touch points" listed in PLAN.md §6.
  Any other upstream edit needs a one-line reason added to that list.
- Do not reformat, rename, or reorder upstream code.
- To sync: `git fetch upstream && git merge upstream/main`, resolve only the touch points,
  then `npm ci && npm run check`.

## Obsidian rules (summary; full list in PLAN.md §3)
this.app only · no innerHTML · sentence case · no default hotkeys · register everything for cleanup ·
Editor API for open notes, Vault.process otherwise · FileManager.trashFile for deletions ·
getFileByPath, not getFiles().find · normalizePath for user paths · CSS classes + Obsidian CSS
variables, no inline styles · isDesktopOnly stays true · minAppVersion stays 1.8.0.
Before each phase, re-check the docs pages listed in PLAN.md §3. Record changes below.

## Workflow
- Node 22.12+ or 24+. `npm ci` before anything (missing types cause bogus lint errors).
- `npm run check` must pass with zero warnings before every commit.
- One phase per commit: `changes: phase N – <summary>`.
- UI strings in new code are plain English literals (not t()).

## Docs notes
(append dated notes here when the Obsidian docs differ from PLAN.md)
```

### 4.5 Phase 0 acceptance

- `git remote -v` shows `upstream … (push) DISABLED`.
- `npm ci && npm run check` passes with the renamed identity and `dist/uncommitted/` is produced.
- `AGENTS.md` exists; release workflow is gone.

---

## 5. Architecture

### 5.1 How the pieces fit

```
                          ┌──────────────────────────────┐
 vault events / focus ──▶ │ ChangesController (Component)│ ── git status/diff (read-only) ──▶ git
 manual refresh / cmds    │  • debounced refresh, 1 in    │
                          │    flight, coalesced queue    │
                          │  • ChangeSet state + subscribe│
                          └───────┬──────────┬───────────┘
                                  │          │
             ┌────────────────────┘          └───────────────┐
             ▼                                               ▼
   ChangesView (left sidebar)                      status bar item "Git: 5 changes"
   tree, badges, summary, context menu
             │ click
             ├── .md (exists) ──▶ open note ──▶ upstream plugin.openDiff(path)  (Better MD Diff panel, right)
             └── other / deleted / binary ──▶ open if viewable ──▶ PlainDiffView (right sidebar)
```

Upstream's per-note machinery (`DiffStore`, `DiffPanel`, editor flags, per-change restore) is reused unchanged. The only behavior change upstream code sees is that **untracked** Markdown files resolve to an empty baseline instead of an error (R14).

### 5.2 New files

```
src/changes/
  index.ts             installChanges(plugin, deps): single entry point called from main.ts
  types.ts             ChangeStatus, ChangedFile, ChangeSet, ChangesSettings
  settings.ts          DEFAULT_CHANGES_SETTINGS, normalizeChangesSettings(), changesSettingGroup()
  git-status.ts        GitStatusReader: runs git, parses porcelain v2 + numstat, reads HEAD blobs
  model.ts             toChangedFiles(), summarize(), buildTree(), sort, next/previous helpers
  exclude.ts           compileExcludes(patterns) → (path) => boolean (no dependency)
  controller.ts        ChangesController extends Component
  changes-view.ts      ChangesView extends ItemView (left sidebar)
  plain-diff-view.ts   PlainDiffView extends ItemView (right sidebar, non-Markdown/deleted/binary)
  discard.ts           DiscardModal extends Modal + discardChanges()
  open.ts              openChangedFile(): click routing (R8–R10)
tests/changes/
  exclude.test.ts  model.test.ts  git-status.test.ts  discard.test.ts  settings.test.ts  controller.test.ts
scripts/
  install-to-vault.mjs  copies dist/uncommitted/* into $OBSIDIAN_VAULT/.obsidian/plugins/uncommitted/
```

### 5.3 Data types (`types.ts`)

```ts
export type ChangeStatus = 'A' | 'M' | 'D' | 'R' | 'U' | '!';

export interface ChangedFile {
  path: string;            // vault-relative, '/' separators, normalizePath()'d
  oldPath?: string;        // only for 'R'
  status: ChangeStatus;
  binary: boolean;         // true if numstat reports '-' or content has a NUL in first 8 KiB
  added: number;           // lines, 0 for binary; used only for the summary
  deleted: number;
}

export interface ChangeSet {
  files: ChangedFile[];    // sorted by path, excludes already applied
  added: number;
  deleted: number;
  head: string | null;     // null when the repo has no commits yet
  updatedAt: number;
}

export type ChangesState =
  | { status: 'loading' }
  | { status: 'ready'; set: ChangeSet }
  | { status: 'error'; message: string; kind: 'git-missing' | 'not-repo' | 'not-root' | 'timeout' | 'other' };

export interface ChangesSettings {
  showUntracked: boolean;      // default true
  excludePatterns: string[];   // default ['.obsidian/']
  showStatusBar: boolean;      // default true
  collapsedFolders: string[];  // hidden setting, persisted tree state
}
```

---

## 6. Upstream touch points (the complete list)

Keep each edit as small as possible and mark it with a `// fork:` comment so merges are easy to spot.

| File | Edit | Why |
|---|---|---|
| `src/main.ts` | (a) `import { installChanges } from './changes'`. (b) In `onload`, after the existing setup and before `onLayoutReady`, call `installChanges(this, { openDiff: (p) => this.openDiff(p), gitPath: () => this.settings.gitPath, vaultRoot })`. | Single hook-in point |
| `src/main.ts` | (c) Wrap the baseline read passed to `new DiffStore(...)`: if the reader throws `GitReadError` with `reason === 'untracked'` and `changesSettings.showUntracked` is true, return `{ content: '', head: null, isNew: true }`. Do the same in the `refreshOpenFiles` batch path by wrapping the `BaselineRead` returned from `this.reader.batch()`. | R14: diff untracked notes vs empty |
| `src/main.ts` | (d) Settings persistence: `loadData()` once into `raw`; upstream `normalizeSettings(raw)` stays; fork settings come from `normalizeChangesSettings(raw?.changes)`. In `applySettings`, save `{ ...this.settings, changes: this.changesSettings }` instead of `this.settings`. Add a `saveChangesSettings()` that does the same save. | Upstream's `normalizeSettings` drops unknown keys, so fork settings live under a `changes` key |
| `src/settings.ts` | Append `changesSettingGroup(this.plugin)` to the array returned by `getSettingDefinitions()` (the legacy `display()` path uses the same definitions). | One "Changes list" settings section |
| `styles.css` | Append one block between `/* ==== fork: changes list ==== */` and `/* ==== end fork ==== */`. | All new styles |
| Identity files | As listed in §4.3. | Rename |

`src/git.ts`, `src/panel.ts`, `src/store.ts`, `src/editor.ts` and everything else upstream stay untouched.

**Untracked notes and per-change restore.** With (c), the upstream panel shows an untracked note as all-added, and its per-change restore arrow would delete text. Upstream's restore path calls `readGitBaseline()` directly, which still throws "untracked", so restore is refused with upstream's existing message. That is acceptable and needs no change. Mention it in the README.

---

## 7. Implementation phases

Work through phases in order. Each ends with `npm run check` passing and one local commit.

### Phase 1 — Pure core: `exclude.ts`, `model.ts`, `types.ts`, `settings.ts` (normalize only)

**exclude.ts**: `compileExcludes(patterns: string[]): (path: string) => boolean`

- Trim each line; skip empty lines and lines starting with `#`.
- A pattern ending in `/` matches that folder and everything under it (`.obsidian/` matches `.obsidian/app.json` and `.obsidian/plugins/x/main.js`).
- `*` matches within one path segment; `**` matches across segments; `?` one character. No other syntax.
- Patterns are matched against the vault-relative path from the root (`notes/*.tmp` does not match `a/notes/x.tmp`, but `**/*.tmp` does).
- Escape regex metacharacters before converting. Compile once per settings change.

**model.ts**

- `parsePorcelainV2(z: string): RawEntry[]` for `git status --porcelain=v2 -z --untracked-files=all` output:
  - `1 XY …  <path>` → ordinary. `2 XY … <path>\0<origPath>` → rename/copy (note: path and orig path are separated by NUL with `-z`). `u XY …` → unmerged. `? <path>` → untracked. Ignore `#` header lines and `!` (ignored files).
- `statusFor(entry)`: map to badge, in this order:
  1. unmerged → `!`
  2. untracked → `U`
  3. rename line (`2`) with `R` → `R` (copies `C` → treat as `A`)
  4. X or Y is `D` → `D`
  5. X is `A` → `A`
  6. otherwise → `M`
- `parseNumstat(z: string)` for `git diff HEAD --numstat -z --no-renames`: `added\tdeleted\tpath\0`. `-\t-` means binary.
- `toChangedFiles(status, numstat, untrackedCounts, isExcluded, showUntracked)` merges, applies excludes and the untracked toggle, sorts with `localeCompare(undefined, { sensitivity: 'base', numeric: true })`.
- `summarize(files)` → `{ count, added, deleted }`.
- `buildTree(files)` → nested `{ name, path, children: Map, files: ChangedFile[] }`. Folders sort before files, both alphabetically. A folder's displayed count is the number of changed files beneath it.
- `adjacentFile(files, currentPath, direction)` for next/previous commands, in **tree display order** (depth-first, folders first), wrapping around.

**settings.ts**: `DEFAULT_CHANGES_SETTINGS`, `normalizeChangesSettings(unknown)` (type-checks every field, de-duplicates, trims patterns, falls back to defaults).

**Tests** (`tests/changes/exclude.test.ts`, `model.test.ts`, `settings.test.ts`): every badge mapping row above; rename lines with NUL-separated orig path; paths with spaces, Unicode, and leading `-`; binary numstat; excludes (`.obsidian/`, `**/*.tmp`, comments, blank lines, regex metacharacters like `a+b.md`); tree order and folder counts; next/previous wrap; settings normalization with garbage input.

### Phase 2 — Git reader: `git-status.ts`

`class GitStatusReader` (constructed with `vaultRoot` and a `gitPath()` getter; `dispose()` aborts in-flight work).

- `run(args, { encoding })` uses `execFile` (never `exec`, never `shell: true`), with the same options as upstream `git.ts`: `cwd: vaultRoot`, `windowsHide: true`, `timeout: 8000`, an `AbortSignal`, and env `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, `GIT_LITERAL_PATHSPECS=1`. `maxBuffer` 32 MiB for status/numstat.
  - `GIT_OPTIONAL_LOCKS=0` matters: it stops `git status` from refreshing the index lock while the owner runs git in a terminal.
- `verifyRoot()`: `git rev-parse --show-toplevel`. Compare `realpath()` of the result with `realpath(vaultRoot)`. Mismatch → error kind `not-root` ("The vault folder must be the Git repository root."). Command failure → `not-repo`. `ENOENT` → `git-missing` ("Git was not found. Set the Git executable in settings."). Killed → `timeout`.
- `head()`: `git rev-parse --verify --quiet HEAD` → hash or `null` (exit code 1 means no commits yet).
- `readChangeSet(settings, isExcluded)`:
  1. `git status --porcelain=v2 -z --untracked-files=all`
  2. `git diff <base> --numstat -z --no-renames` where `<base>` is `HEAD`, or the empty-tree hash `4b825dc642cb6eb9a060e54bf8d69288fbee4904` when `head()` is `null`. In that case also treat every listed file as `A`/`U`.
  3. For untracked, non-excluded files: read with `vault.getFileByPath()` + `vault.cachedRead()` if text (NUL check on the first 8 KiB via `vault.readBinary()` for unknown extensions); count lines; skip files over upstream's `maxFileMiB` setting (count them, but contribute 0 lines). Files outside Obsidian's index (e.g. in hidden folders) are counted as 0 lines.
  4. Return a `ChangeSet`.
- `readHeadBlob(path): Promise<Buffer | null>`: `git cat-file blob HEAD:<path>` with `encoding: 'buffer'`; `null` if the path does not exist in `HEAD`. Used by the plain diff view and discard.

**Tests** (`tests/changes/git-status.test.ts`, temporary repos exactly like upstream's `tests/git.test.ts`): clean repo → 0 files; modified, added (staged), deleted (unstaged and `git rm`), renamed after `git add -A`, untracked in nested folders, binary file, conflict (create a merge conflict), repo with no commits, vault that is a subfolder of the repo → `not-root`, missing git binary → `git-missing`. Assert that `git status` leaves no `index.lock` and that nothing in `.git` changes (compare `.git/index` mtime before and after).

### Phase 3 — Controller, ribbon, status bar, commands (`controller.ts`, `index.ts`)

`class ChangesController extends Component`, created in `installChanges` and attached with `plugin.addChild(controller)` so everything it registers is cleaned up on unload.

- **State**: `ChangesState`, `subscribe(listener): () => void`.
- **Refresh scheduling**:
  - `requestRefresh()` is debounced with Obsidian's `debounce(fn, 750, true)`.
  - Only one refresh runs at a time; a request that arrives during a run sets a `queued` flag and triggers exactly one more run afterward.
  - Triggers (all registered with `this.registerEvent` / `this.registerDomEvent`):
    - `vault.on('create' | 'modify' | 'delete' | 'rename')`, skipped when the path (and old path for rename) is excluded
    - `window` `focus` (catches commits made in a terminal)
    - `workspace.onLayoutReady` (first load; also ignores the burst of `create` events Obsidian fires at startup)
    - manual refresh button and command
    - after a discard completes
  - Upstream already re-reads `HEAD` for open notes on its own timer; the controller does not need to coordinate with it.
- **Ribbon**: `plugin.addRibbonIcon('git-compare', 'Open changes list', …)`.
- **Status bar**: `plugin.addStatusBarItem()` with class `unc-status`. Text: `Git: N changes`, `Git: no changes`, or `Git: error` (tooltip shows the message). Clickable and keyboard-accessible (`role="button"`, `tabindex="0"`, Enter/Space) like upstream's item. Hidden when `showStatusBar` is off. It sits beside upstream's own per-note `Git +n −m` item.
- **Commands** (no default hotkeys; names in sentence case; Obsidian prefixes the plugin name automatically):

| id | Name | Type |
|---|---|---|
| `open-changes-list` | Open changes list | `callback` |
| `refresh-changes-list` | Refresh changes list | `callback` |
| `open-next-changed-file` | Open next changed file | `checkCallback` (needs ≥1 change) |
| `open-previous-changed-file` | Open previous changed file | `checkCallback` (needs ≥1 change) |
| `discard-current-file` | Discard all changes in current file | `checkCallback` (active file is in the change set and its status allows discard) |

- **Opening the view**: `workspace.ensureSideLeaf(CHANGES_VIEW, 'left', { active: true, reveal: true })`. Never store the view; find it via `getLeavesOfType`.

**Tests** (`controller.test.ts`, with upstream's Obsidian mocks in `tests/helpers/`): debounce coalescing, single-flight queueing, excluded-path events ignored, unload aborts and stops listening.

### Phase 4 — Changes view (`changes-view.ts`)

`CHANGES_VIEW = 'uncommitted-changes-view'`, icon `git-compare`, display text "Changes".

Layout, top to bottom:

1. **Header row**: summary text `5 changes · +120 −40` (or "No changes since last commit") and two icon buttons using `setIcon`: *Refresh* (`refresh-cw`) and *Collapse all* / *Expand all* toggle (`chevrons-down-up`). Buttons have `aria-label`s and Obsidian tooltips via `setTooltip`.
2. **Tree**: folders with a collapse chevron, folder name, dimmed count. Files with the badge, then the file name. Full path in the row tooltip; renames show `old → new` in the tooltip.
3. **States**: loading (subtle text, keep showing the previous list while refreshing), empty, and error with the message plus an *Open settings* button for `git-missing`.

Rules:

- Build all DOM with `createDiv`/`createSpan`/`createEl`, re-render with `el.empty()`. No `innerHTML`.
- Re-render on controller updates; keep scroll position and keyboard focus across re-renders.
- Highlight the row of the note that is currently active (`workspace.on('active-leaf-change')`).
- Collapsing a folder updates `collapsedFolders` and saves settings (debounced). Prune entries for folders that no longer exist on each refresh.
- Badges: `unc-badge unc-badge-<letter>`, styled with Obsidian variables: `A`/`U` `--color-green`, `M` `--color-yellow`, `D` `--color-red`, `R` `--color-blue`, `!` `--color-orange`. Use `--text-muted`, `--background-modifier-hover`, `--interactive-accent`, `--font-ui-small`, `--size-4-*` spacing. Reuse the file-explorer look: rows use `tree-item` / `tree-item-self` / `tree-item-inner` / `tree-item-children` and `nav-folder` / `nav-file` classes so themes style them like the file explorer, plus `unc-` classes for anything new.
- Rows are focusable buttons; Enter opens; the `contextmenu` event (and Shift+F10 / the context-menu key) opens the menu.
- **Context menu** (`new Menu()`): a single item *Discard all changes* (icon `undo-2`, `setWarning(true)`). Disabled with a tooltip for `R` ("Discard isn't available for renames. Use Git in a terminal.") and `!` ("Resolve the conflict first.").
- Do **not** add items to Obsidian's own file explorer `file-menu` (upstream already adds "View Git diff" there for Markdown files).

### Phase 5 — Click routing (`open.ts`) and the plain diff view (`plain-diff-view.ts`)

**`openChangedFile(file: ChangedFile)`**

| Case | Behavior |
|---|---|
| Markdown, file exists (`A`, `M`, `U`, `R`, `!`) | If the note is already open in a leaf, reveal that leaf; else `workspace.getLeaf(false).openFile(tfile)` (reuses the current tab, like a normal click in the file explorer). Then call upstream `openDiff(path)` so the Better MD Diff panel shows that note on the right. Conflicts open too; upstream's panel already shows its conflict message |
| Other file, exists, Obsidian can display it | Extensions: `canvas`, `base`, `pdf`, `png`, `jpg`, `jpeg`, `gif`, `svg`, `webp`, `bmp`, `avif`, `mp3`, `wav`, `m4a`, `ogg`, `flac`, `webm`, `mp4`, `mov`, `mkv`. Open it as above, then show `PlainDiffView` for it |
| Other file, exists, not displayable (`.json`, `.css`, `.txt`, `.js`, …) | Show `PlainDiffView` only; do not open a broken tab |
| Deleted (`D`, any type) | `PlainDiffView` only (all lines red for text; "Binary file deleted" for binary) |

**`PlainDiffView`** (`PLAIN_DIFF_VIEW = 'uncommitted-plain-diff-view'`, opened with `ensureSideLeaf(PLAIN_DIFF_VIEW, 'right', …)`, state carries the path via `getState`/`setState` so it survives reloads).

- Header: file name, folder, badge, and `+a −d`.
- Text files: `before` = `readHeadBlob(path)` decoded as UTF-8 (or `''` if new/untracked); `after` = `vault.cachedRead(file)` (or `''` if deleted). Run upstream's exported `computeDiff(before, after, contextLines, limits)` from `src/diff.ts` (import only; do not modify it) and render its `hunks[].rows` as a simple unified list: old line number, new line number, `+`/`−`/space, text in `--font-monospace`. Added rows use `--background-modifier-success` / deleted rows `--background-modifier-error` (with low alpha via classes). No word-level highlighting, no restore buttons — this view is intentionally simple.
- Size and line limits: reuse upstream `maxFileMiB` / `maxLines` settings; over the limit, show "File is too large to diff" with both sizes.
- Binary: "Binary file changed" plus `HEAD` size → current size (from blob length and `file.stat.size`).
- Refresh when the controller reports a new change set or the shown file is modified; show "No longer changed" if it drops out of the set.

### Phase 6 — Discard (`discard.ts`)

`DiscardModal extends Modal`: title "Discard all changes?", body names the file and the exact effect, buttons *Cancel* (default focus) and *Discard* (`mod-warning`). Never skippable.

| Status | Effect | How |
|---|---|---|
| `M` | Restore content to `HEAD` | `readHeadBlob(path)`. If the note is open in a `MarkdownView`, replace the whole document through that view's `editor` in **one** `editor.transaction()` (undoable with Ctrl+Z; same approach upstream uses for restore). Otherwise text → `vault.process(file, () => headText)`; binary → `vault.modifyBinary(file, buffer)` |
| `D` | Recreate the file from `HEAD` | Create missing parent folders with `vault.createFolder(normalizePath(dir))`, then `vault.create` (text) or `vault.createBinary` (binary) |
| `A` (staged new), `U` (untracked) | Remove the file | `app.fileManager.trashFile(file)`; the body says "The file will be moved to trash" |
| `R`, `!` | Not offered | Menu item disabled (see Phase 4) |

Notes:

- Discard touches **only the working tree**, never the index. If the file had staged changes, it can still show as `M` afterward; the modal says so when `X ≠ ' '` in the porcelain entry ("Staged changes stay staged.").
- Before writing, re-read `HEAD` and the current file and abort with a notice if either changed since the modal opened (same freshness rule upstream uses for restore).
- After success: `new Notice('Discarded changes in <name>')`, then `controller.requestRefresh()`.
- Files Obsidian does not index (e.g. inside hidden folders) cannot be discarded through the Vault API; show the item disabled with "Use Git in a terminal for this file."

**Tests** (`discard.test.ts`, temp repo + mocked vault): `M` text and binary, `M` with the note open (editor transaction, single undo step), `D` including a deleted parent folder, `U` and `A` go to trash, freshness abort, `R`/`!` refused.

### Phase 7 — Settings section

`changesSettingGroup(plugin)` returns one group with heading **"Changes list"** (no word "settings"), using upstream's definition format so it works in both the 1.13+ settings search and the legacy `display()` fallback:

| Name | Control | Description |
|---|---|---|
| Show untracked files | Toggle | List new files Git doesn't track yet and diff them against an empty file. |
| Exclude patterns | Text area, one pattern per line | Paths to hide from the list. A trailing / hides a folder. Supports * and **. Lines starting with # are ignored. |
| Show change count in status bar | Toggle | — |

Changing any of these saves via `saveChangesSettings()` and triggers a refresh. The text area saves on `change`/blur, not every keystroke. The existing upstream "Git executable" setting is shared; no duplicate.

### Phase 8 — Polish, docs, install script

- Styles block finished; check light and dark themes and the default theme with "Translucent window" off and on.
- Accessibility: every icon button has `aria-label`; tree uses `role="tree"` / `treeitem` with `aria-expanded`; badges have `aria-label` ("Modified" etc.) since letters alone are terse.
- `scripts/install-to-vault.mjs` + `npm run install:vault`: requires `OBSIDIAN_VAULT` env var, refuses if `<vault>/.obsidian/plugins/better-md-diff` is enabled (read `community-plugins.json`) and prints how to disable it, then copies the three release files.
- README fork section: what the fork adds, the "don't enable both plugins" warning, install steps, the untracked/restore note from §6, and credit to kamacheng.
- Tip for the owner in README: add `.obsidian/plugins/uncommitted/` to the vault's `.gitignore` if plugin binaries shouldn't be committed.

### Phase 9 — Verification

1. `npm ci && npm run check` (lint, tests, types, build, release check) passes with zero warnings.
2. Isolated test vault (`.test-vault/`, already git-ignored upstream), which is a git repo with a few commits. Manual checklist:
   - [ ] List shows `M`, `A`, `D`, `R` (after `git add -A` of a rename), `U`, `!`, binary, nested folders; `.obsidian/` hidden.
   - [ ] Summary numbers match `git diff HEAD --numstat` plus untracked line counts.
   - [ ] Editing a note updates the list within ~1 s of autosave; committing in a terminal then switching back to Obsidian clears it.
   - [ ] Clicking a Markdown file opens it and the Better MD Diff panel; editor flags work; clicking an untracked note shows all lines added.
   - [ ] Clicking `.canvas` opens canvas + plain diff; `.json` shows only plain diff; deleted file shows all red; image shows "Binary file changed".
   - [ ] Discard: `M` (open note → Ctrl+Z undoes it), `M` (closed), `D` with missing folder, `U` goes to trash, staged-changes note shown, `R`/`!` disabled.
   - [ ] Commands appear in the palette, none has a default hotkey; next/previous wrap.
   - [ ] Status bar count correct; toggling the setting hides it.
   - [ ] Disable then re-enable the plugin: no duplicate ribbon/status items, no console errors, sidebar leaves remain where they were.
   - [ ] Vault in a subfolder of a repo shows the `not-root` error; renaming git to a bad path shows `git-missing`.
   - [ ] Console shows no logs during normal use; `.git/index.lock` never lingers.
3. Only then does the owner run `OBSIDIAN_VAULT=… npm run install:vault` against their real vault, after disabling Better MD Diff there.

---

## 8. Keeping up with upstream

```bash
git fetch upstream
git merge upstream/main        # never rebase published fork history
npm ci && npm run check
```

Conflicts should only appear in §6 touch points and identity files. After merging, re-run the Phase 9 checklist items for clicking Markdown files and untracked notes, because those rely on upstream's `openDiff()` signature and `GitReadError.reason`. If upstream changes either, adapt the wrapper in `src/main.ts`, not upstream code.

## 9. Definition of done

- All phases committed locally on `main-fork`; `npm run check` green.
- Phase 9 checklist fully ticked in the test vault.
- `AGENTS.md` present and accurate; `upstream` push URL is `DISABLED`; release workflow removed; no tags created.
- Upstream files changed only at the §6 touch points.
