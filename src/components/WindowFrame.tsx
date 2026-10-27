import { useEffect, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  startWindowDrag,
  toggleMaximize,
} from '../client/platform.ts';
import { ShieldButton } from './ShieldButton.tsx';

export interface TabEntry {
  id: string;
  title: string;
  panes: number;
}

interface Props {
  dark: boolean;
  background: string;
  tabs: TabEntry[];
  activeTab: string;
  elevated: boolean;
  canElevate: boolean;
  elevating: boolean;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
  onOpenSettings: () => void;
  onElevate: () => void;
  children: ReactNode;
}

export function WindowFrame({
  dark,
  background,
  tabs,
  activeTab,
  elevated,
  canElevate,
  elevating,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onOpenSettings,
  onElevate,
  children,
}: Props) {
  const [focused, setFocused] = useState(() => document.hasFocus());
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const update = () => setFocused(document.hasFocus());
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const update = () => {
      void isWindowMaximized().then((value) => {
        if (alive) setMaximized(value);
      });
    };
    update();
    window.addEventListener('resize', update);
    return () => {
      alive = false;
      window.removeEventListener('resize', update);
    };
  }, []);

  const onChrome = (event: ReactMouseEvent) =>
    (event.target as HTMLElement).closest('button, .tab') === null;

  const drag = (event: ReactMouseEvent) => {
    if (event.button !== 0 || !onChrome(event)) return;
    startWindowDrag();
  };

  const zoom = (event: ReactMouseEvent) => {
    if (!onChrome(event)) return;
    toggleMaximize();
  };

  return (
    <div
      className={`window ${dark ? 'window-dark' : ''} ${maximized ? 'window-maximized' : ''}`}
      style={{ background }}
    >
      <header className="titlebar" onMouseDown={drag} onDoubleClick={zoom}>
        <div className="lights" data-focused={focused ? 'true' : 'false'}>
          <button
            type="button"
            className="light light-close"
            title="Close window"
            aria-label="Close window"
            onClick={closeWindow}
          >
            <svg viewBox="0 0 6 6" aria-hidden="true">
              <path d="M1 1l4 4M5 1L1 5" />
            </svg>
          </button>
          <button
            type="button"
            className="light light-min"
            title="Minimize"
            aria-label="Minimize"
            onClick={minimizeWindow}
          >
            <svg viewBox="0 0 6 6" aria-hidden="true">
              <path d="M1 3h4" />
            </svg>
          </button>
          <button
            type="button"
            className="light light-zoom"
            title="Maximize"
            aria-label="Maximize"
            onClick={toggleMaximize}
          >
            <svg viewBox="0 0 6 6" aria-hidden="true">
              <path d="M1.4 4.6h3.2V1.4" />
              <path d="M4.6 1.4H1.4v3.2" />
            </svg>
          </button>
        </div>

        <div className="tabs" role="tablist">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === activeTab}
              className={`tab ${tab.id === activeTab ? 'tab-active' : ''}`}
              title={tab.title}
              onClick={() => onSelectTab(tab.id)}
              onAuxClick={(event) => {
                if (event.button === 1) onCloseTab(tab.id);
              }}
            >
              <span className="tab-title">{tab.title}</span>
              {tab.panes > 1 && <span className="tab-badge">{tab.panes}</span>}
              <button
                type="button"
                className="tab-close"
                aria-label={`Close ${tab.title}`}
                title="Close tab"
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <button type="button" className="tab-add" aria-label="New tab" title="New tab" onClick={onNewTab}>
          +
        </button>
        <button
          type="button"
          className="tab-add"
          aria-label="Settings"
          title="Settings"
          onClick={onOpenSettings}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2 4h8M12 4h2M2 8h3M7 8h7M2 12h8M12 12h2" />
            <circle cx="11" cy="4" r="1.4" />
            <circle cx="6" cy="8" r="1.4" />
            <circle cx="11" cy="12" r="1.4" />
          </svg>
        </button>
        <ShieldButton
          className="tab-add"
          elevated={elevated}
          canElevate={canElevate}
          busy={elevating}
          onClick={onElevate}
        />
      </header>
      <div className="window-body">{children}</div>
    </div>
  );
}
