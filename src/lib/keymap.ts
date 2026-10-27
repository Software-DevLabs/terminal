const KEY_ALIASES: Record<string, string> = {
  arrowleft: 'left',
  arrowright: 'right',
  arrowup: 'up',
  arrowdown: 'down',
  ' ': 'space',
  '+': 'equal',
  '=': 'equal',
  _: 'minus',
  '-': 'minus',
  ',': 'comma',
  '.': 'period',
  tab: 'tab',
  escape: 'escape',
  enter: 'enter',
  backspace: 'backspace',
};

const MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'meta', 'os']);

interface Chord {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
}

export function normalizeKey(key: string): string {
  const lower = key.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

export function parseChord(chord: string): Chord {
  const parts = chord.toLowerCase().split('+');
  const key = parts[parts.length - 1] ?? '';
  return {
    ctrl: parts.includes('ctrl'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    meta: parts.includes('meta'),
    key,
  };
}

export function matchesChord(chord: string, event: KeyboardEvent): boolean {
  const parsed = parseChord(chord);
  if (event.ctrlKey !== parsed.ctrl) return false;
  if (event.shiftKey !== parsed.shift) {
    // '+' and '-' need Shift on standard layouts; accept both spellings.
    const symbol = parsed.key === 'equal' || parsed.key === 'minus';
    if (!symbol || parsed.shift) return false;
  }
  if (event.altKey !== parsed.alt) return false;
  if (event.metaKey !== parsed.meta) return false;
  return normalizeKey(event.key) === parsed.key;
}

/** Turns a keydown into the same `ctrl+shift+e` form used by the config. */
export function chordFromEvent(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key.toLowerCase())) return null;
  const key = normalizeKey(event.key);
  if (!key) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('ctrl');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  if (event.metaKey) parts.push('meta');
  parts.push(key);
  return parts.join('+');
}

/** A bare letter would swallow terminal input, so require a command modifier. */
export function hasCommandModifier(chord: string): boolean {
  const parsed = parseChord(chord);
  return parsed.ctrl || parsed.alt || parsed.meta;
}
