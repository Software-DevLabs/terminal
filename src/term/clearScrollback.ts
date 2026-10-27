import type { Terminal } from '@xterm/xterm';

type ParserHost = Pick<Terminal, 'parser' | 'write'>;

/**
 * `clear`/`cls` only sends ED 2, which erases the viewport and leaves the
 * scrollback behind. Pair it with ED 3 and tell the host, so a cleared screen
 * stays cleared when the user scrolls up or reloads the page.
 */
export function clearScrollbackOnErase(term: ParserHost, onCleared: () => void): void {
  term.parser.registerCsiHandler({ final: 'J' }, (params) => {
    if (params[0] === 2) {
      term.write('\u001b[3J');
      onCleared();
    }
    return false;
  });
}
