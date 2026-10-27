import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WindowFrame, type TabEntry } from './components/WindowFrame.tsx';
import { PaneTree } from './components/PaneTree.tsx';
import { FindBar } from './components/FindBar.tsx';
import { ShortcutsPanel } from './components/ShortcutsPanel.tsx';
import { SettingsPanel, type SettingsDraft } from './components/SettingsPanel.tsx';
import { Workspace } from './components/Workspace.tsx';
import { closeWindow } from './client/platform.ts';
import { workspaceApi } from './client/workspace.ts';
import type { SystemInfo } from '../shared/workspace.ts';
import type { PaneApi } from './components/TerminalView.tsx';
import {
  layoutReducer,
  listPanes,
  uid,
  type LayoutAction,
  type LayoutState,
  type PaneNode,
  type Tab,
} from './state/layout.ts';
import { themeOf, type ServerConfig } from './client/config.ts';
import { usePersistentReducer } from './hooks/usePersistentReducer.ts';
import { useKeymap } from './hooks/useKeymap.ts';
import { ACTIONS, type ActionName } from '../shared/config.ts';
import './styles/app.css';

const LAYOUT_KEY = 'macterm.layout.v2';
const PREFS_KEY = 'macterm.prefs.v1';
const WORKSPACE_REOPEN_KEY = 'macterm.workspace.reopen';

/** Read once per page load so React StrictMode's double render cannot eat the flag. */
const initialWorkspaceReopen = (() => {
  try {
    const open = localStorage.getItem(WORKSPACE_REOPEN_KEY) === '1';
    if (open) localStorage.removeItem(WORKSPACE_REOPEN_KEY);
    return open;
  } catch {
    return false;
  }
})();

interface Prefs {
  theme: string | null;
  fontSize: number | null;
  keymap: Partial<Record<ActionName, string>> | null;
}

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      return {
        theme: null,
        fontSize: null,
        keymap: null,
        ...(JSON.parse(raw) as Partial<Prefs>),
      };
    }
  } catch {
    // fall through to defaults
  }
  return { theme: null, fontSize: null, keymap: null };
}

function reviveLayout(raw: unknown): LayoutState | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as LayoutState;
  if (!Array.isArray(candidate.tabs) || candidate.tabs.length === 0) return null;
  if (typeof candidate.activeTab !== 'string' || typeof candidate.activePane !== 'string') return null;
  return candidate;
}

