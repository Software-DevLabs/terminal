export type CursorStyle = 'block' | 'underline' | 'bar';

export interface ShellSpec {
  label: string;
  path: string;
  args: string[];
  icon?: string;
}

export interface ThemeSpec {
  label: string;
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export type ActionName =
  | 'newTab'
  | 'closeTab'
  | 'closePane'
  | 'splitRight'
  | 'splitDown'
  | 'focusNext'
  | 'focusLeft'
  | 'focusRight'
  | 'focusUp'
  | 'focusDown'
  | 'prevTab'
  | 'nextTab'
  | 'zoomPane'
  | 'equalizePanes'
  | 'fontUp'
  | 'fontDown'
  | 'fontReset'
  | 'transparencyUp'
  | 'transparencyDown'
  | 'toggleTheme'
  | 'find'
  | 'clearBuffer'
  | 'help'
  | 'settings'
  | 'workspace';

export interface AppConfig {
  shell: string;
  theme: string;
  font: { family: string; size: number; boldIsBright: boolean };
  scrollback: number;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  shellIntegration: boolean;
  shells: Record<string, ShellSpec>;
  themes: Record<string, ThemeSpec>;
  keymap: Record<ActionName, string>;
}

export const ACTIONS: ActionName[] = [
  'newTab',
  'closeTab',
  'closePane',
  'splitRight',
  'splitDown',
  'focusNext',
  'focusLeft',
  'focusRight',
  'focusUp',
  'focusDown',
  'prevTab',
  'nextTab',
  'zoomPane',
  'equalizePanes',
  'fontUp',
  'fontDown',
  'fontReset',
  'transparencyUp',
  'transparencyDown',
  'toggleTheme',
  'find',
  'clearBuffer',
  'help',
  'settings',
  'workspace',
];

/** Renders a `ctrl+shift+e` style chord into a label for the settings UI. */
export function chordLabel(chord: string): string {
  const names: Record<string, string> = {
    ctrl: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift',
    meta: 'Cmd',
    equal: '+',
    minus: '-',
    space: 'Space',
    tab: 'Tab',
    left: '\u2190',
    right: '\u2192',
    up: '\u2191',
    down: '\u2193',
    comma: ',',
  };
  return chord
    .split('+')
    .map((part) => names[part] ?? part.toUpperCase())
    .join(' + ');
}
