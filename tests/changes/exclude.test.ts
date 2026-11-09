import { describe, expect, it } from 'vitest';
import { compileExcludes } from '../../src/changes/exclude';

describe('exclude patterns', () => {
  it('hides a folder and everything beneath it', () => {
    const excluded = compileExcludes(['.obsidian/']);
    expect(excluded('.obsidian/app.json')).toBe(true);
    expect(excluded('.obsidian/plugins/x/main.js')).toBe(true);
    expect(excluded('.obsidian')).toBe(true);
    expect(excluded('notes/.obsidian/app.json')).toBe(false);
    expect(excluded('notes/.obsidian.md')).toBe(false);
  });

  it('anchors patterns to the vault root', () => {
    const excluded = compileExcludes(['notes/*.tmp']);
    expect(excluded('notes/a.tmp')).toBe(true);
    expect(excluded('a/notes/a.tmp')).toBe(false);
    expect(excluded('notes/nested/a.tmp')).toBe(false);
  });

  it('supports ** across segments and * within one segment', () => {
    const excluded = compileExcludes(['**/*.tmp', 'build/*.log']);
    expect(excluded('a.tmp')).toBe(true);
    expect(excluded('a/b/c.tmp')).toBe(true);
    expect(excluded('build/x.log')).toBe(true);
    expect(excluded('build/nested/x.log')).toBe(false);
    expect(excluded('a/b/c.md')).toBe(false);
  });

  it('matches one character with ? and escapes regex metacharacters', () => {
    const excluded = compileExcludes(['a?.md', 'a+b.md', 'x(1).md', 'notes/[draft].md']);
    expect(excluded('ab.md')).toBe(true);
    expect(excluded('abc.md')).toBe(false);
    expect(excluded('a+b.md')).toBe(true);
    expect(excluded('aab.md')).toBe(false);
    expect(excluded('x(1).md')).toBe(true);
    expect(excluded('x1.md')).toBe(false);
    expect(excluded('notes/[draft].md')).toBe(true);
    expect(excluded('notes/d.md')).toBe(false);
  });

  it('ignores comments, blank lines and whitespace', () => {
    const excluded = compileExcludes(['  ', '# notes/', '  drafts/  ']);
    expect(excluded('anything.md')).toBe(false);
    expect(excluded('drafts/a.md')).toBe(true);
  });

  it('compiles an empty pattern list to a no-op matcher', () => {
    expect(compileExcludes([])('a.md')).toBe(false);
    expect(compileExcludes(['# only a comment'])(['a.md'][0]!)).toBe(false);
  });
});
