import { access, copyFile, mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const vault = process.env.OBSIDIAN_VAULT;
if (!vault) {
  console.error('Set OBSIDIAN_VAULT to the vault folder before installing.');
  console.error('Example: OBSIDIAN_VAULT="$HOME/notes" npm run install:vault');
  process.exit(1);
}

const root = resolve(vault);
const configDir = '.obsidian';
const source = 'dist/uncommitted';
const files = ['main.js', 'manifest.json', 'styles.css'];

try {
  await access(join(root, configDir));
} catch {
  console.error(`${root} does not look like an Obsidian vault (missing ${configDir}/).`);
  process.exit(1);
}

let enabled = [];
try {
  enabled = JSON.parse(await readFile(join(root, configDir, 'community-plugins.json'), 'utf8'));
} catch {
  enabled = [];
}
if (Array.isArray(enabled) && enabled.includes('better-md-diff')) {
  console.error('Better MD Diff is enabled in this vault. Uncommitted uses the same internal view type,');
  console.error('so both plugins cannot run together. Disable Better MD Diff in Settings → Community plugins,');
  console.error('then run this command again.');
  process.exit(1);
}

for (const file of files) {
  try {
    await access(join(source, file));
  } catch {
    console.error(`Missing ${source}/${file}. Run "npm run build" first.`);
    process.exit(1);
  }
}

const target = join(root, configDir, 'plugins', 'uncommitted');
await mkdir(target, { recursive: true });
for (const file of files) await copyFile(join(source, file), join(target, file));
console.log(`Installed Uncommitted into ${target}.`);
console.log('Reload Obsidian (or disable and re-enable the plugin) to pick it up.');
