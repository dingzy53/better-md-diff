import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const css = readFileSync(join(root, 'styles.css'), 'utf8');
const start = css.indexOf('/* ==== fork: changes list ==== */');
const end = css.indexOf('/* ==== end fork ==== */');
const block = css.slice(start, end);
const source = readdirSync(join(root, 'src', 'changes'))
  .map((name) => readFileSync(join(root, 'src', 'changes', name), 'utf8'))
  .join('\n');

describe('changes list styles', () => {
  it('keeps the fork CSS in one delimited block at the end of styles.css', () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(css.slice(end).trim()).toBe('/* ==== end fork ==== */');
  });

  it('uses Obsidian variables instead of fixed or deprecated colors', () => {
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(block).not.toMatch(/\brgba?\(/);
    expect(block).not.toMatch(/-rgb\)/);
    expect(block).not.toContain('!important');
  });

  it('never styles the core file explorer classes', () => {
    expect(block).not.toMatch(/\.nav-(file|folder)/);
  });

  it('only styles classes that the plugin creates', () => {
    const classes = new Set(block.match(/\.unc-[a-z0-9-]+/g)?.map((name) => name.slice(1)));
    expect(classes.size).toBeGreaterThan(0);
    for (const name of classes) {
      // Status classes are built from a prefix plus the status, for example `unc-status-${status}`.
      const prefix = name.slice(0, name.lastIndexOf('-') + 1);
      expect(source.includes(name) || source.includes(`${prefix}\${`), name).toBe(true);
    }
  });
});
