# AGENTS.md — rules for any coding agent in this repository

## What this repo is

A PERSONAL fork of Better MD Diff (https://github.com/kamacheng/better-md-diff, MIT) named "Uncommitted".
It adds a left-sidebar list of files changed since the last commit. The plan is in PLAN.md.
It is for the owner's own vault only.

Local layout differs from PLAN.md §4.1 in one respect: the checkout folder is `better-md-diff/`, the
owner's private repository is `dingzy53/better-md-diff`, and `origin` points at that repository.
There is no separate `uncommitted` repository. The plugin identity (`uncommitted`) is independent of
the repository name.

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
  Any other upstream edit needs a one-line reason added to that list. Current extra touch points:
  - `tests/helpers/obsidian.ts` gains host-boundary stubs (`Component`, `debounce`, `Menu`, `MarkdownView`, `Notice`, `TFolder`, `normalizePath`) needed by the new tests.
  - `tests/helpers/obsidian-setting.ts` gains `addTextArea` for the exclude-patterns control.
  - `tests/settings.test.ts` expects the appended "Changes list" group.
  - `package.json` gains the `install:vault` script.
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

- 2026-11-09: docs.obsidian.md/Plugins/User+interface/Views matches PLAN.md §3; the pinned
  `obsidian@1.13.1` typings confirm `Workspace.ensureSideLeaf` (1.7.2), `FileManager.trashFile`
  (1.6.6), `Vault.process`, `Vault.getFileByPath`, and `PluginSettingTab.getSettingDefinitions`
  (1.13.0) as described. No policy differences found; no code changes required.
- 2026-11-09: `eslint-plugin-obsidianmd`'s `hardcoded-config-path` rule rejects a literal `.obsidian/`
  default. The default exclude pattern is therefore supplied at runtime from `Vault#configDir`
  (`DEFAULT_CHANGES_SETTINGS.excludePatterns` itself is empty); behavior is unchanged, and the pattern
  remains editable in settings.
