import { useEffect, useReducer, useRef, type Dispatch } from 'react';

/**
 * Layout is persisted so a reload reattaches to the same pty sessions instead of
 * spawning a fresh shell per pane.
 */
export function usePersistentReducer<S, A>(
  key: string,
  reducer: (state: S, action: A) => S,
  initial: () => S,
  revive?: (raw: unknown) => S | null,
): [S, Dispatch<A>] {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        const revived = revive ? revive(parsed) : (parsed as S);
        if (revived) return revived;
      }
    } catch {
      // A corrupt entry is not worth keeping the app down for.
    }
    return initial();
  });

  const writes = useRef(0);
  useEffect(() => {
    const token = ++writes.current;
    const id = window.setTimeout(() => {
      if (token !== writes.current) return;
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch {
        // Private mode or quota: the layout simply will not survive a reload.
      }
    }, 120);
    return () => window.clearTimeout(id);
  }, [key, state]);

  return [state, dispatch];
}
