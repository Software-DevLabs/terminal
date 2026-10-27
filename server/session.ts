import { spawn } from '@lydell/node-pty';
import type { IPty } from '@lydell/node-pty';
import type { WebSocket } from 'ws';
import type { ServerEvent } from '../shared/protocol.ts';
import type { ShellSpec } from '../shared/config.ts';

const HIGH_WATER = 1 << 20;
const LOW_WATER = 1 << 18;
const REPLAY_LIMIT = 512 * 1024;
const WS_OPEN = 1;

interface Chunk {
  data: string;
  bytes: number;
}

export interface SessionOptions {
  shell: ShellSpec;
  cols: number;
  rows: number;
  cwd?: string;
  env?: Record<string, string>;
}

/**
 * One shell process plus the browser tabs currently watching it. The output ring
 * buffer lets a page reload reattach and see the scrollback again, which is what
 * makes Vite HMR survivable and gives us tmux-like persistence.
 */
export class Session {
  readonly id: string;
  readonly pid: number;
  readonly shellLabel: string;
  readonly shellPath: string;

  private readonly pty: IPty;
  private readonly clients = new Set<WebSocket>();
  private readonly ring: Chunk[] = [];
  private ringBytes = 0;
  private paused = false;
  private drainTimer: NodeJS.Timeout | null = null;

  cwd: string;
  exited = false;
  exitCode: number | null = null;
  private _cols: number;
  private _rows: number;

  constructor(id: string, options: SessionOptions) {
    this.id = id;
    this._cols = Math.max(2, options.cols);
    this._rows = Math.max(1, options.rows);
    this.cwd = options.cwd ?? process.cwd();
    this.shellLabel = options.shell.label;
    this.shellPath = options.shell.path;

    this.pty = spawn(options.shell.path, options.shell.args, {
      name: 'xterm-256color',
      cols: Math.max(2, options.cols),
      rows: Math.max(1, options.rows),
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        TERM_PROGRAM: 'macterm',
      },
    });
    this.pid = this.pty.pid;

    this.pty.onData((data) => {
      this.remember(data);
      this.broadcast(data);
    });

    this.pty.onExit(({ exitCode, signal }) => {
      this.exited = true;
      this.exitCode = exitCode;
      this.emit({ type: 'exit', code: exitCode, signal: signal ?? null });
      try {
        this.pty.kill();
      } catch {
        // Already torn down by ConPTY.
      }
    });
  }

  get replayedBytes(): number {
    return this.ringBytes;
  }

  get cols(): number {
    return this._cols;
  }

  get rows(): number {
    return this._rows;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  attach(socket: WebSocket): void {
    this.clients.add(socket);
    this.resume();
    for (const chunk of this.ring) {
      socket.send(Buffer.from(chunk.data, 'utf8'));
    }
    if (this.exited) {
      this.emit({ type: 'exit', code: this.exitCode, signal: null }, socket);
    }
  }

  detach(socket: WebSocket): void {
    this.clients.delete(socket);
  }

  write(data: string): void {
    if (!this.exited) {
      this.pty.write(data);
    }
  }

  resize(cols: number, rows: number): void {
    if (this.exited) return;
    const nextCols = Math.max(2, cols);
    const nextRows = Math.max(1, rows);
    if (nextCols === this._cols && nextRows === this._rows) return;
    this._cols = nextCols;
    this._rows = nextRows;
    try {
      this.pty.resize(nextCols, nextRows);
    } catch {
      // ConPTY rejects a resize while the child is mid-exit; the next one wins.
    }
  }

  kill(): void {
    if (!this.exited) {
      this.pty.kill();
    }
  }

  /** Drops the replay ring, e.g. when a resize is about to rebuild the screen. */
  dropHistory(): void {
    this.ring.length = 0;
    this.ringBytes = 0;
  }

  private remember(data: string): void {
    this.ring.push({ data, bytes: data.length });
    this.ringBytes += data.length;
    while (this.ringBytes > REPLAY_LIMIT && this.ring.length > 1) {
      const dropped = this.ring.shift();
      if (dropped) this.ringBytes -= dropped.bytes;
    }
  }

  private broadcast(data: string): void {
    if (this.clients.size === 0) return;
    const bytes = Buffer.from(data, 'utf8');
    for (const client of this.clients) {
      if (client.readyState !== WS_OPEN) {
        this.clients.delete(client);
        continue;
      }
      client.send(bytes);
    }
    this.applyBackpressure();
  }

  /**
   * xterm can only consume what the GPU can paint, so a fast producer (`type` on a
   * huge file) must not be allowed to grow the socket queue without bound.
   */
  private applyBackpressure(): void {
    if (this.paused || this.exited) return;
    let queued = 0;
    for (const client of this.clients) {
      queued += client.bufferedAmount;
    }
    if (queued < HIGH_WATER) return;

    this.paused = true;
    this.pty.pause();
    this.drainTimer = setInterval(() => {
      let now = 0;
      for (const client of this.clients) {
        now += client.bufferedAmount;
      }
      if (now < LOW_WATER || this.clients.size === 0) {
        this.resume();
      }
    }, 16);
  }

  private resume(): void {
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
    if (this.paused) {
      this.paused = false;
      if (!this.exited) this.pty.resume();
    }
  }

  private emit(event: ServerEvent, only?: WebSocket): void {
    const payload = JSON.stringify(event);
    const targets = only ? [only] : [...this.clients];
    for (const client of targets) {
      if (client.readyState === WS_OPEN) {
        client.send(payload);
      }
    }
  }
}
