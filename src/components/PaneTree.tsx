import { useCallback, useMemo, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { LayoutNode, SplitNode } from '../state/layout.ts';
import { listPanes } from '../state/layout.ts';
import { TerminalView } from './TerminalView.tsx';
import type { PaneApi } from './TerminalView.tsx';
import type { AppConfig, ThemeSpec } from '../../shared/config.ts';

export interface PaneHandlers {
  onFocus: (paneId: string) => void;
  onTitle: (paneId: string, title: string) => void;
  onCwd: (paneId: string, cwd: string) => void;
  onRegister: (paneId: string, api: PaneApi | null) => void;
  onResize: (splitId: string, index: number, fraction: number) => void;
}

interface TreeProps extends PaneHandlers {
  root: LayoutNode;
  config: AppConfig;
  theme: ThemeSpec;
  activePane: string;
  zoomId: string | null;
}

function pathTo(node: LayoutNode, target: string, trail: readonly string[] = []): Set<string> {
  if (node.id === target) return new Set([...trail, node.id]);
  if (node.kind === 'split') {
    for (const child of node.children) {
      const found = pathTo(child, target, [...trail, node.id]);
      if (found.size) return found;
    }
  }
  return new Set();
}

export function PaneTree({ root, config, theme, activePane, zoomId, ...handlers }: TreeProps) {
  const path = useMemo(() => (zoomId ? pathTo(root, zoomId) : new Set<string>()), [root, zoomId]);
  const paneCount = useMemo(() => listPanes(root).length, [root]);

  return (
    <div className="tree" data-panes={paneCount}>
      <NodeView
        node={root}
        config={config}
        theme={theme}
        activePane={activePane}
        path={path}
        zoomId={zoomId}
        handlers={handlers}
      />
    </div>
  );
}

interface NodeProps {
  node: LayoutNode;
  config: AppConfig;
  theme: ThemeSpec;
  activePane: string;
  path: Set<string>;
  zoomId: string | null;
  handlers: PaneHandlers;
}

function NodeView({ node, config, theme, activePane, path, zoomId, handlers }: NodeProps) {
  if (node.kind === 'pane') {
    return (
      <TerminalView
        pane={node}
        config={config}
        theme={theme}
        active={activePane === node.id}
        dimmed={activePane !== node.id}
        onFocus={handlers.onFocus}
        onTitle={handlers.onTitle}
        onCwd={handlers.onCwd}
        onRegister={handlers.onRegister}
      />
    );
  }
  return (
    <SplitView
      node={node}
      config={config}
      theme={theme}
      activePane={activePane}
      path={path}
      zoomId={zoomId}
      handlers={handlers}
    />
  );
}

function SplitView({ node, config, theme, activePane, path, zoomId, handlers }: NodeProps & { node: SplitNode }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const beginDrag = useCallback(
    (index: number, event: ReactPointerEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;
      const cells = Array.from(container.children).filter(
        (child) => (child as HTMLElement).dataset.cell !== undefined,
      ) as HTMLElement[];
      const left = cells[index];
      const right = cells[index + 1];
      if (!left || !right) return;

      const horizontal = node.direction === 'row';
      const leftBox = left.getBoundingClientRect();
      const rightBox = right.getBoundingClientRect();
      const spanStart = horizontal ? leftBox.left : leftBox.top;
      const spanEnd = horizontal ? rightBox.right : rightBox.bottom;
      const span = spanEnd - spanStart;
      if (span <= 0) return;

      const move = (moveEvent: PointerEvent) => {
        const offset = horizontal ? moveEvent.clientX : moveEvent.clientY;
        handlers.onResize(node.id, index, (offset - spanStart) / span);
      };
      const stop = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
        document.body.style.cursor = '';
        container.dataset.dragging = 'false';
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
      document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize';
      container.dataset.dragging = 'true';
      event.preventDefault();
    },
    [node, handlers],
  );

  const items: ReactNode[] = [];
  node.children.forEach((child, index) => {
    const size = node.sizes[index] ?? 1 / node.children.length;
    const collapsed = zoomId !== null && !path.has(child.id);
    const flex = zoomId === null ? size : collapsed ? 0 : 1;
    items.push(
      <div
        key={child.id}
        data-cell={child.id}
        className="split-cell"
        style={{ flexGrow: flex, flexBasis: 0, display: collapsed ? 'none' : 'flex' }}
      >
        <NodeView
          node={child}
          config={config}
          theme={theme}
          activePane={activePane}
          path={path}
          zoomId={zoomId}
          handlers={handlers}
        />
      </div>,
    );
    if (index < node.children.length - 1) {
      items.push(
        <div
          key={`${child.id}:divider`}
          className={node.direction === 'row' ? 'divider divider-col' : 'divider divider-row'}
          onPointerDown={(event) => beginDrag(index, event)}
          onDoubleClick={() => handlers.onResize(node.id, index, 0.5)}
        />,
      );
    }
  });

  return (
    <div ref={containerRef} className={`split split-${node.direction}`} style={{ '--split-gap': '0px' } as CSSProperties}>
      {items}
    </div>
  );
}
