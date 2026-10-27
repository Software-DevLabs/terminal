export type Direction = 'row' | 'col';

export interface PaneNode {
  kind: 'pane';
  id: string;
  sessionId: string;
  shell: string;
  cwd?: string;
}

export interface SplitNode {
  kind: 'split';
  id: string;
  direction: Direction;
  /** Fractions of the parent's cross axis; always sums to 1. */
  sizes: number[];
  children: LayoutNode[];
}

export type LayoutNode = PaneNode | SplitNode;

export interface Tab {
  id: string;
  title: string;
  root: LayoutNode;
}

export interface LayoutState {
  tabs: Tab[];
  activeTab: string;
  activePane: string;
  zoomedPane: string | null;
}

export type LayoutAction =
  | { type: 'newTab'; tab: Tab }
  | { type: 'closeTab'; tabId: string }
  | { type: 'activateTab'; tabId: string }
  | { type: 'cycleTab'; delta: 1 | -1 }
  | { type: 'renameTab'; tabId: string; title: string }
  | { type: 'split'; paneId: string; direction: Direction; node: PaneNode }
  | { type: 'closePane'; paneId: string }
  | { type: 'activatePane'; paneId: string }
  | { type: 'focusDirection'; paneId: string; axis: Direction; sign: 1 | -1 }
  | { type: 'cyclePane'; delta: 1 | -1 }
  | { type: 'zoom'; paneId: string }
  | { type: 'equalize' }
  | { type: 'resize'; splitId: string; index: number; fraction: number }
  | { type: 'setSession'; paneId: string; sessionId: string; shell: string; cwd?: string }
  | { type: 'setCwd'; paneId: string; cwd: string };

export function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 10);
}

