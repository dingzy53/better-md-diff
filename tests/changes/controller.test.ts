// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { ChangesController, type ChangesControllerHost, type ChangesReader } from '../../src/changes/controller';
import { DEFAULT_CHANGES_SETTINGS } from '../../src/changes/settings';
import type { ChangeSet, ChangesSettings } from '../../src/changes/types';
import { DEFAULT_SETTINGS } from '../../src/options';

function emptySet(): ChangeSet {
  return { files: [], added: 0, deleted: 0, head: null, updatedAt: 0 };
}

function deferredReader() {
  const calls: { resolve: (set: ChangeSet) => void; reject: (error: unknown) => void }[] = [];
  const readChangeSet = vi.fn((_settings: ChangesSettings, _isExcluded: (path: string) => boolean) =>
    new Promise<ChangeSet>((resolve, reject) => { calls.push({ resolve, reject }); }));
  const dispose = vi.fn();
  const reader: ChangesReader = { readChangeSet, dispose };
  return { reader, readChangeSet, dispose, calls };
}

function makeHost(overrides: Partial<ChangesSettings> = {}) {
  const settings: ChangesSettings = { ...DEFAULT_CHANGES_SETTINGS, ...overrides };
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  let layoutReady: (() => void) | undefined;
  const vault = {
    on(type: string, handler: (...args: unknown[]) => void) {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
      return { dispose() {} };
    },
  };
  const workspace = {
    onLayoutReady(callback: () => void) { layoutReady = callback; },
    activeEditor: null,
  };
  const app = { vault, workspace } as unknown as App;
  const host: ChangesControllerHost = {
    app,
    vaultRoot: '/vault',
    settings: () => ({ ...DEFAULT_SETTINGS }),
    changesSettings: () => settings,
    saveChangesSettings: async () => {},
  };
  return {
    host,
    settings,
    emit(type: string, ...args: unknown[]) { for (const handler of handlers.get(type) ?? []) handler(...args); },
    ready() { layoutReady?.(); },
  };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 10; index++) await Promise.resolve();
}

let controller: ChangesController | undefined;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { controller?.unload(); controller = undefined; vi.useRealTimers(); document.body.replaceChildren(); });

describe('changes controller', () => {
  it('coalesces a burst of requests into one read after the debounce delay', async () => {
    const { host } = makeHost();
    const { reader, readChangeSet, calls } = deferredReader();
    controller = new ChangesController(host, reader);
    controller.load();

    controller.requestRefresh();
    controller.requestRefresh();
    controller.requestRefresh();
    await vi.advanceTimersByTimeAsync(749);
    expect(readChangeSet).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(readChangeSet).toHaveBeenCalledTimes(1);

    calls[0]!.resolve(emptySet());
    await flush();
    expect(controller.getState()).toMatchObject({ status: 'ready' });
  });

  it('keeps one read in flight and runs exactly one queued follow-up', async () => {
    const { host } = makeHost();
    const { reader, readChangeSet, calls } = deferredReader();
    controller = new ChangesController(host, reader);
    controller.load();

    controller.requestRefresh();
    await vi.advanceTimersByTimeAsync(750);
    expect(calls).toHaveLength(1);

    controller.requestRefresh();
    await vi.advanceTimersByTimeAsync(750);
    expect(calls).toHaveLength(1);

    calls[0]!.resolve(emptySet());
    await flush();
    expect(calls).toHaveLength(2);
    expect(readChangeSet).toHaveBeenCalledTimes(2);

    calls[1]!.resolve(emptySet());
    await flush();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(readChangeSet).toHaveBeenCalledTimes(2);
  });

  it('ignores vault events for excluded paths and refreshes for the rest', async () => {
    const { host, emit } = makeHost({ excludePatterns: ['.obsidian/'] });
    const { reader, readChangeSet, calls } = deferredReader();
    controller = new ChangesController(host, reader);
    controller.load();

    emit('create', { path: '.obsidian/app.json' });
    await vi.advanceTimersByTimeAsync(750);
    expect(readChangeSet).not.toHaveBeenCalled();

    emit('create', { path: 'note.md' });
    await vi.advanceTimersByTimeAsync(750);
    expect(readChangeSet).toHaveBeenCalledTimes(1);
    calls[0]!.resolve(emptySet());
    await flush();

    emit('rename', { path: '.obsidian/renamed.json' }, '.obsidian/original.json');
    await vi.advanceTimersByTimeAsync(750);
    expect(readChangeSet).toHaveBeenCalledTimes(1);

    emit('rename', { path: 'note-renamed.md' }, '.obsidian/original.json');
    await vi.advanceTimersByTimeAsync(750);
    expect(readChangeSet).toHaveBeenCalledTimes(2);
  });

  it('refreshes on window focus and layout ready', async () => {
    const { host, ready } = makeHost();
    const { reader, readChangeSet, calls } = deferredReader();
    controller = new ChangesController(host, reader);
    controller.load();

    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(750);
    expect(readChangeSet).toHaveBeenCalledTimes(1);
    calls[0]!.resolve(emptySet());
    await flush();

    ready();
    await vi.advanceTimersByTimeAsync(750);
    expect(readChangeSet).toHaveBeenCalledTimes(2);
  });

  it('stops listening and disposes the reader on unload', async () => {
    const { host, emit } = makeHost();
    const { reader, readChangeSet, dispose } = deferredReader();
    const controllerToUnload = new ChangesController(host, reader);
    const listener = vi.fn();
    controllerToUnload.subscribe(listener);
    controllerToUnload.load();
    controllerToUnload.unload();

    expect(dispose).toHaveBeenCalledTimes(1);
    controllerToUnload.requestRefresh();
    emit('create', { path: 'note.md' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(readChangeSet).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(controllerToUnload.getState()).toEqual({ status: 'loading' });
  });

  it('surfaces reader errors with their kind', async () => {
    const { host } = makeHost();
    const { reader, calls } = deferredReader();
    controller = new ChangesController(host, reader);
    controller.load();
    controller.requestRefresh();
    await vi.advanceTimersByTimeAsync(750);
    calls[0]!.reject(Object.assign(new Error('The vault folder must be the Git repository root.'), { kind: 'not-root' }));
    await flush();
    expect(controller.getState()).toEqual({
      status: 'error',
      kind: 'not-root',
      message: 'The vault folder must be the Git repository root.',
    });
  });

  it('passes the compiled exclude matcher to the reader', async () => {
    const { host } = makeHost({ excludePatterns: ['drafts/'] });
    const { reader, readChangeSet, calls } = deferredReader();
    controller = new ChangesController(host, reader);
    controller.load();
    void controller.refreshNow();
    await flush();
    expect(readChangeSet).toHaveBeenCalledTimes(1);
    const matcher = readChangeSet.mock.calls[0]![1];
    expect(matcher('drafts/a.md')).toBe(true);
    expect(matcher('notes/a.md')).toBe(false);
    calls[0]!.resolve(emptySet());
    await flush();
  });
});
