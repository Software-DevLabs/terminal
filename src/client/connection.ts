import { ptyUrl } from './config.ts';
import type { ServerEvent } from '../../shared/protocol.ts';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface PtyConnectionOptions {
  sessionId: string;
  shell: string;
  cwd?: string;
  cols: number;
  rows: number;
  onBytes: (bytes: Uint8Array) => void;
  onEvent: (event: ServerEvent) => void;
  onStatus: (status: ConnectionStatus) => void;
}

/**
 * One websocket per pane. Text frames carry JSON events, binary frames carry raw
 * pty bytes in both directions. Dropped sockets are retried with backoff and the
 * host replays its ring buffer, so a reload or a blip never loses the shell.
 */
export class PtyConnection {
  private socket: WebSocket | null = null;
  private timer: number | null = null;
  private attempt = 0;
  private closed = false;
  private pending: Uint8Array[] = [];
  private lastResize = { cols: 0, rows: 0 };

  constructor(private readonly options: PtyConnectionOptions) {
    this.lastResize = { cols: options.cols, rows: options.rows };
    this.connect();
  }

  get sessionId(): string {
    return this.options.sessionId;
  }

  private connect(): void {
    if (this.closed) return;
    this.options.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const socket = new WebSocket(
      ptyUrl({
        session: this.options.sessionId,
        shell: this.options.shell,
        cwd: this.options.cwd,
        cols: this.lastResize.cols,
        rows: this.lastResize.rows,
      }),
    );
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.options.onStatus('open');
      // The pane is often fitted while the socket is still handshaking, so the
      // size baked into the url can already be stale. Re-assert it on open;
      // otherwise the pty stays at its spawn size and every ConPTY diff lands
      // on the wrong columns.
      this.sendControl({ type: 'resize', cols: this.lastResize.cols, rows: this.lastResize.rows });
      for (const chunk of this.pending.splice(0)) socket.send(chunk);
    };
    socket.onmessage = (event) => {
      if (typeof event.data === 'string') {
        this.options.onEvent(JSON.parse(event.data) as ServerEvent);
      } else {
        this.options.onBytes(new Uint8Array(event.data as ArrayBuffer));
      }
    };
    socket.onclose = () => {
      this.socket = null;
      if (this.closed) return;
      this.options.onStatus('reconnecting');
      const delay = Math.min(4000, 120 * 2 ** this.attempt);
      this.attempt += 1;
      this.timer = window.setTimeout(() => this.connect(), delay);
    };
    socket.onerror = () => {
      socket.close();
    };
  }

  write(data: string): void {
    const bytes = new TextEncoder().encode(data);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(bytes);
    } else {
      this.pending.push(bytes);
    }
  }

  resize(cols: number, rows: number): void {
    if (cols === this.lastResize.cols && rows === this.lastResize.rows) return;
    this.lastResize = { cols, rows };
    this.sendControl({ type: 'resize', cols, rows });
  }

  /** Tells the host to forget its replay buffer after the screen was cleared. */
  clearHistory(): void {
    this.sendControl({ type: 'clearHistory' });
  }

  kill(): void {
    this.closed = true;
    this.sendControl({ type: 'kill' });
    this.socket?.close();
  }

  dispose(): void {
    this.closed = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
  }

  private sendControl(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
}
