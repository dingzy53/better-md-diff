// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { selectedDiffText } from '../src/diff-copy';

function fixture() {
  const body = document.createElement('div');
  body.innerHTML = '<button>Change 1 · Restore here</button><div><span>20 +</span><code class="bmd-row-text">Prefix<mark>Added</mark>suffix<span class="bmd-no-newline">No final newline</span></code></div><div><span>21 +</span><code class="bmd-row-text" data-source-empty> </code></div><div><span>22 +</span><code class="bmd-row-text">Next line<span data-symbol="·"> </span><span data-symbol="→">\t</span></code></div>';
  return body;
}

describe('copying selected raw Markdown', () => {
  it('excludes headers, line numbers, signs and newline hints', () => {
    const body = fixture();
    const range = document.createRange(); range.selectNodeContents(body);
    expect(selectedDiffText(body, range)).toBe('PrefixAddedsuffix\n\nNext line \t');
  });

  it('copies partial text across highlight nodes without adding spaces', () => {
    const body = fixture();
    const code = body.querySelector('code')!;
    const range = document.createRange();
    range.setStart(code.firstChild!, 1);
    range.setEnd(code.querySelector('mark')!.firstChild!, 1);
    expect(selectedDiffText(body, range)).toBe('refixA');
  });

  it('does not include hint-only selections', () => {
    const body = fixture();
    const range = document.createRange(); range.selectNodeContents(body.querySelector('.bmd-no-newline')!);
    expect(selectedDiffText(body, range)).toBeUndefined();
  });

  it('leaves selections outside the diff and collapsed selections to the host', () => {
    const body = fixture();
    const outside = document.createElement('p'); outside.textContent = 'Original';
    const range = document.createRange(); range.selectNodeContents(outside);
    expect(selectedDiffText(body, range)).toBeUndefined();
    range.selectNodeContents(body.querySelector('code')!); range.collapse(true);
    expect(selectedDiffText(body, range)).toBeUndefined();
  });

  it('preserves a selected line boundary and skips unselected later rows', () => {
    const body = fixture();
    const codes = body.querySelectorAll('code');
    const range = document.createRange();
    range.setStart(codes[0]!.firstChild!, 0);
    range.setEnd(codes[2]!.firstChild!, 1);
    expect(selectedDiffText(body, range)).toBe('PrefixAddedsuffix\n\nN');
  });
});
