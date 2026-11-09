import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const roots = ['src', 'tests', 'scripts', 'docs', '.github'];
const rootFiles = [
  'README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'LICENSE',
  'manifest.json', 'package.json', 'package-lock.json', 'versions.json',
  'esbuild.config.mjs', 'eslint.config.mjs', 'vitest.config.mts', 'tsconfig.json', 'styles.css',
];
const extensions = new Set(['.ts', '.mts', '.js', '.mjs', '.json', '.md', '.yml', '.yaml', '.py', '.css']);
const chinese = /\p{Script=Han}/u;

async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(path));
    else if (extensions.has(path.slice(path.lastIndexOf('.')))) files.push(path);
  }
  return files;
}

const files = [...rootFiles];
for (const root of roots) files.push(...await collect(root));
const failures = [];
for (const file of files) {
  const text = await readFile(file, 'utf8');
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    if (chinese.test(lines[index])) failures.push(`${relative(process.cwd(), file)}:${index + 1}`);
  }
}
if (failures.length) {
  console.error(`Chinese text found in:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`English-only check passed for ${files.length} files.`);