export function findNode(root: LayoutNode, id: string): LayoutNode | null {
  if (root.id === id) return root;
  if (root.kind === 'split') {
    for (const child of root.children) {
      const found = findNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

export function findParent(root: LayoutNode, id: string, parent: LayoutNode | null = null): SplitNode | null {
  if (root.id === id) return parent && parent.kind === 'split' ? parent : null;
  if (root.kind === 'split') {
    for (const child of root.children) {
      const found = findParent(child, id, root);
      if (found) return found;
    }
  }
  return null;
}

export function listPanes(root: LayoutNode): PaneNode[] {
  if (root.kind === 'pane') return [root];
  return root.children.flatMap(listPanes);
}

/** Bottom-up so a node created by `visit` is never visited again. */
function mapTree(root: LayoutNode, visit: (node: LayoutNode) => LayoutNode): LayoutNode {
  const mapped: LayoutNode =
    root.kind === 'split' ? { ...root, children: root.children.map((child) => mapTree(child, visit)) } : root;
  return visit(mapped);
}

function normalizeSizes(sizes: number[]): number[] {
  const positive = sizes.map((size) => (Number.isFinite(size) && size > 0 ? size : 0.0001));
  const total = positive.reduce((sum, size) => sum + size, 0);
  return positive.map((size) => size / total);
}

function removePane(root: LayoutNode, paneId: string): LayoutNode | null {
  if (root.kind === 'pane') return root.id === paneId ? null : root;
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  root.children.forEach((child, index) => {
    const next = removePane(child, paneId);
    if (next) {
      children.push(next);
      sizes.push(root.sizes[index] ?? 1);
    }
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0] ?? null;
  return { ...root, children, sizes: normalizeSizes(sizes) };
}

export function activeTabOf(state: LayoutState): Tab | undefined {
  return state.tabs.find((tab) => tab.id === state.activeTab);
}

export function initialLayout(pane: PaneNode, title: string): LayoutState {
  const tab: Tab = { id: uid('tab-'), title, root: pane };
  return { tabs: [tab], activeTab: tab.id, activePane: pane.id, zoomedPane: null };
}

export function layoutReducer(state: LayoutState, action: LayoutAction): LayoutState {
  const tab = activeTabOf(state);
  if (!tab) return state;

  switch (action.type) {
    case 'newTab':
      return {
        ...state,
        tabs: [...state.tabs, action.tab],
        activeTab: action.tab.id,
        activePane: action.tab.root.id,
        zoomedPane: null,
      };

    case 'closeTab': {
      if (state.tabs.length === 1) return state;
      const index = state.tabs.findIndex((entry) => entry.id === action.tabId);
      const tabs = state.tabs.filter((entry) => entry.id !== action.tabId);
      const nextActive = tabs[Math.min(Math.max(index, 0), tabs.length - 1)] ?? tabs[0];
      return {
        ...state,
        tabs,
        activeTab: nextActive?.id ?? '',
        activePane: nextActive ? listPanes(nextActive.root)[0]?.id ?? '' : '',
        zoomedPane: null,
      };
    }

    case 'activateTab': {
      const target = state.tabs.find((entry) => entry.id === action.tabId);
      if (!target) return state;
      return { ...state, activeTab: target.id, activePane: listPanes(target.root)[0]?.id ?? target.root.id };
    }

    case 'cycleTab': {
      const index = state.tabs.findIndex((entry) => entry.id === state.activeTab);
      const next = state.tabs[(index + action.delta + state.tabs.length) % state.tabs.length];
      if (!next || next.id === state.activeTab) return state;
      return { ...state, activeTab: next.id, activePane: listPanes(next.root)[0]?.id ?? '' };
    }

    case 'renameTab':
      return {
        ...state,
        tabs: state.tabs.map((entry) => (entry.id === action.tabId ? { ...entry, title: action.title } : entry)),
      };

    case 'split': {
      const parent = findParent(tab.root, action.paneId);
      let root: LayoutNode;
      if (parent && parent.direction === action.direction) {
        const index = parent.children.findIndex((child) => child.id === action.paneId);
        root = mapTree(tab.root, (node) => {
          if (node.kind !== 'split' || node.id !== parent.id) return node;
          const children = [...node.children];
          children.splice(index + 1, 0, action.node);
          const share = node.sizes[index] ?? 1 / node.children.length;
          const sizes = normalizeSizes([
            ...node.sizes.slice(0, index + 1),
            share,
            ...node.sizes.slice(index + 1),
          ]);
          return { ...node, children, sizes };
        });
      } else {
        root = mapTree(tab.root, (node) => {
          if (node.kind !== 'pane' || node.id !== action.paneId) return node;
          const size = parent ? 1 / parent.children.length : 1;
          const wrapper: SplitNode = {
            kind: 'split',
            id: uid('split-'),
            direction: action.direction,
            sizes: normalizeSizes([size, size]),
            children: [node, action.node],
          };
          return wrapper;
        });
      }
      const tabs = state.tabs.map((entry) => (entry.id === tab.id ? { ...entry, root } : entry));
      return { ...state, tabs, activePane: action.node.id };
    }

    case 'closePane': {
      const pruned = removePane(tab.root, action.paneId);
      if (!pruned) {
        if (state.tabs.length === 1) return state;
        return layoutReducer(state, { type: 'closeTab', tabId: tab.id });
      }
      const panes = listPanes(pruned);
      const nextActive = panes.find((pane) => pane.id === state.activePane) ?? panes[0];
      const tabs = state.tabs.map((entry) => (entry.id === tab.id ? { ...entry, root: pruned } : entry));
      return {
        ...state,
        tabs,
        activePane: nextActive?.id ?? '',
        zoomedPane: state.zoomedPane === action.paneId ? null : state.zoomedPane,
      };
    }

    case 'activatePane':
      return findNode(tab.root, action.paneId) ? { ...state, activePane: action.paneId } : state;

    case 'focusDirection': {
      const target = nearestPaneInDirection(tab.root, action.paneId, action.axis, action.sign);
      return target ? { ...state, activePane: target.id } : state;
    }

    case 'cyclePane': {
      const panes = listPanes(tab.root);
      if (panes.length < 2) return state;
      const index = panes.findIndex((pane) => pane.id === state.activePane);
      const next = panes[(index + action.delta + panes.length) % panes.length];
      return next ? { ...state, activePane: next.id } : state;
    }

    case 'zoom':
      return { ...state, zoomedPane: state.zoomedPane === action.paneId ? null : action.paneId };

    case 'equalize': {
      const root = mapTree(tab.root, (node) =>
        node.kind === 'split' ? { ...node, sizes: normalizeSizes(node.children.map(() => 1)) } : node,
      );
      const tabs = state.tabs.map((entry) => (entry.id === tab.id ? { ...entry, root } : entry));
      return { ...state, tabs };
    }

    case 'resize': {
      const root = mapTree(tab.root, (node) => {
        if (node.kind !== 'split' || node.id !== action.splitId) return node;
        const sizes = [...node.sizes];
        const a = sizes[action.index] ?? 0;
        const b = sizes[action.index + 1] ?? 0;
        const combined = a + b;
        if (combined <= 0) return node;
        const fraction = Math.min(0.9, Math.max(0.1, action.fraction));
        sizes[action.index] = combined * fraction;
        sizes[action.index + 1] = combined * (1 - fraction);
        return { ...node, sizes: normalizeSizes(sizes) };
      });
      const tabs = state.tabs.map((entry) => (entry.id === tab.id ? { ...entry, root } : entry));
      return { ...state, tabs };
    }

    case 'setSession': {
      const root = mapTree(tab.root, (node) =>
        node.kind === 'pane' && node.id === action.paneId
          ? { ...node, sessionId: action.sessionId, shell: action.shell, cwd: action.cwd ?? node.cwd }
          : node,
      );
      const tabs = state.tabs.map((entry) => (entry.id === tab.id ? { ...entry, root } : entry));
      return { ...state, tabs };
    }

    case 'setCwd': {
      const current = findNode(tab.root, action.paneId);
      if (current?.kind !== 'pane' || current.cwd === action.cwd) return state;
      const root = mapTree(tab.root, (node) =>
        node.kind === 'pane' && node.id === action.paneId ? { ...node, cwd: action.cwd } : node,
      );
      const tabs = state.tabs.map((entry) => (entry.id === tab.id ? { ...entry, root } : entry));
      return { ...state, tabs };
    }

    default:
      return state;
  }
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Geometric focus movement: every pane gets a virtual box from the split tree,
 * then we pick the best candidate that sits in the requested direction. This is
 * what makes Alt+Arrow feel like iTerm instead of a flat list.
 */
function geometryOf(root: LayoutNode, box: Box = { left: 0, right: 1, top: 0, bottom: 1 }): Map<string, Box> {
  const out = new Map<string, Box>();
  if (root.kind === 'pane') {
    out.set(root.id, box);
    return out;
  }
  let cursor = 0;
  root.children.forEach((child, index) => {
    const size = root.sizes[index] ?? 1 / root.children.length;
    const childBox =
      root.direction === 'row'
        ? {
            left: box.left + (box.right - box.left) * cursor,
            right: box.left + (box.right - box.left) * (cursor + size),
            top: box.top,
            bottom: box.bottom,
          }
        : {
            left: box.left,
            right: box.right,
            top: box.top + (box.bottom - box.top) * cursor,
            bottom: box.top + (box.bottom - box.top) * (cursor + size),
          };
    cursor += size;
    for (const [id, value] of geometryOf(child, childBox)) out.set(id, value);
  });
  return out;
}

function nearestPaneInDirection(root: LayoutNode, fromId: string, axis: Direction, sign: 1 | -1): PaneNode | null {
  const boxes = geometryOf(root);
  const source = boxes.get(fromId);
  if (!source) return null;
  const panes = listPanes(root);
  const sourceCenter = { x: (source.left + source.right) / 2, y: (source.top + source.bottom) / 2 };

  let best: PaneNode | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const pane of panes) {
    if (pane.id === fromId) continue;
    const box = boxes.get(pane.id);
    if (!box) continue;
    const center = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
    const dx = center.x - sourceCenter.x;
    const dy = center.y - sourceCenter.y;
    const horizontal = axis === 'row';
    const along = (horizontal ? dx : dy) * sign;
    const across = horizontal ? dy : dx;
    if (along <= 0.0001) continue;
    const score = along + Math.abs(across) * 4;
    if (score < bestScore) {
      bestScore = score;
      best = pane;
    }
  }
  return best;
}
