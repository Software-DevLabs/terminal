interface TauriWindow {
  close: () => Promise<void>;
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  startDragging: () => Promise<void>;
}

interface TauriGlobal {
  window?: { getCurrentWindow?: () => TauriWindow };
}

function hostWindow(): TauriWindow | null {
  const global = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
  return global?.window?.getCurrentWindow?.() ?? null;
}

export function closeWindow(): void {
  const api = hostWindow();
  if (api) {
    void api.close();
    return;
  }
  window.close();
}

export function minimizeWindow(): void {
  void hostWindow()?.minimize();
}

export function toggleMaximize(): void {
  void hostWindow()?.toggleMaximize();
}

export function startWindowDrag(): void {
  void hostWindow()?.startDragging();
}

export async function isWindowMaximized(): Promise<boolean> {
  return (await hostWindow()?.isMaximized()) ?? false;
}
