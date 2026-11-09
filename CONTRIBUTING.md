# Contributing

This is a personal fork. Small fixes and regression tests are welcome, but the owner decides scope.

Do not include real notes, tokens, personal paths, or vault data in issues, tests, or recordings.

## Setup

Use Node.js 22.12+ (22.x) or 24+, npm, and a local Git installation:

```bash
npm ci
npm run check
npm run dev
```

`npm run check` runs ESLint with zero warnings, the tests, strict TypeScript checking, the production build, and release validation. Install dependencies before linting: missing Obsidian, CodeMirror, Node, or `diff` declarations produce misleading `no-unsafe-*` errors.

## Rules

- Write English only: UI, docs, comments, scripts, tests, and commit messages.
- Keep Git operations read-only. Never add staging, reset, checkout, commit, push, or implicit file writes.
- Keep per-change restoration behind confirmation, cancellation, fresh `HEAD`/buffer checks, and one undoable editor transaction.
- Add regression tests at public interfaces. Tests may use temporary Git repositories and mock the Obsidian boundary.
- Use an isolated test vault for real Obsidian checks. Test Source mode, Live Preview, popout windows, copy, restore, cancel, and undo.
- Do not commit `node_modules`, build output, `data.json`, personal settings, or test vaults.
- Do not reformat upstream code. See [AGENTS.md](AGENTS.md) for the merge touch points.

## Manual host checks

The scripts in `scripts/` are optional probes for a real desktop Obsidian. They require Python 3.10+, Playwright, and an explicit Obsidian executable:

```bash
python scripts/host-smoke.py --executable "/path/to/Obsidian"
python scripts/check-editor-stability.py --executable "/path/to/Obsidian"
python scripts/check-whitespace-layout.py
python scripts/record-demo.py --executable "/path/to/Obsidian"
```

They create an isolated vault under `.test-vault/` and never attach to or modify the owner's vault.

## Packaging

There is no release workflow. Build locally and install into a test vault:

```bash
npm run build
OBSIDIAN_VAULT=/path/to/test-vault npm run install:vault
```

Keep `package.json`, `manifest.json`, `versions.json`, and the lockfile on the same version.
