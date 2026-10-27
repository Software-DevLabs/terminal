import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { AppConfig, ThemeSpec } from '../../shared/config.ts';

export interface TerminalHandle {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  host: HTMLDivElement;
  applyTheme: (theme: ThemeSpec, font: AppConfig['font']) => void;
  dispose: () => void;
}

function toTheme(spec: ThemeSpec): ITheme {
  return {
    background: spec.background,
    foreground: spec.foreground,
    cursor: spec.cursor,
    selectionBackground: spec.selection,
    black: spec.black,
    red: spec.red,
    green: spec.green,
    yellow: spec.yellow,
    blue: spec.blue,
    magenta: spec.magenta,
    cyan: spec.cyan,
    white: spec.white,
    brightBlack: spec.brightBlack,
    brightRed: spec.brightRed,
    brightGreen: spec.brightGreen,
    brightYellow: spec.brightYellow,
    brightBlue: spec.brightBlue,
    brightMagenta: spec.brightMagenta,
    brightCyan: spec.brightCyan,
    brightWhite: spec.brightWhite,
  };
}

export function createTerminal(
  host: HTMLDivElement,
  config: AppConfig,
  theme: ThemeSpec,
  onCwd: (cwd: string) => void,
): TerminalHandle {
  const term = new Terminal({
    allowProposedApi: true,
    cursorBlink: config.cursorBlink,
    cursorStyle: config.cursorStyle,
    disableStdin: false,
    fontFamily: `"${config.font.family}", "Cascadia Mono", Consolas, monospace`,
    fontSize: config.font.size,
    fontWeight: '400',
    fontWeightBold: '700',
    letterSpacing: 0,
    lineHeight: 1.15,
    logLevel: 'off',
    scrollback: config.scrollback,
    smoothScrollDuration: 0,
    theme: toTheme(theme),
    windowsPty: { backend: 'conpty', buildNumber: 25324 },
  });

  const fit = new FitAddon();
  term.loadAddon(fit);

  const search = new SearchAddon();
  term.loadAddon(search);

  term.loadAddon(new WebLinksAddon());

  // Wide glyphs need the unicode 11 tables or CJK/emoji advance one cell short.
  const unicode = new Unicode11Addon();
  term.loadAddon(unicode);
  term.unicode.activeVersion = '11';

  attachWebgl(term);

  // Shells that opt in report their directory; new panes inherit it.
  term.parser.registerOscHandler(7, (data) => {
    try {
      const url = new URL(data);
      if (url.protocol === 'file:') onCwd(decodeURIComponent(url.pathname).replace(/^\//, ''));
    } catch {
      return false;
    }
    return true;
  });

  term.open(host);

  return {
    term,
    fit,
    search,
    host,
    applyTheme(nextTheme, nextFont) {
      term.options.theme = toTheme(nextTheme);
      term.options.fontFamily = `"${nextFont.family}", "Cascadia Mono", Consolas, monospace`;
      term.options.fontSize = nextFont.size;
    },
    dispose() {
      term.dispose();
    },
  };
}

/** GPU painting is the difference between smooth and janky under heavy output. */
function attachWebgl(term: Terminal): void {
  try {
    const webgl = new WebglAddon(false);
    webgl.onContextLoss(() => {
      webgl.dispose();
    });
    term.loadAddon(webgl);
  } catch {
    // No GPU context: xterm keeps its built-in DOM renderer.
  }
}