export function App({ config }: { config: ServerConfig }) {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);

  const makePane = useCallback(
    (): PaneNode => ({ kind: 'pane', id: uid('pane-'), sessionId: uid('s-'), shell: config.shell }),
    [config.shell],
  );

  const [layout, dispatch] = usePersistentReducer<LayoutState, LayoutAction>(
    LAYOUT_KEY,
    layoutReducer,
    () => {
      const pane = makePane();
      const tab: Tab = { id: uid('tab-'), title: 'Shell', root: pane };
      return { tabs: [tab], activeTab: tab.id, activePane: pane.id, zoomedPane: null };
    },
    reviveLayout,
  );

  const [titles, setTitles] = useState<Record<string, string>>({});
  const [findOpen, setFindOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceTabs, setWorkspaceTabs] = useState<string[]>(() =>
    initialWorkspaceReopen ? [layout.activeTab] : [],
  );
  const restoreWorkspaceTabs = useRef(
    new Set(initialWorkspaceReopen ? [layout.activeTab] : []),
  );
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [elevating, setElevating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef(0);
  const panes = useRef(new Map<string, PaneApi>());

  const themeName = prefs.theme ?? config.theme;
  const theme = useMemo(() => themeOf(config, themeName), [config, themeName]);
  const fontSize = prefs.fontSize ?? config.font.size;
  const keymap = useMemo<Record<ActionName, string>>(
    () => ({ ...config.keymap, ...(prefs.keymap ?? {}) }),
    [config.keymap, prefs.keymap],
  );
  const activeConfig = useMemo(
    () => ({ ...config, font: { ...config.font, size: fontSize } }),
    [config, fontSize],
  );

  const activeTab = layout.tabs.find((tab) => tab.id === layout.activeTab) ?? layout.tabs[0];
  const activePaneId = layout.activePane;
  const workspaceVisible = workspaceTabs.includes(layout.activeTab);

  const showToast = useCallback((message: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    void workspaceApi
      .system()
      .then((info) => {
        if (alive) setSystem(info);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const workspaceOpenRef = useRef(workspaceVisible);
  workspaceOpenRef.current = workspaceVisible;

  useEffect(() => {
    setWorkspaceTabs((previous) => {
      const ids = new Set(layout.tabs.map((tab) => tab.id));
      const next = previous.filter((id) => ids.has(id));
      return next.length === previous.length ? previous : next;
    });
  }, [layout.tabs]);

  const elevate = useCallback(async () => {
    if (elevating || !system?.canElevate) return;
    setElevating(true);
    showToast('Waiting for the Windows permission prompt...');
    try {
      if (workspaceOpenRef.current) {
        window.dispatchEvent(new Event('macterm:persist-workspace'));
        await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
      }
      const result = await workspaceApi.elevate();
      if (result.ok) {
        if (result.alreadyElevated) {
          setSystem((previous) => (previous ? { ...previous, elevated: true, canElevate: false } : previous));
          showToast('macterm is already running as administrator.');
          setElevating(false);
          return;
        }
        if (workspaceOpenRef.current) {
          try {
            localStorage.setItem(WORKSPACE_REOPEN_KEY, '1');
          } catch {
            // The elevated instance will start at the host's working folder.
          }
        }
        showToast('Restarting macterm as administrator...');
        closeWindow();
        setElevating(false);
        return;
      }
      showToast(result.canceled ? 'Elevation was canceled.' : (result.error ?? 'Could not elevate macterm.'));
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    }
    setElevating(false);
  }, [elevating, system?.canElevate, showToast]);

  const persistPrefs = useCallback((next: Prefs) => {
    setPrefs(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      // storage is unavailable; the override simply will not survive a reload
    }
  }, []);

  const saveSettings = useCallback(
    (next: SettingsDraft) => {
      const overrides: Partial<Record<ActionName, string>> = {};
      for (const action of ACTIONS) {
        const chord = next.keymap[action] ?? '';
        if (chord !== config.keymap[action]) overrides[action] = chord;
      }
      persistPrefs({ theme: next.theme, fontSize: next.fontSize, keymap: overrides });
      setSettingsOpen(false);
    },
    [config.keymap, persistPrefs],
  );

  const register = useCallback((paneId: string, api: PaneApi | null) => {
    if (api) panes.current.set(paneId, api);
    else panes.current.delete(paneId);
  }, []);

  const onTitle = useCallback((paneId: string, title: string) => {
    setTitles((previous) => (previous[paneId] === title ? previous : { ...previous, [paneId]: title }));
  }, []);

  const onCwd = useCallback(
    (paneId: string, cwd: string) => dispatch({ type: 'setCwd', paneId, cwd }),
    [dispatch],
  );

  const focusPane = useCallback((paneId: string) => dispatch({ type: 'activatePane', paneId }), [dispatch]);

  const split = useCallback(
    (axis: 'row' | 'col') => {
      if (!activeTab) return;
      const source = listPanes(activeTab.root).find((pane) => pane.id === activePaneId);
      const node = makePane();
      if (source?.cwd) node.cwd = source.cwd;
      dispatch({ type: 'split', paneId: activePaneId, direction: axis, node });
    },
    [activeTab, activePaneId, dispatch, makePane],
  );

  const newTab = useCallback(() => {
    const pane = makePane();
    dispatch({ type: 'newTab', tab: { id: uid('tab-'), title: 'Shell', root: pane } });
  }, [dispatch, makePane]);

  const closePane = useCallback(() => {
    panes.current.get(activePaneId)?.kill();
    dispatch({ type: 'closePane', paneId: activePaneId });
  }, [activePaneId, dispatch]);

  const actions = useMemo<Partial<Record<ActionName, () => void>>>(
    () => ({
      newTab,
      closeTab: () => dispatch({ type: 'closeTab', tabId: layout.activeTab }),
      closePane,
      splitRight: () => split('row'),
      splitDown: () => split('col'),
      focusNext: () => dispatch({ type: 'cyclePane', delta: 1 }),
      focusLeft: () => dispatch({ type: 'focusDirection', paneId: activePaneId, axis: 'row', sign: -1 }),
      focusRight: () => dispatch({ type: 'focusDirection', paneId: activePaneId, axis: 'row', sign: 1 }),
      focusUp: () => dispatch({ type: 'focusDirection', paneId: activePaneId, axis: 'col', sign: -1 }),
      focusDown: () => dispatch({ type: 'focusDirection', paneId: activePaneId, axis: 'col', sign: 1 }),
      prevTab: () => dispatch({ type: 'cycleTab', delta: -1 }),
      nextTab: () => dispatch({ type: 'cycleTab', delta: 1 }),
      zoomPane: () => dispatch({ type: 'zoom', paneId: activePaneId }),
      equalizePanes: () => dispatch({ type: 'equalize' }),
      fontUp: () => persistPrefs({ ...prefs, fontSize: Math.min(28, fontSize + 0.5) }),
      fontDown: () => persistPrefs({ ...prefs, fontSize: Math.max(9, fontSize - 0.5) }),
      fontReset: () => persistPrefs({ ...prefs, fontSize: null }),
      toggleTheme: () => {
        const names = Object.keys(config.themes);
        const index = names.indexOf(themeName);
        persistPrefs({ ...prefs, theme: names[(index + 1) % names.length] ?? names[0] ?? 'mac-light' });
      },
      find: () => setFindOpen(true),
      help: () => setHelpOpen((previous) => !previous),
      settings: () => setSettingsOpen(true),
      workspace: () =>
        setWorkspaceTabs((previous) =>
          previous.includes(layout.activeTab) ? previous : [...previous, layout.activeTab],
        ),
      clearBuffer: () => panes.current.get(activePaneId)?.clear(),
    }),
    [
      activePaneId,
      closePane,
      config.themes,
      dispatch,
      fontSize,
      layout.activeTab,
      newTab,
      persistPrefs,
      prefs,
      split,
      themeName,
    ],
  );

  useKeymap(
    keymap,
    actions,
    !findOpen && !helpOpen && !settingsOpen && !workspaceVisible,
  );

  const tabs: TabEntry[] = layout.tabs.map((tab) => {
    const firstPane = listPanes(tab.root)[0];
    return {
      id: tab.id,
      title: (firstPane ? titles[firstPane.id] : undefined) || tab.title,
      panes: listPanes(tab.root).length,
    };
  });

  return (
    <div className="desktop">
      <WindowFrame
        dark={isDark(theme.background)}
        background={theme.background}
        tabs={tabs}
        activeTab={layout.activeTab}
        elevated={system?.elevated ?? false}
        canElevate={system?.canElevate ?? false}
        elevating={elevating}
        onSelectTab={(tabId) => dispatch({ type: 'activateTab', tabId })}
        onCloseTab={(tabId) => dispatch({ type: 'closeTab', tabId })}
        onNewTab={newTab}
        onOpenSettings={() => setSettingsOpen(true)}
        onElevate={() => void elevate()}
      >
        {activeTab && (
          <PaneTree
            root={activeTab.root}
            config={activeConfig}
            theme={theme}
            activePane={activePaneId}
            zoomId={layout.zoomedPane}
            onFocus={focusPane}
            onTitle={onTitle}
            onCwd={onCwd}
            onRegister={register}
            onResize={(splitId, index, fraction) => dispatch({ type: 'resize', splitId, index, fraction })}
          />
        )}
        {layout.tabs.map((tab) => {
          if (!workspaceTabs.includes(tab.id)) return null;
          const tabPanes = listPanes(tab.root);
          const focusedPaneId = tab.id === layout.activeTab ? layout.activePane : tabPanes[0]?.id;
          const pane = tabPanes.find((entry) => entry.id === focusedPaneId) ?? tabPanes[0];
          return (
            <Workspace
              key={tab.id}
              active={tab.id === layout.activeTab}
              initialRoot={pane?.cwd}
              restoreSession={restoreWorkspaceTabs.current.has(tab.id)}
              dark={isDark(theme.background)}
              workspaceChord={keymap.workspace}
              onClose={() =>
                setWorkspaceTabs((previous) => previous.filter((id) => id !== tab.id))
              }
              onToast={showToast}
            />
          );
        })}
        <FindBar
          open={findOpen}
          onClose={() => setFindOpen(false)}
          onFind={(needle, backwards) => {
            const api = panes.current.get(activePaneId);
            if (!api || !needle) return;
            if (backwards) api.findPrev(needle);
            else api.findNext(needle);
          }}
        />
        <ShortcutsPanel open={helpOpen} keymap={keymap} onClose={() => setHelpOpen(false)} />
        <SettingsPanel
          open={settingsOpen}
          themes={config.themes}
          theme={themeName}
          fontSize={fontSize}
          keymap={keymap}
          defaults={{ theme: config.theme, fontSize: config.font.size, keymap: config.keymap }}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
        />
        {toast && (
          <div className="app-toast" role="status">
            {toast}
          </div>
        )}
      </WindowFrame>
    </div>
  );
}

function isDark(background: string): boolean {
  const hex = background.replace('#', '');
  if (hex.length < 6) return false;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}
