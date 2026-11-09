// Test-only runtime host boundary: the npm Obsidian SDK ships declarations only.
export function setIcon(element: HTMLElement, name: string): void { element.dataset.icon = name; }

export interface MockDebouncer<T extends unknown[]> {
  (...args: T): void;
  cancel(): void;
  run(): void;
}

export function debounce<T extends unknown[]>(callback: (...args: T) => void, timeout = 0, resetTimer = false): MockDebouncer<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let args: T;
  const debounced = (...next: T): void => {
    args = next;
    if (timer !== undefined) {
      if (!resetTimer) return;
      clearTimeout(timer);
    }
    timer = setTimeout(() => { timer = undefined; callback(...args); }, timeout);
  };
  debounced.cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  debounced.run = (): void => {
    debounced.cancel();
    callback(...args);
  };
  return debounced;
}

export class Component {
  private cleanupCallbacks: (() => void)[] = [];
  private children: Component[] = [];
  private loaded = false;

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.onload();
    for (const child of this.children) child.load();
  }

  unload(): void {
    if (!this.loaded) return;
    this.loaded = false;
    this.onunload();
    for (const child of this.children) child.unload();
    for (const cleanup of this.cleanupCallbacks.splice(0)) cleanup();
  }

  onload(): void {}
  onunload(): void {}

  register(cleanup: () => void): void { this.cleanupCallbacks.push(cleanup); }

  registerEvent(ref: { dispose?: () => void }): void {
    this.register(() => ref.dispose?.());
  }

  registerDomEvent(target: EventTarget, type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): void {
    target.addEventListener(type, listener, options);
    this.register(() => target.removeEventListener(type, listener, options));
  }

  addChild<T extends Component>(component: T): T {
    this.children.push(component);
    if (this.loaded) component.load();
    return component;
  }

  removeChild<T extends Component>(component: T): T {
    this.children = this.children.filter((child) => child !== component);
    component.unload();
    return component;
  }
}
export class Modal {
  titleEl = document.createElement('h2');
  contentEl = document.createElement('div');
  onOpen(): void {}
  onClose(): void {}
  open(): void { document.body.append(this.titleEl, this.contentEl); this.onOpen(); }
  close(): void { this.onClose(); this.titleEl.remove(); this.contentEl.remove(); }
}
export class ItemView {
  app = {};
  contentEl = document.createElement('div');
  containerEl = this.contentEl;
  private cleanups: (() => void)[] = [];
  register(cleanup: () => void): void { this.cleanups.push(cleanup); }
  registerDomEvent(target: EventTarget, type: string, listener: EventListener): void {
    target.addEventListener(type, listener);
    this.register(() => target.removeEventListener(type, listener));
  }
  unload(): void { for (const cleanup of this.cleanups.splice(0)) cleanup(); }
}
