import { describe, expect, test } from 'bun:test';
import {
  layoutReducer,
  listPanes,
  type LayoutAction,
  type LayoutState,
  type PaneNode,
  type SplitNode,
} from './layout.ts';

function pane(id: string): PaneNode {
  return { kind: 'pane', id, sessionId: `s-${id}`, shell: 'powershell' };
}

function seed(ids: string[]): LayoutState {
  const [first, ...rest] = ids;
  const root = pane(first ?? 'a');
  let state: LayoutState = {
    tabs: [{ id: 'tab-1', title: 'Shell', root }],
    activeTab: 'tab-1',
    activePane: first ?? 'a',
    zoomedPane: null,
  };
  for (const id of rest) {
    state = step(state, { type: 'split', paneId: state.activePane, direction: 'row', node: pane(id) });
  }
  return state;
}

function step(state: LayoutState, action: LayoutAction): LayoutState {
  return layoutReducer(state, action);
}

function rootOf(state: LayoutState): SplitNode {
  const root = state.tabs[0]?.root;
  if (root?.kind !== 'split') throw new Error('expected a split root');
  return root;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

describe('split', () => {
  test('creates a two-pane row split with equal sizes', () => {
    const state = step(seed(['a']), { type: 'split', paneId: 'a', direction: 'row', node: pane('b') });
    const split = rootOf(state);
    expect(split.direction).toBe('row');
    expect(listPanes(split).map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(sum(split.sizes)).toBeCloseTo(1);
    expect(state.activePane).toBe('b');
  });

  test('inserts into an existing split in the same direction instead of nesting', () => {
    const state = step(seed(['a', 'b']), { type: 'split', paneId: 'b', direction: 'row', node: pane('c') });
    const split = rootOf(state);
    expect(split.children).toHaveLength(3);
    expect(listPanes(split).map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(sum(split.sizes)).toBeCloseTo(1);
  });

  test('wraps the pane when the direction changes', () => {
    const afterRow = step(seed(['a']), { type: 'split', paneId: 'a', direction: 'row', node: pane('b') });
    const state = step(afterRow, { type: 'split', paneId: 'b', direction: 'col', node: pane('c') });
    const split = rootOf(state);
    const nested = split.children[1];
    expect(nested?.kind).toBe('split');
    expect(listPanes(split).map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  test('does not recurse forever when a split wraps its own source pane', () => {
    const state = step(seed(['a']), { type: 'split', paneId: 'a', direction: 'col', node: pane('b') });
    expect(listPanes(rootOf(state))).toHaveLength(2);
  });
});

describe('closePane', () => {
  test('collapses a split that is left with one child', () => {
    const state = step(seed(['a', 'b']), { type: 'closePane', paneId: 'b' });
    expect(state.tabs[0]?.root.kind).toBe('pane');
  });

  test('refuses to close the last pane of the last tab', () => {
    const state = step(seed(['a']), { type: 'closePane', paneId: 'a' });
    expect(listPanes(state.tabs[0]?.root ?? pane('a'))).toHaveLength(1);
  });

  test('keeps the remaining sizes normalised', () => {
    const state = step(seed(['a', 'b', 'c']), { type: 'closePane', paneId: 'b' });
    expect(sum(rootOf(state).sizes)).toBeCloseTo(1);
    expect(listPanes(rootOf(state)).map((entry) => entry.id)).toEqual(['a', 'c']);
  });
});

describe('focus', () => {
  test('moves to the geometric neighbour on the requested side', () => {
    const state = step(seed(['a', 'b']), { type: 'focusDirection', paneId: 'a', axis: 'row', sign: 1 });
    expect(state.activePane).toBe('b');
    const back = step(state, { type: 'focusDirection', paneId: 'b', axis: 'row', sign: -1 });
    expect(back.activePane).toBe('a');
  });

  test('leaves focus alone when there is nothing in that direction', () => {
    const base = step(seed(['a', 'b']), { type: 'activatePane', paneId: 'a' });
    const state = step(base, { type: 'focusDirection', paneId: 'a', axis: 'col', sign: 1 });
    expect(state.activePane).toBe('a');
  });

  test('cycles through panes in tree order', () => {
    const base = step(seed(['a', 'b', 'c']), { type: 'activatePane', paneId: 'a' });
    expect(step(base, { type: 'cyclePane', delta: 1 }).activePane).toBe('b');
    expect(step(base, { type: 'cyclePane', delta: -1 }).activePane).toBe('c');
  });
});

test('resize clamps to a usable range and keeps the total at 1', () => {
  const state = step(seed(['a', 'b']), { type: 'resize', splitId: rootOf(seed(['a', 'b'])).id, index: 0, fraction: 9 });
  const split = rootOf(state);
  expect(split.sizes[0]).toBeLessThan(0.95);
  expect(sum(split.sizes)).toBeCloseTo(1);
});

test('equalize gives every pane the same share', () => {
  const grown = step(seed(['a', 'b', 'c']), {
    type: 'resize',
    splitId: rootOf(seed(['a', 'b', 'c'])).id,
    index: 0,
    fraction: 0.9,
  });
  const state = step(grown, { type: 'equalize' });
  expect(rootOf(state).sizes).toEqual([1 / 3, 1 / 3, 1 / 3]);
});

test('zoom hides everything except the target and toggles back off', () => {
  const zoomed = step(seed(['a', 'b']), { type: 'zoom', paneId: 'a' });
  expect(zoomed.zoomedPane).toBe('a');
  expect(step(zoomed, { type: 'zoom', paneId: 'a' }).zoomedPane).toBeNull();
});

describe('tabs', () => {
  test('new tab becomes active and cycleTab wraps', () => {
    const tabPane = pane('z');
    const state = step(seed(['a']), {
      type: 'newTab',
      tab: { id: 'tab-2', title: 'Shell', root: tabPane },
    });
    expect(state.activeTab).toBe('tab-2');
    expect(step(state, { type: 'cycleTab', delta: 1 }).activeTab).toBe('tab-1');
    expect(step(state, { type: 'cycleTab', delta: -1 }).activeTab).toBe('tab-1');
  });

  test('closing the last tab is refused', () => {
    const state = step(seed(['a']), { type: 'closeTab', tabId: 'tab-1' });
    expect(state.tabs).toHaveLength(1);
  });
});

test('setCwd only rewrites the pane that reported it', () => {
  const base = seed(['a', 'b']);
  const state = step(base, { type: 'setCwd', paneId: 'b', cwd: 'D:/temp' });
  const [first, second] = listPanes(rootOf(state));
  expect(first?.cwd).toBeUndefined();
  expect(second?.cwd).toBe('D:/temp');
});
