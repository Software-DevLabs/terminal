import { useEffect, useRef } from 'react';
import type { ActionName } from '../../shared/config.ts';
import { matchesChord } from '../lib/keymap.ts';

/**
 * One global listener for every bound action. Registered on the capture phase so
 * a chord never reaches xterm's textarea and gets echoed into the shell.
 */
export function useKeymap(
  keymap: Partial<Record<ActionName, string>> | undefined,
  handlers: Partial<Record<ActionName, () => void>>,
  enabled: boolean,
): void {
  const latest = useRef({ keymap, handlers, enabled });
  latest.current = { keymap, handlers, enabled };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { keymap: map, handlers: run, enabled: on } = latest.current;
      if (!on || !map) return;
      for (const [action, chord] of Object.entries(map)) {
        if (!chord) continue;
        if (matchesChord(chord, event)) {
          const runAction = run[action as ActionName];
          if (!runAction) continue;
          event.preventDefault();
          event.stopPropagation();
          runAction();
          return;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}
