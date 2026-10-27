import { useEffect, useRef } from 'react';
import type { Terminal } from '@xterm/xterm';
import { PtyConnection } from '../client/connection.ts';
import { createTerminal, type TerminalHandle } from '../term/createTerminal.ts';
import { clearScrollbackOnErase } from '../term/clearScrollback.ts';
import type { AppConfig, ThemeSpec } from '../../shared/config.ts';
import type { PaneNode } from '../state/layout.ts';

export interface PaneApi {
  term: Terminal;
  focus: () => void;
  clear: () => void;
  kill: () => void;
  findNext: (needle: string) => void;
  findPrev: (needle: string) => void;
}

interface Props {
  pane: PaneNode;
  config: AppConfig;
  theme: ThemeSpec;
  active: boolean;
  dimmed: boolean;
  onFocus: (paneId: string) => void;
  onTitle: (paneId: string, title: string) => void;
  onCwd: (paneId: string, cwd: string) => void;
  onRegister: (paneId: string, api: PaneApi | null) => void;
}

export function TerminalView({
  pane,
  config,
  theme,
  active,
  dimmed,
  onFocus,
  onTitle,
  onCwd,
  onRegister,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<TerminalHandle | null>(null);
  const latest = useRef({ onTitle, onCwd, onFocus, onRegister });
  latest.current = { onTitle, onCwd, onFocus, onRegister };

  const paneId = pane.id;
  const sessionId = pane.sessionId;
  const shell = pane.shell;
  const cwd = pane.cwd;
  const fontSize = config.font.size;
  const fontFamily = config.font.family;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const handle = createTerminal(host, config, theme, (nextCwd) => latest.current.onCwd(paneId, nextCwd));
    handleRef.current = handle;
    handle.term.attachCustomKeyEventHandler(isAppChord);

    const measure = () => {
      const fitted = handle.fit.proposeDimensions();
      if (!fitted || !Number.isFinite(fitted.cols) || !Number.isFinite(fitted.rows)) return;
      if (fitted.cols !== handle.term.cols || fitted.rows !== handle.term.rows) {
        handle.term.resize(Math.max(2, fitted.cols), Math.max(1, fitted.rows));
      }
    };
    // Before connecting: the pty must spawn at the pane's real size, not xterm's
    // 80x24 default, or ConPTY's layout never matches the grid it is drawn on.
    measure();

    const connection = new PtyConnection({
      sessionId,
      shell,
      cwd,
      cols: handle.term.cols,
      rows: handle.term.rows,
      onBytes: (bytes) => handle.term.write(bytes),
      onEvent: (event) => {
        if (event.type === 'ready') {
          // The host replays its ring buffer right after this, so start from a
          // clean grid instead of doubling up whatever a previous render painted.
          handle.term.reset();
          latest.current.onCwd(paneId, event.cwd);
        } else if (event.type === 'exit') {
          handle.term.writeln('');
          handle.term.writeln(
            `\u001b[0m\u001b[90m[Process ${event.code === 0 ? 'completed' : `exited with code ${event.code ?? 'unknown'}`}]`,
          );
          handle.term.write('\u001b[?25l');
        } else if (event.type === 'error') {
          handle.term.writeln(`\u001b[31m[macterm] ${event.message}`);
        }
      },
      onStatus: () => undefined,
    });

    // A cleared screen should not come back on the next scroll or reload.
    clearScrollbackOnErase(handle.term, () => connection.clearHistory());

    handle.term.onData((data) => connection.write(data));
    handle.term.onResize(({ cols, rows }) => {
      connection.resize(cols, rows);
    });
    handle.term.onTitleChange((title) => latest.current.onTitle(paneId, title));
    handle.term.textarea?.addEventListener('focus', () => latest.current.onFocus(paneId));

    latest.current.onRegister(paneId, {
      term: handle.term,
      focus: () => handle.term.focus(),
      clear: () => {
        handle.term.clear();
        connection.clearHistory();
        connection.write('\u0015');
      },
      kill: () => connection.kill(),
      findNext: (needle) => handle.search.findNext(needle),
      findPrev: (needle) => handle.search.findPrevious(needle),
    });

    let resizeTimer = 0;
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(measure, 40);
    });
    observer.observe(host);

    return () => {
      window.clearTimeout(resizeTimer);
      cancelAnimationFrame(frame);
      observer.disconnect();
      latest.current.onRegister(paneId, null);
      connection.dispose();
      handle.dispose();
      handleRef.current = null;
    };
  }, [paneId, sessionId]);

  useEffect(() => {
    handleRef.current?.applyTheme(theme, config.font);
  }, [theme, fontFamily, fontSize]);

  useEffect(() => {
    if (active) handleRef.current?.term.focus();
  }, [active]);

  return (
    <div
      className="pane"
      data-active={active ? 'true' : 'false'}
      data-dimmed={dimmed ? 'true' : 'false'}
      onPointerDown={() => onFocus(paneId)}
    >
      <div className="pane-surface" ref={hostRef} />
    </div>
  );
}

/**
 * xterm swallows anything it recognises, so the app's own chords have to be
 * released before they ever reach the shell.
 */
function isAppChord(event: KeyboardEvent): boolean {
  const control = event.ctrlKey || event.metaKey;
  if (control && event.shiftKey && !event.altKey) return false;
  if (event.altKey && !control) return false;
  return true;
}
