import { useCallback, useEffect, useRef, useState } from 'react';
import type { FindHit, SearchResult, WorkspaceEntry } from '../../shared/workspace.ts';
import { workspaceApi } from '../client/workspace.ts';
import { matchesChord } from '../lib/keymap.ts';
import { CodeEditor } from './CodeEditor.tsx';

const SESSION_KEY = 'macterm.workspace.session.v1';
const MAX_RESTORED_TABS = 12;
const MAX_STORED_TAB = 512 * 1024;
const MAX_STORED_TOTAL = 3 * 1024 * 1024;

interface OpenTab {
  path: string;
  content: string;
  saved: string;
  readOnly: boolean;
  goto: { line: number; nonce: number } | null;
  cursor: { line: number; column: number };
}

interface StoredTab {
  path: string;
  content?: string;
  saved?: string;
  readOnly?: boolean;
}

interface StoredSession {
  root: string;
  active: string | null;
  tabs: StoredTab[];
}

interface Props {
  active: boolean;
  initialRoot?: string;
  restoreSession: boolean;
  dark: boolean;
  workspaceChord?: string;
  onClose: () => void;
  onToast: (message: string) => void;
}

type SidebarTab = 'files' | 'search';

const CODE_FILE = /\.(?:[cm]?[jt]sx?|jsonc?|css|s[ac]ss|less|html?|xml|mdx?|py|rs|go|java|kt|kts|c|cc|cpp|h|hpp|cs|rb|php|sh|bash|zsh|ps1|ya?ml|toml|ini|sql)$/i;

function isCodeFile(name: string): boolean {
  return CODE_FILE.test(name);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function separatorIndex(path: string): number {
  return Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
}

function baseName(path: string): string {
  const index = separatorIndex(path);
  return index === -1 ? path : path.slice(index + 1);
}

function parentPath(path: string): string {
  const index = separatorIndex(path);
  return index === -1 ? '' : path.slice(0, index);
}

function cleanPath(input: string | undefined): string {
  const value = (input ?? '').trim().replace(/^"(.*)"$/, '$1');
  if (/^\/[A-Za-z]:([\\/]|$)/.test(value)) return value.slice(1);
  return value;
}

function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession> | null;
    if (!parsed || typeof parsed.root !== 'string' || !Array.isArray(parsed.tabs)) return null;
    const tabs: StoredTab[] = [];
    for (const entry of parsed.tabs) {
      if (!entry || typeof entry !== 'object') continue;
      const tab = entry as StoredTab;
      if (typeof tab.path !== 'string') continue;
      tabs.push({
        path: tab.path,
        content: typeof tab.content === 'string' ? tab.content : undefined,
        saved: typeof tab.saved === 'string' ? tab.saved : undefined,
        readOnly: tab.readOnly === true,
      });
    }
    return {
      root: parsed.root,
      active: typeof parsed.active === 'string' ? parsed.active : null,
      tabs,
    };
  } catch {
    return null;
  }
}

function newTab(path: string, content: string, readOnly: boolean, goto: { line: number; nonce: number } | null): OpenTab {
  return {
    path,
    content,
    saved: content,
    readOnly,
    goto,
    cursor: { line: 1, column: 1 },
  };
}

