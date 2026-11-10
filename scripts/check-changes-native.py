"""Isolated desktop check that the changes list matches Obsidian's core tree styling.

Requires Python Playwright and an explicit Obsidian executable. Builds a throwaway vault and
profile under .test-vault/, never attaches to an existing profile, and checks the vault identity
before reading UI data. Compares computed row metrics of the changes list with the core file
explorer in the light and dark base themes, and saves sidebar screenshots for review.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--executable', required=True)
args = parser.parse_args()

repo = Path(__file__).resolve().parents[1]
work = repo / '.test-vault'
work.mkdir(exist_ok=True)
case = Path(tempfile.mkdtemp(prefix='native-', dir=work))
vault = case / 'vault'
profile = case / 'profile'
vault.mkdir(); profile.mkdir()
config = vault / '.obsidian'
plugin_dir = config / 'plugins' / 'uncommitted'
plugin_dir.mkdir(parents=True)
for name in ['main.js', 'manifest.json', 'styles.css']:
    shutil.copyfile(repo / 'dist' / 'uncommitted' / name, plugin_dir / name)
(config / 'community-plugins.json').write_text('["uncommitted"]', encoding='utf-8')
(profile / 'obsidian.json').write_text(json.dumps({'vaults': {'uncommitted-native': {'path': str(vault), 'ts': int(time.time() * 1000), 'open': True}}, 'autoUpdate': False}), encoding='utf-8')

files = {
    'Notes/Café 🎉.md': '# Café\n\nOld line.\n',
    'Notes/Deep/Beta.md': '# Beta\n',
    'Root note.md': 'Root.\n',
    'Gone.md': 'Removed soon.\n',
}
for path, text in files.items():
    (vault / path).parent.mkdir(parents=True, exist_ok=True)
    (vault / path).write_text(text, encoding='utf-8')
for command in [['init', '-q'], ['config', 'user.name', 'Native Check'], ['config', 'user.email', 'native@example.invalid'], ['config', 'commit.gpgsign', 'false'], ['add', *files], ['commit', '-qm', 'baseline']]:
    subprocess.run(['git', *command], cwd=vault, check=True, capture_output=True)
(vault / 'Notes/Café 🎉.md').write_text('# Café\n\nNew line.\n', encoding='utf-8')
(vault / 'Notes/Deep/Beta.md').write_text('# Beta\n\nMore.\n', encoding='utf-8')
(vault / 'Root note.md').write_text('Root, edited.\n', encoding='utf-8')
(vault / 'Gone.md').unlink()
(vault / 'Untracked.canvas').write_text('{"nodes":[],"edges":[]}\n', encoding='utf-8')

with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
log = (case / 'host.log').open('w', encoding='utf-8')
process = subprocess.Popen([args.executable, f'--user-data-dir={profile}', f'--remote-debugging-port={port}', '--disable-background-networking'], stdout=log, stderr=log)
report = {'vault': str(vault), 'themes': {}, 'mismatches': []}

PROPS = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontSize', 'fontWeight', 'lineHeight', 'borderRadius', 'color', 'backgroundColor', 'height']
MEASURE = """([selector, props]) => {
  const el = document.querySelector(selector);
  if (!el) return null;
  const style = getComputedStyle(el);
  const result = {};
  for (const prop of props) result[prop] = prop === 'height' ? `${el.getBoundingClientRect().height}px` : style[prop];
  const icon = el.querySelector('.collapse-icon');
  if (icon) {
    const iconStyle = getComputedStyle(icon);
    const svg = icon.querySelector('svg');
    result.iconWidth = iconStyle.width;
    result.iconMarginStart = iconStyle.marginInlineStart;
    result.iconColor = svg ? getComputedStyle(svg).color : 'none';
    result.iconSize = svg ? `${svg.getBoundingClientRect().width}x${svg.getBoundingClientRect().height}` : 'none';
  }
  return result;
}"""
PAIRS = {
    'file row': ('.workspace-leaf-content[data-type="file-explorer"] .nav-file-title[data-path="Root note.md"]', '.unc-file > .tree-item-self[data-path="Root note.md"]'),
    'folder row': ('.workspace-leaf-content[data-type="file-explorer"] .nav-folder-title[data-path="Notes"]', '.unc-folder > .tree-item-self[data-path="Notes"]'),
}


def stop_isolated_host():
    """Stop every process that uses the throwaway profile; sandboxed launchers can outlive the wrapper."""
    process.terminate()
    marker = f'--user-data-dir={profile}'.encode()
    for _ in range(20):
        remaining = []
        for entry in Path('/proc').iterdir() if Path('/proc').exists() else []:
            if not entry.name.isdigit() or int(entry.name) == os.getpid():
                continue
            try:
                if marker in (entry / 'cmdline').read_bytes():
                    remaining.append(int(entry.name))
            except OSError:
                continue
        if not remaining:
            break
        for pid in remaining:
            try:
                os.kill(pid, signal.SIGTERM)
            except OSError:
                pass
        time.sleep(0.5)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()


def connect_host(pw):
    for _ in range(60):
        if process.poll() is not None:
            raise RuntimeError('Isolated Obsidian process exited; refusing to attach to another instance.')
        try:
            return pw.chromium.connect_over_cdp(f'http://127.0.0.1:{port}', timeout=1000)
        except Exception:
            time.sleep(0.5)
    raise RuntimeError('Isolated Obsidian did not expose CDP; inspect host.log')


def reveal(page, view_type):
    page.evaluate("""async (type) => {
      const leaf = app.workspace.getLeavesOfType(type)[0];
      await app.workspace.revealLeaf(leaf);
    }""", view_type)
    page.wait_for_timeout(300)


def measure(page, selector, hover):
    page.mouse.move(0, 0)
    page.wait_for_timeout(150)
    if hover:
        page.hover(selector)
        page.wait_for_timeout(150)
    return page.evaluate(MEASURE, [selector, PROPS])


try:
    with sync_playwright() as pw:
        browser = connect_host(pw)
        page = browser.contexts[0].pages[0]
        page.wait_for_function('typeof app !== "undefined" && app.vault && app.workspace?.layoutReady', timeout=60000)
        if Path(page.evaluate('app.vault.adapter.getBasePath()')).resolve() != vault.resolve():
            raise RuntimeError('Vault identity mismatch; no UI data was read.')
        page.wait_for_function("app.plugins.plugins['uncommitted']?.store || [...document.querySelectorAll('button')].some(button => /Trust author and enable plugins/i.test(button.textContent))", timeout=90000)
        trust = page.get_by_role('button', name='Trust author and enable plugins')
        if trust.is_visible():
            trust.click(timeout=30000)
            trust.wait_for(state='hidden')
        page.wait_for_function("app.plugins.plugins['uncommitted']?.store", timeout=60000)
        page.evaluate('app.setting.close()')
        page.keyboard.press('Escape')
        page.evaluate("app.commands.executeCommandById('uncommitted:open-changes-list')")
        page.locator('.unc-file > .tree-item-self[data-path="Root note.md"]').wait_for(timeout=30000)
        page.evaluate("""async () => {
          const explorer = app.workspace.getLeavesOfType('file-explorer')[0];
          await app.workspace.revealLeaf(explorer);
          const folder = explorer.view.fileItems['Notes'];
          if (folder?.collapsed) folder.setCollapsed(false);
        }""")

        for theme in ['moonstone', 'obsidian']:
            page.evaluate('(theme) => app.changeTheme(theme)', theme)
            page.wait_for_timeout(400)
            results = {}
            for name, (core, ours) in PAIRS.items():
                for hover in [False, True]:
                    label = f'{name}{" (hover)" if hover else ""}'
                    reveal(page, 'file-explorer')
                    core_metrics = measure(page, core, hover)
                    reveal(page, 'uncommitted-changes-view')
                    our_metrics = measure(page, ours, hover)
                    results[label] = {'core': core_metrics, 'changes list': our_metrics}
                    if core_metrics is None or our_metrics is None:
                        report['mismatches'].append(f'{theme} {label}: element missing')
                        continue
                    for key, value in core_metrics.items():
                        if our_metrics.get(key) != value:
                            report['mismatches'].append(f'{theme} {label} {key}: core {value}, changes list {our_metrics.get(key)}')
            report['themes'][theme] = results
            reveal(page, 'uncommitted-changes-view')
            page.mouse.move(0, 0)
            page.locator('.workspace-split.mod-left-split').screenshot(path=str(case / f'changes-{theme}.png'))
            reveal(page, 'file-explorer')
            page.locator('.workspace-split.mod-left-split').screenshot(path=str(case / f'explorer-{theme}.png'))
        report['obsidian_version'] = page.evaluate('require("electron").ipcRenderer.sendSync("version")')
finally:
    stop_isolated_host()
    log.close()

(case / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
print(json.dumps({'case': str(case), 'mismatches': report['mismatches']}, indent=2, ensure_ascii=False))
sys.exit(1 if report['mismatches'] else 0)
