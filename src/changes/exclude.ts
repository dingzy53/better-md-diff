export type ExcludeMatcher = (path: string) => boolean;

const META = /[.*+?^${}()|[\]\\]/;

function escapeRegExp(character: string): string {
  return META.test(character) ? `\\${character}` : character;
}

/**
 * Compile settings patterns into one path predicate. Supported syntax is
 * deliberately small: a trailing `/` targets a folder tree, `*` stays inside
 * one path segment, `**` crosses segments, and `?` matches one character.
 * Patterns match the whole vault-relative path (no implicit prefix matching).
 */
export function compileExcludes(patterns: readonly string[]): ExcludeMatcher {
  const matchers: RegExp[] = [];
  for (const value of patterns) {
    const pattern = value.trim();
    if (!pattern || pattern.startsWith('#')) continue;
    const folder = pattern.endsWith('/');
    const body = folder ? pattern.slice(0, -1) : pattern;
    if (!body) continue;
    let source = '';
    for (let index = 0; index < body.length; index++) {
      const character = body[index]!;
      if (character === '*') {
        if (body[index + 1] === '*') {
          if (body[index + 2] === '/') {
            source += '(?:.*/)?';
            index += 2;
          } else {
            source += '.*';
            index += 1;
          }
        } else {
          source += '[^/]*';
        }
      } else if (character === '?') {
        source += '[^/]';
      } else {
        source += escapeRegExp(character);
      }
    }
    matchers.push(new RegExp(`^${source}${folder ? '(?:/.*)?' : ''}$`));
  }
  if (!matchers.length) return () => false;
  return (path) => matchers.some((matcher) => matcher.test(path));
}