export function Workspace({
  active,
  initialRoot,
  restoreSession,
  dark,
  workspaceChord,
  onClose,
  onToast,
}: Props) {
  const [root, setRoot] = useState('');
  const [rootInput, setRootInput] = useState(() => cleanPath(initialRoot));
  const [rootBusy, setRootBusy] = useState(false);
  const [rootError, setRootError] = useState('');
  const [entries, setEntries] = useState<WorkspaceEntry[] | null>(null);
  const [entriesTruncated, setEntriesTruncated] = useState(false);
  const [treeNonce, setTreeNonce] = useState(0);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pathOpen, setPathOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('files');
  const [filter, setFilter] = useState('');
  const [filterHits, setFilterHits] = useState<FindHit[]>([]);
  const [filterBusy, setFilterBusy] = useState(false);
  const [filterTruncated, setFilterTruncated] = useState(false);
  const [filterError, setFilterError] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState('');

  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [focusRequest, setFocusRequest] = useState<{ nonce: number; target: 'filter' | 'root' | 'search' } | null>(
    null,
  );
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const rootInputRef = useRef<HTMLInputElement | null>(null);
  const focusSeq = useRef(0);
  const searchSeq = useRef(0);
  const gotoSeq = useRef(0);
  const loadingFiles = useRef(new Set<string>());
  const savingRef = useRef(false);

  useEffect(() => {
    if (!focusRequest) return;
    const input =
      focusRequest.target === 'search'
        ? searchInputRef.current
        : focusRequest.target === 'filter'
          ? filterInputRef.current
          : rootInputRef.current;
    input?.focus();
    input?.select();
  }, [focusRequest]);

  function requestFocus(target: 'filter' | 'root' | 'search') {
    setFocusRequest({ nonce: ++focusSeq.current, target });
  }

  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null;
  const activeTabRef = useRef<OpenTab | null>(activeTab);
  const rootRef = useRef(root);
  const tabsRef = useRef(tabs);
  const activeRef = useRef(active);
  activeTabRef.current = activeTab;
  rootRef.current = root;
  tabsRef.current = tabs;
  activeRef.current = active;

  const buildRestoredTabs = useCallback(async (rootPath: string, session: StoredSession): Promise<OpenTab[]> => {
    const restored: OpenTab[] = [];
    for (const stored of session.tabs.slice(0, MAX_RESTORED_TABS)) {
      if (typeof stored.content === 'string') {
        restored.push({
          ...newTab(stored.path, stored.content, stored.readOnly === true, null),
          saved: typeof stored.saved === 'string' ? stored.saved : stored.content,
        });
        continue;
      }
      try {
        const data = await workspaceApi.read(rootPath, stored.path);
        restored.push(newTab(data.path, data.content, data.truncated, null));
      } catch {
        // The file may have been deleted since the session was saved.
      }
    }
    return restored;
  }, []);

  useEffect(() => {
    let alive = true;
    const stored = readSession();
    const preferred = restoreSession ? stored?.root || initialRoot : initialRoot || stored?.root;

    const boot = async () => {
      setRootBusy(true);
      setRootError('');
      let target = cleanPath(preferred);
      if (!target) {
        try {
          target = (await workspaceApi.system()).cwd;
        } catch (error) {
          if (alive) {
            setRootError(messageOf(error));
            setRootBusy(false);
          }
          return;
        }
      }
      try {
        const result = await workspaceApi.list(target, '');
        if (!alive) return;
        setRoot(result.root);
        setRootInput(result.root);
        setEntries(result.entries);
        setEntriesTruncated(result.truncated);
        if (restoreSession && stored && cleanPath(stored.root).toLowerCase() === result.root.toLowerCase()) {
          const restored = await buildRestoredTabs(result.root, stored);
          if (!alive) return;
          if (restored.length > 0) {
            setTabs(restored);
            setActivePath(restored.find((tab) => tab.path === stored.active)?.path ?? restored[0]?.path ?? null);
          }
        }
      } catch (error) {
        if (alive) setRootError(messageOf(error));
      } finally {
        if (alive) setRootBusy(false);
      }
    };

    void boot();
    return () => {
      alive = false;
    };
    // The workspace is mounted once per opening; initial props decide the root.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistNow = useCallback(() => {
    if (!root) return;
    const storedTabs: StoredTab[] = [];
    let budget = MAX_STORED_TOTAL;
    for (const tab of tabs) {
      const size = tab.content.length + tab.saved.length;
      if (size <= MAX_STORED_TAB && size <= budget) {
        storedTabs.push({
          path: tab.path,
          content: tab.content,
          saved: tab.saved,
          readOnly: tab.readOnly,
        });
        budget -= size;
      } else {
        storedTabs.push({ path: tab.path, readOnly: tab.readOnly });
      }
    }
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ root, tabs: storedTabs, active: activePath }));
    } catch {
      try {
        localStorage.setItem(
          SESSION_KEY,
          JSON.stringify({
            root,
            active: activePath,
            tabs: tabs.map((tab) => ({ path: tab.path, readOnly: tab.readOnly })),
          }),
        );
      } catch {
        // Private sessions without storage simply lose the elevation handoff.
      }
    }
  }, [root, tabs, activePath]);

  const persistRef = useRef(persistNow);
  persistRef.current = persistNow;

  useEffect(() => {
    if (!root || !active) return;
    const id = window.setTimeout(persistNow, 400);
    return () => window.clearTimeout(id);
  }, [persistNow, root, active]);

  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) persistRef.current();
    wasActive.current = active;
  }, [active]);

  useEffect(() => {
    const flush = () => {
      if (activeRef.current) persistRef.current();
    };
    window.addEventListener('macterm:persist-workspace', flush);
    return () => window.removeEventListener('macterm:persist-workspace', flush);
  }, []);

  useEffect(() => {
    const query = filter.trim();
    if (!root || !query) {
      setFilterHits([]);
      setFilterBusy(false);
      setFilterTruncated(false);
      setFilterError('');
      return;
    }
    let alive = true;
    const handle = window.setTimeout(() => {
      setFilterBusy(true);
      setFilterError('');
      void workspaceApi
        .find(root, query)
        .then((result) => {
          if (!alive) return;
          setFilterHits(result.results);
          setFilterTruncated(result.truncated);
        })
        .catch((error) => {
          if (alive) setFilterError(messageOf(error));
        })
        .finally(() => {
          if (alive) setFilterBusy(false);
        });
    }, 180);
    return () => {
      alive = false;
      window.clearTimeout(handle);
    };
  }, [filter, root]);

  async function openRoot(target: string, restore: StoredSession | null = null) {
    const cleaned = cleanPath(target);
    if (!cleaned) {
      setRootError('Enter a folder path');
      return;
    }
    if (tabsRef.current.some((tab) => tab.content !== tab.saved)) {
      if (!window.confirm('Opening another folder will discard unsaved changes. Continue?')) return;
    }
    setRootBusy(true);
    setRootError('');
    try {
      const result = await workspaceApi.list(cleaned, '');
      setRoot(result.root);
      setRootInput(result.root);
      setEntries(result.entries);
      setEntriesTruncated(result.truncated);
      setTreeNonce((value) => value + 1);
      setFilter('');
      setFilterHits([]);
      setFilterError('');
      setSearchQuery('');
      setSearchResults(null);
      setSearchError('');
      setSidebarTab('files');
      setPathOpen(false);
      setTabs([]);
      setActivePath(null);
      if (restore) {
        const restored = await buildRestoredTabs(result.root, restore);
        if (restored.length > 0) {
          setTabs(restored);
          setActivePath(restored.find((tab) => tab.path === restore.active)?.path ?? restored[0]?.path ?? null);
        }
      }
    } catch (error) {
      setRootError(messageOf(error));
    } finally {
      setRootBusy(false);
    }
  }

  async function refreshRoot() {
    if (!root) return;
    try {
      const result = await workspaceApi.list(root, '');
      setEntries(result.entries);
      setEntriesTruncated(result.truncated);
      setTreeNonce((value) => value + 1);
    } catch (error) {
      onToast(messageOf(error));
    }
  }

  async function openFile(path: string, line?: number) {
    if (!root) return;
    const nonce = ++gotoSeq.current;
    const existing = tabsRef.current.find((tab) => tab.path === path);
    if (existing) {
      setActivePath(path);
      if (line) {
        setTabs((previous) =>
          previous.map((tab) => (tab.path === path ? { ...tab, goto: { line, nonce } } : tab)),
        );
      }
      return;
    }
    if (loadingFiles.current.has(path)) return;
    loadingFiles.current.add(path);
    try {
      const data = await workspaceApi.read(root, path);
      setTabs((previous) => {
        if (previous.some((tab) => tab.path === data.path)) return previous;
        return [...previous, newTab(data.path, data.content, data.truncated, line ? { line, nonce } : null)];
      });
      setActivePath(data.path);
      if (data.truncated) onToast('This file is larger than 2 MB, so it opened read-only');
    } catch (error) {
      onToast(messageOf(error));
    } finally {
      loadingFiles.current.delete(path);
    }
  }

  function closeTab(path: string) {
    const index = tabs.findIndex((tab) => tab.path === path);
    const tab = tabs[index];
    if (!tab) return;
    if (tab.content !== tab.saved && !window.confirm(`Discard unsaved changes in ${baseName(path)}?`)) return;
    const remaining = tabs.filter((entry) => entry.path !== path);
    setTabs(remaining);
    if (activePath === path) {
      const next = remaining[Math.min(index, remaining.length - 1)];
      setActivePath(next?.path ?? null);
    }
  }

  const updateContent = useCallback((path: string, content: string) => {
    setTabs((previous) => previous.map((tab) => (tab.path === path ? { ...tab, content } : tab)));
  }, []);

  const updateCursor = useCallback((path: string, line: number, column: number) => {
    setTabs((previous) =>
      previous.map((tab) =>
        tab.path === path && (tab.cursor.line !== line || tab.cursor.column !== column)
          ? { ...tab, cursor: { line, column } }
          : tab,
      ),
    );
  }, []);

  const saveActive = useCallback(async () => {
    const tab = activeTabRef.current;
    const currentRoot = rootRef.current;
    if (!tab || !currentRoot || tab.readOnly || tab.content === tab.saved || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await workspaceApi.write(currentRoot, tab.path, tab.content);
      setTabs((previous) =>
        previous.map((entry) => (entry.path === tab.path ? { ...entry, saved: tab.content } : entry)),
      );
      onToast(`Saved ${baseName(tab.path)}`);
    } catch (error) {
      onToast(messageOf(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [onToast]);

  async function runSearch() {
    const query = searchQuery.trim();
    if (!root || !query) return;
    const id = ++searchSeq.current;
    setSearchBusy(true);
    setSearchError('');
    try {
      const result = await workspaceApi.search(root, query);
      if (id === searchSeq.current) setSearchResults(result);
    } catch (error) {
      if (id === searchSeq.current) {
        setSearchError(messageOf(error));
        setSearchResults(null);
      }
    } finally {
      if (id === searchSeq.current) setSearchBusy(false);
    }
  }

  function focusSearch() {
    setSidebarOpen(true);
    setSidebarTab('search');
    requestFocus('search');
  }

  function togglePathBar() {
    const next = !pathOpen;
    setPathOpen(next);
    if (next) requestFocus('root');
  }

  function requestClose() {
    if (tabsRef.current.some((tab) => tab.content !== tab.saved)) {
      if (!window.confirm('Close the workspace and discard unsaved changes?')) return;
    }
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore unavailable storage
    }
    onClose();
  }

  const handlersRef = useRef({ active, saveActive, focusSearch, requestClose, workspaceChord });
  handlersRef.current = { active, saveActive, focusSearch, requestClose, workspaceChord };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const handlers = handlersRef.current;
      if (!handlers.active) return;
      if (matchesChord('ctrl+s', event)) {
        event.preventDefault();
        event.stopPropagation();
        void handlers.saveActive();
        return;
      }
      if (matchesChord('ctrl+shift+f', event)) {
        event.preventDefault();
        event.stopPropagation();
        handlers.focusSearch();
        return;
      }
      if (handlers.workspaceChord && matchesChord(handlers.workspaceChord, event)) {
        event.preventDefault();
        event.stopPropagation();
        handlers.requestClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return (
    <section
      className="workspace"
      data-active={active ? 'true' : 'false'}
      data-dark={dark ? 'true' : 'false'}
      aria-label="Code workspace"
      aria-hidden={!active}
      inert={!active}
    >
      <header className="ws-header">
        <button
          type="button"
          className="ws-icon-btn ws-panel-toggle"
          aria-label="Toggle sidebar"
          aria-pressed={sidebarOpen}
          title="Toggle sidebar"
          onClick={() => setSidebarOpen((value) => !value)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
            <path d="M6.5 3v10" />
          </svg>
        </button>

        <div className="ws-open-tabs" role="tablist" aria-label="Open files">
          {tabs.map((tab) => (
            <div key={tab.path} className={`ws-tab ${tab.path === activePath ? 'ws-tab-active' : ''}`} title={tab.path}>
              <button
                type="button"
                role="tab"
                aria-selected={tab.path === activePath}
                className="ws-tab-name"
                onClick={() => setActivePath(tab.path)}
              >
                <FileGlyph code={isCodeFile(tab.path)} />
                <span className="ws-tab-label">{baseName(tab.path)}</span>
                {tab.content !== tab.saved && <span className="ws-dot" aria-label="Modified" />}
              </button>
              <button
                type="button"
                className="ws-tab-close"
                aria-label={`Close ${baseName(tab.path)}`}
                onClick={() => closeTab(tab.path)}
              >
                ×
              </button>
            </div>
          ))}
        </div>

      </header>

      {pathOpen && (
        <div className="ws-pathbar">
          <input
            ref={rootInputRef}
            value={rootInput}
            onChange={(event) => setRootInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void openRoot(rootInput);
              }
              if (event.key === 'Escape') setPathOpen(false);
            }}
            spellCheck={false}
            aria-label="Workspace folder"
            placeholder="Project folder"
          />
          <button type="button" className="ws-open" onClick={() => void openRoot(rootInput)} disabled={rootBusy}>
            Open
          </button>
          <button
            type="button"
            className="ws-icon-btn ws-path-cancel"
            aria-label="Cancel opening a folder"
            title="Cancel"
            onClick={() => setPathOpen(false)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      )}

      {rootError && <div className="ws-banner">{rootError}</div>}

      <div className="ws-body">
        {sidebarOpen && (
          <aside className="ws-sidebar">
            <div className="ws-sidebar-head">
              <button
                type="button"
                className="ws-project"
                title={`${root || 'Workspace'} — click to open another folder`}
                onClick={togglePathBar}
              >
                {baseName(root) || 'Workspace'}
              </button>
              <button
                type="button"
                className="ws-icon-btn ws-mini-icon"
                title="Refresh folder"
                aria-label="Refresh folder"
                disabled={rootBusy}
                onClick={() => void refreshRoot()}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M12.6 6.4A4.6 4.6 0 1 0 13 9.4" />
                  <path d="M12.6 2.8v3.6H9" />
                </svg>
              </button>
              <button
                type="button"
                className="ws-icon-btn ws-mini-icon"
                aria-label="Files"
                aria-pressed={sidebarTab === 'files'}
                data-active={sidebarTab === 'files' ? 'true' : 'false'}
                title="Files"
                onClick={() => {
                  setSidebarOpen(true);
                  setSidebarTab('files');
                  requestFocus('filter');
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M3 4.5h10M3 8h10M3 11.5h10" />
                </svg>
              </button>
              <button
                type="button"
                className="ws-icon-btn ws-mini-icon"
                aria-label="Search file contents"
                aria-pressed={sidebarTab === 'search'}
                data-active={sidebarTab === 'search' ? 'true' : 'false'}
                title="Search file contents (Ctrl+Shift+F)"
                onClick={focusSearch}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="7" cy="7" r="4.2" />
                  <path d="M10.2 10.2l3.3 3.3" />
                </svg>
              </button>
            </div>

            <div className="ws-field">
              <svg className="ws-field-icon" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="7" cy="7" r="4.2" />
                <path d="M10.2 10.2l3.3 3.3" />
              </svg>
              {sidebarTab === 'files' ? (
                <input
                  ref={filterInputRef}
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Filter files"
                  spellCheck={false}
                  aria-label="Filter files by name"
                />
              ) : (
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void runSearch();
                    }
                  }}
                  placeholder="Search file contents"
                  spellCheck={false}
                  aria-label="Search file contents"
                />
              )}
              {sidebarTab === 'search' ? (
                <button
                  type="button"
                  className="ws-field-submit"
                  aria-label="Search"
                  title="Search"
                  onClick={() => void runSearch()}
                  disabled={searchBusy}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3 8h9M9 4.5L12.5 8 9 11.5" />
                  </svg>
                </button>
              ) : (
                filterBusy && <span className="ws-spinner" aria-hidden="true" />
              )}
            </div>

            {sidebarTab === 'search' && (
              <div className="ws-search-meta">
                {searchResults
                  ? `${searchResults.results.length} matches in ${searchResults.scanned} files`
                  : 'Enter a query to search every file'}
                {searchResults?.truncated ? ' (shortened)' : ''}
              </div>
            )}

            <div className="ws-scroll">
              {sidebarTab === 'files' ? (
                filter.trim() ? (
                  <div className="ws-results">
                    {filterError && <div className="ws-empty">{filterError}</div>}
                    {!filterError && filterBusy && filterHits.length === 0 && (
                      <div className="ws-empty">Searching...</div>
                    )}
                    {!filterError && !filterBusy && filterHits.length === 0 && (
                      <div className="ws-empty">No files match</div>
                    )}
                    {filterHits.map((hit) => (
                      <button
                        type="button"
                        key={hit.path}
                        className={`ws-find ${hit.path === activePath ? 'ws-selected' : ''}`}
                        title={hit.path}
                        onClick={() => void openFile(hit.path)}
                      >
                        <FileGlyph code={isCodeFile(hit.name)} />
                        <span className="ws-find-text">
                          <span className="ws-find-name">{hit.name}</span>
                          <span className="ws-find-path">{parentPath(hit.path) || '.'}</span>
                        </span>
                      </button>
                    ))}
                    {filterTruncated && <div className="ws-note">Showing the first matches.</div>}
                  </div>
                ) : (
                  <div className="ws-tree" key={`${root}:${treeNonce}`}>
                    {rootBusy && !entries && <div className="ws-empty">Loading folder...</div>}
                    {entries?.map((entry) =>
                      entry.kind === 'dir' ? (
                        <Directory
                          key={entry.path}
                          root={root}
                          path={entry.path}
                          name={entry.name}
                          depth={0}
                          activePath={activePath}
                          onOpenFile={(path) => void openFile(path)}
                          onError={onToast}
                        />
                      ) : (
                        <FileRow
                          key={entry.path}
                          entry={entry}
                          depth={0}
                          active={entry.path === activePath}
                          onOpen={() => void openFile(entry.path)}
                        />
                      ),
                    )}
                    {entries && entries.length === 0 && <div className="ws-empty">This folder is empty</div>}
                    {entriesTruncated && <div className="ws-note">This folder listing was shortened.</div>}
                  </div>
                )
              ) : (
                <>
                  {searchError && <div className="ws-empty">{searchError}</div>}
                  {searchResults && searchResults.results.length === 0 && (
                    <div className="ws-empty">No matches</div>
                  )}
                  {searchResults?.results.map((hit, index) => {
                    const previous = searchResults.results[index - 1];
                    const showFile = !previous || previous.path !== hit.path;
                    return (
                      <div key={`${hit.path}:${hit.line}:${hit.column}`} className="ws-hit-group">
                        {showFile && (
                          <div className="ws-hit-file" title={hit.path}>
                            <FileGlyph code={isCodeFile(baseName(hit.path))} />
                            <span>{hit.path}</span>
                          </div>
                        )}
                        <button
                          type="button"
                          className="ws-hit"
                          title={`${hit.path}:${hit.line}`}
                          onClick={() => void openFile(hit.path, hit.line)}
                        >
                          <span className="ws-hit-line">{hit.line}</span>
                          <span className="ws-hit-text">{hit.preview || ' '}</span>
                        </button>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </aside>
        )}

        <div className="ws-main">
          {activeTab ? (
            <CodeEditor
              key={activeTab.path}
              fileName={activeTab.path}
              doc={activeTab.content}
              readOnly={activeTab.readOnly}
              goto={activeTab.goto}
              onChange={(content) => updateContent(activeTab.path, content)}
              onCursor={(line, column) => updateCursor(activeTab.path, line, column)}
              onSave={() => void saveActive()}
            />
          ) : (
            <div className="ws-welcome">
              <div className="ws-welcome-icon" aria-hidden="true">
                {'</>'}
              </div>
              <div className="ws-welcome-title">Open a file to start editing</div>
              <div className="ws-welcome-hint">
                Browse the explorer, filter by file name, or press Ctrl+Shift+F to search every file in this folder.
              </div>
              <div className="ws-welcome-keys">
                <span>
                  <kbd>Ctrl</kbd> + <kbd>S</kbd> save
                </span>
                <span>
                  <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd> search
                </span>
                <span>
                  <kbd>Shift</kbd> + <kbd>Alt</kbd> + <kbd>W</kbd> close
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className="ws-status">
        <span className="ws-status-path" title={activeTab?.path ?? root}>
          {activeTab?.path ?? root}
        </span>
        <span className="ws-status-items">
          {rootBusy && <span>Loading...</span>}
          {activeTab?.readOnly && <span>Read-only</span>}
          {activeTab && <span>{`Ln ${activeTab.cursor.line}, Col ${activeTab.cursor.column}`}</span>}
          {activeTab && (
            <span>{activeTab.content === activeTab.saved ? 'Saved' : saving ? 'Saving...' : 'Modified'}</span>
          )}
          <span>UTF-8</span>
        </span>
      </footer>
    </section>
  );
}

interface DirectoryProps {
  root: string;
  path: string;
  name: string;
  depth: number;
  activePath: string | null;
  onOpenFile: (path: string) => void;
  onError: (message: string) => void;
}

function Directory({ root, path, name, depth, activePath, onOpenFile, onError }: DirectoryProps) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<WorkspaceEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || entries !== null) return;
    let alive = true;
    setLoading(true);
    void workspaceApi
      .list(root, path)
      .then((result) => {
        if (alive) setEntries(result.entries);
      })
      .catch((failure) => {
        if (!alive) return;
        const message = messageOf(failure);
        setError(message);
        onError(message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, entries, root, path, onError]);

  return (
    <div className="ws-dir">
      <button
        type="button"
        className="ws-row ws-row-dir"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronGlyph open={open} />
        <FolderGlyph open={open} />
        <span className="ws-row-name">{name}</span>
      </button>
      {open && (
        <div className="ws-children">
          {loading && (
            <div className="ws-empty ws-indent" style={{ paddingLeft: `${8 + (depth + 1) * 16 + 20}px` }}>
              Loading...
            </div>
          )}
          {error && (
            <div className="ws-empty ws-indent" style={{ paddingLeft: `${8 + (depth + 1) * 16 + 20}px` }}>
              {error}
            </div>
          )}
          {entries?.map((entry) =>
            entry.kind === 'dir' ? (
              <Directory
                key={entry.path}
                root={root}
                path={entry.path}
                name={entry.name}
                depth={depth + 1}
                activePath={activePath}
                onOpenFile={onOpenFile}
                onError={onError}
              />
            ) : (
              <FileRow
                key={entry.path}
                entry={entry}
                depth={depth + 1}
                active={entry.path === activePath}
                onOpen={() => onOpenFile(entry.path)}
              />
            ),
          )}
          {entries && entries.length === 0 && (
            <div className="ws-empty ws-indent" style={{ paddingLeft: `${8 + (depth + 1) * 16 + 20}px` }}>
              Empty folder
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface FileRowProps {
  entry: WorkspaceEntry;
  depth: number;
  active: boolean;
  onOpen: () => void;
}

function FileRow({ entry, depth, active, onOpen }: FileRowProps) {
  return (
    <button
      type="button"
      className={`ws-row ws-row-file ${active ? 'ws-selected' : ''}`}
      style={{ paddingLeft: `${8 + depth * 16}px` }}
      title={entry.path}
      onClick={onOpen}
    >
      <span className="ws-row-spacer" aria-hidden="true" />
      <FileGlyph code={isCodeFile(entry.name)} />
      <span className="ws-row-name">{entry.name}</span>
    </button>
  );
}

function ChevronGlyph({ open }: { open: boolean }) {
  return (
    <svg
      className={`ws-caret ${open ? 'ws-caret-open' : ''}`}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path d="M6 3.5L10.5 8 6 12.5" />
    </svg>
  );
}

function FolderGlyph({ open }: { open: boolean }) {
  return (
    <svg className="ws-glyph" viewBox="0 0 16 16" aria-hidden="true">
      {open ? (
        <>
          <path d="M2 10.6V5.5A1.5 1.5 0 0 1 3.5 4h2.2l1.5 1.5h4.3A1.5 1.5 0 0 1 13 7v.6" />
          <path d="M2.1 11.2l1-3.1c.16-.5.63-.85 1.16-.85h9.2c.72 0 1.23.7 1.02 1.38l-.9 2.86c-.17.53-.66.9-1.22.9H3.2c-.72 0-1.23-.7-1.1-1.19z" />
        </>
      ) : (
        <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h2.2l1.5 1.5h4.3A1.5 1.5 0 0 1 13 7v4.5a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 2 11.5z" />
      )}
    </svg>
  );
}

function FileGlyph({ code }: { code: boolean }) {
  return (
    <svg className="ws-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 1.8h5l3 3v9.4H4z" />
      <path d="M9 1.8v3h3" />
      {code && <path d="M6.6 8.2L5.3 9.5l1.3 1.3M9.4 8.2l1.3 1.3-1.3 1.3" />}
    </svg>
  );
}
